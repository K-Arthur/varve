/**
 * Shared tiled restoration orchestrator. Runs a restoration task over an
 * ImageData through the provider chain, splitting into overlapping tiles
 * with a feathered blend window for seamless recomposition, preserving
 * alpha and bounding memory. Denoise, deblur and compression restoration
 * differ only in adapter (padding/channel policy) and tile defaults.
 */

import {
  alignTo8,
  blendTiles,
  computeTiles,
  extractTile,
  type ScunetPreprocessResult,
} from '../inference/models/scunet';
import { candidateProviders, restoreTileWithFallback } from './chain';
import type { RestorationTileProvider, RestorationTileRequest } from './types';

export interface RestorationAdapter {
  preprocess(imageData: ImageData): ScunetPreprocessResult;
}

export interface TiledRestorationOptions {
  modelId: string;
  strength: number;
  tileSize?: number;
  overlap?: number;
  maxDim?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  adapter: RestorationAdapter;
  providers?: RestorationTileProvider[];
}

export interface TiledRestorationResult {
  imageData: ImageData;
  processingTimeMs: number;
  executionProvider: string;
  tilesUsed: number;
}

export async function runTiledRestoration(
  source: ImageData,
  options: TiledRestorationOptions,
): Promise<TiledRestorationResult> {
  const { modelId, strength, signal, onProgress, adapter } = options;
  const tileSize = options.tileSize ?? 512;
  const overlap = options.overlap ?? 64;
  const maxDim = options.maxDim ?? 2048;

  const start = performance.now();
  if (signal?.aborted) throw new Error('cancelled');

  const candidates = options.providers ?? candidateProviders(modelId);
  const pinned: { provider: RestorationTileProvider | null } = { provider: null };

  const { tensor, alignedWidth, alignedHeight, originalWidth, originalHeight, alphaData } =
    adapter.preprocess(source);

  if (alignedWidth <= tileSize && alignedHeight <= tileSize) {
    const result = await runSingle(
      tensor,
      alignedWidth,
      alignedHeight,
      originalWidth,
      originalHeight,
      alphaData,
      source.data,
      strength,
      modelId,
      maxDim,
      candidates,
      pinned,
      signal,
    );
    const elapsed = performance.now() - start;
    onProgress?.(1, 1);
    return {
      imageData: result.imageData,
      processingTimeMs: elapsed,
      executionProvider: result.executionProvider,
      tilesUsed: 1,
    };
  }

  const tiles = computeTiles(originalWidth, originalHeight, tileSize, overlap);
  const tileResults: Float32Array[] = [];

  for (let i = 0; i < tiles.length; i++) {
    if (signal?.aborted) throw new Error('cancelled');
    const tile = tiles[i]!;
    const extracted = extractTile(source, tile);

    const tileOriginalData = new Uint8ClampedArray(tile.width * tile.height * 4);
    const pixels = tile.width * tile.height;
    for (let p = 0; p < pixels; p++) {
      const srcX = Math.min(tile.x + (p % tile.width), originalWidth - 1);
      const srcY = Math.min(tile.y + Math.floor(p / tile.width), originalHeight - 1);
      const srcOffset = (srcY * originalWidth + srcX) * 4;
      const dstOffset = p * 4;
      tileOriginalData[dstOffset] = source.data[srcOffset]!;
      tileOriginalData[dstOffset + 1] = source.data[srcOffset + 1]!;
      tileOriginalData[dstOffset + 2] = source.data[srcOffset + 2]!;
      tileOriginalData[dstOffset + 3] = source.data[srcOffset + 3]!;
    }

    const denoised = await runSingle(
      extracted.tensor,
      extracted.alignedWidth,
      extracted.alignedHeight,
      // Keep padded tensor dimensions separate from the actual output tile.
      // Edge tiles are smaller than their graph-safe padded tensor.
      tile.width,
      tile.height,
      extracted.alphaData,
      tileOriginalData,
      strength,
      modelId,
      maxDim,
      candidates,
      pinned,
      signal,
    );

    // `blendTiles` indexes each result with the graph-safe padded stride. The
    // provider returns the cropped, visible tile, so repack it into that
    // padded layout before recomposition. Keeping the visible and padded
    // dimensions separate is essential for right/bottom edge tiles: using a
    // packed visible stride here shifts rows and eventually reads undefined
    // values as black pixels.
    const paddedWidth = alignTo8(tile.width);
    const paddedHeight = alignTo8(tile.height);
    const paddedPixels = paddedWidth * paddedHeight;
    const tileFloat = new Float32Array(paddedPixels * 3);
    const denoisedData = denoised.imageData.data;
    for (let y = 0; y < tile.height; y += 1) {
      for (let x = 0; x < tile.width; x += 1) {
        const sourcePixel = y * tile.width + x;
        const paddedPixel = y * paddedWidth + x;
        tileFloat[paddedPixel] = denoisedData[sourcePixel * 4]! / 255;
        tileFloat[paddedPixels + paddedPixel] = denoisedData[sourcePixel * 4 + 1]! / 255;
        tileFloat[paddedPixels * 2 + paddedPixel] = denoisedData[sourcePixel * 4 + 2]! / 255;
      }
    }
    tileResults.push(tileFloat);
    onProgress?.(i + 1, tiles.length);
  }

  if (signal?.aborted) throw new Error('cancelled');

  const blended = blendTiles(tiles, tileResults, alignedWidth, alignedHeight, overlap);
  const finalPixels = originalWidth * originalHeight;
  const result = new Uint8ClampedArray(finalPixels * 4);

  for (let y = 0; y < originalHeight; y++) {
    for (let x = 0; x < originalWidth; x++) {
      const blendIdx = y * alignedWidth + x;
      const dstIdx = (y * originalWidth + x) * 4;
      const r = Math.round(Math.min(1, Math.max(0, blended[blendIdx]!)) * 255);
      const g = Math.round(Math.min(1, Math.max(0, blended[finalPixels + blendIdx]!)) * 255);
      const b = Math.round(Math.min(1, Math.max(0, blended[finalPixels * 2 + blendIdx]!)) * 255);
      const origOffset = (y * originalWidth + x) * 4;
      result[dstIdx] = Math.round(r * strength + source.data[origOffset]! * (1 - strength));
      result[dstIdx + 1] = Math.round(g * strength + source.data[origOffset + 1]! * (1 - strength));
      result[dstIdx + 2] = Math.round(b * strength + source.data[origOffset + 2]! * (1 - strength));
      result[dstIdx + 3] = alphaData ? alphaData[y * originalWidth + x]! : 255;
    }
  }

  const elapsed = performance.now() - start;
  return {
    imageData: new ImageData(result, originalWidth, originalHeight),
    processingTimeMs: elapsed,
    executionProvider: pinned.provider?.id === 'native-restoration' ? 'native' : 'worker',
    tilesUsed: tiles.length,
  };
}

async function runSingle(
  tensor: Float32Array,
  width: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
  alphaData: Uint8ClampedArray | null,
  originalData: Uint8ClampedArray,
  strength: number,
  modelId: string,
  maxDim: number,
  candidates: RestorationTileProvider[],
  pinned: { provider: RestorationTileProvider | null },
  signal?: AbortSignal,
) {
  if (signal?.aborted) throw new Error('cancelled');
  const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
  const loader = getModelLoader(signal);
  const available = await loader.isModelAvailable(modelId);
  if (!available) {
    throw new Error(
      'Restoration model not downloaded. Use the Download button in the Enhance dialog first.',
    );
  }
  if (signal?.aborted) throw new Error('cancelled');

  let processW = width;
  let processH = height;
  let processTensor = tensor;

  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    processW = alignTo8(Math.floor(width * scale));
    processH = alignTo8(Math.floor(height * scale));
    const processPixels = processW * processH;
    processTensor = new Float32Array(processPixels * 3);
    const xRatio = width / processW;
    const yRatio = height / processH;
    const srcPixels = width * height;
    for (let y = 0; y < processH; y++) {
      for (let x = 0; x < processW; x++) {
        const srcX = Math.min(Math.floor(x * xRatio), width - 1);
        const srcY = Math.min(Math.floor(y * yRatio), height - 1);
        const srcIdx = srcY * width + srcX;
        const dstIdx = y * processW + x;
        processTensor[dstIdx] = tensor[srcIdx]!;
        processTensor[processPixels + dstIdx] = tensor[srcPixels + srcIdx]!;
        processTensor[processPixels * 2 + dstIdx] = tensor[srcPixels * 2 + srcIdx]!;
      }
    }
  }

  if (signal?.aborted) throw new Error('cancelled');
  return restoreTileWithFallback(
    {
      tensor: processTensor,
      width: processW,
      height: processH,
      targetWidth,
      targetHeight,
      originalData,
      alphaData,
      strength,
      modelId,
    } satisfies RestorationTileRequest,
    candidates,
    pinned,
    signal,
  );
}
