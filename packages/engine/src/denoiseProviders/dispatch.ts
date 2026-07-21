/**
 * SCUNet denoise dispatch — tiled inference for arbitrary image sizes.
 *
 * SCUNet supports dynamic input dimensions (H, W must be divisible by 8).
 * For images larger than the tile size, we split into overlapping tiles,
 * run each independently, and blend with a feathering window for seamless
 * recomposition. Alpha is extracted, denoised, and recomposited exactly.
 */
import {
  alignTo8,
  blendTiles,
  computeTiles,
  extractTile,
  postprocessScunet,
  preprocessScunet,
} from '../inference/models/scunet';

export interface DenoiseOptions {
  strength: number;
  modelId?: string;
  tileSize?: number;
  overlap?: number;
  maxDim?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface DenoiseResult {
  denoised: ImageData;
  processingTimeMs: number;
  executionProvider: string;
  tilesUsed: number;
}

export async function dispatchDenoise(
  source: ImageData,
  options: DenoiseOptions,
): Promise<DenoiseResult> {
  const { strength, modelId = 'scunet', signal, onProgress } = options;
  const tileSize = options.tileSize ?? 512;
  const overlap = options.overlap ?? 64;
  const maxDim = options.maxDim ?? 2048;

  const start = performance.now();

  if (signal?.aborted) throw new Error('cancelled');

  const {
    tensor,
    alignedWidth,
    alignedHeight,
    originalWidth,
    originalHeight,
    hasAlpha,
    alphaData,
  } = preprocessScunet(source);

  if (alignedWidth <= tileSize && alignedHeight <= tileSize) {
    const result = await denoiseSingle(
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
      signal,
    );
    const elapsed = performance.now() - start;
    onProgress?.(1, 1);
    return { denoised: result, processingTimeMs: elapsed, executionProvider: 'wasm', tilesUsed: 1 };
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

    const denoised = await denoiseSingle(
      extracted.tensor,
      extracted.alignedWidth,
      extracted.alignedHeight,
      extracted.alignedWidth,
      extracted.alignedHeight,
      extracted.alphaData,
      tileOriginalData,
      strength,
      modelId,
      maxDim,
      signal,
    );

    const tileFloat = new Float32Array(pixels * 3);
    const denoisedData = denoised.data;
    for (let p = 0; p < pixels; p++) {
      tileFloat[p] = denoisedData[p * 4]! / 255;
      tileFloat[pixels + p] = denoisedData[p * 4 + 1]! / 255;
      tileFloat[pixels * 2 + p] = denoisedData[p * 4 + 2]! / 255;
    }
    tileResults.push(tileFloat);
    onProgress?.(i + 1, tiles.length);
  }

  if (signal?.aborted) throw new Error('cancelled');

  const blended = blendTiles(tiles, tileResults, alignedWidth, alignedHeight, overlap);

  const finalPixels = originalWidth * originalHeight;
  const resultPixels = originalWidth * originalHeight;
  const result = new Uint8ClampedArray(resultPixels * 4);

  for (let y = 0; y < originalHeight; y++) {
    for (let x = 0; x < originalWidth; x++) {
      const blendIdx = y * alignedWidth + x;
      const dstIdx = (y * originalWidth + x) * 4;

      const r = Math.round(Math.min(1, Math.max(0, blended[blendIdx]!)) * 255);
      const g = Math.round(Math.min(1, Math.max(0, blended[finalPixels + blendIdx]!)) * 255);
      const b = Math.round(Math.min(1, Math.max(0, blended[finalPixels * 2 + blendIdx]!)) * 255);

      const origOffset = (y * originalWidth + x) * 4;
      const origR = source.data[origOffset]!;
      const origG = source.data[origOffset + 1]!;
      const origB = source.data[origOffset + 2]!;

      result[dstIdx] = Math.round(r * strength + origR * (1 - strength));
      result[dstIdx + 1] = Math.round(g * strength + origG * (1 - strength));
      result[dstIdx + 2] = Math.round(b * strength + origB * (1 - strength));
      result[dstIdx + 3] = hasAlpha && alphaData ? alphaData[y * originalWidth + x]! : 255;
    }
  }

  const elapsed = performance.now() - start;
  return {
    denoised: new ImageData(result, originalWidth, originalHeight),
    processingTimeMs: elapsed,
    executionProvider: 'wasm',
    tilesUsed: tiles.length,
  };
}

async function denoiseSingle(
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
  signal?: AbortSignal,
): Promise<ImageData> {
  if (signal?.aborted) throw new Error('cancelled');

  const { getModelLoader } = await import('../backgroundRemoval/modelLoader');
  const loader = getModelLoader(signal);
  const modelPath = await loader.getModelPath(modelId, signal);
  if (!modelPath) {
    throw new Error(
      'Denoise model not downloaded. Use the Download button in the AI Denoise panel first.',
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

  const ort = await import('onnxruntime-web');

  const { isWasmModelSafe } = await import('../backgroundRemoval/environmentCapabilities');
  if (!(await isWasmModelSafe(modelId))) {
    throw new Error('SCUNet model exceeds safe WASM memory limit');
  }

  if (signal?.aborted) throw new Error('cancelled');

  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['wasm'],
  });

  if (signal?.aborted) {
    try {
      await session.release();
    } catch {
      /* */
    }
    throw new Error('cancelled');
  }

  const inputTensor = new ort.Tensor('float32', processTensor, [1, 3, processH, processW]);
  const inputName = session.inputNames[0]!;

  const results = await session.run({ [inputName]: inputTensor });
  const outputName = session.outputNames[0]!;
  const outputTensor = results[outputName] as unknown as { data: Float32Array; dims: number[] };

  try {
    await session.release();
  } catch {
    /* */
  }

  if (signal?.aborted) throw new Error('cancelled');

  const outH = outputTensor.dims[2] ?? processH;
  const outW = outputTensor.dims[3] ?? processW;

  return postprocessScunet(
    outputTensor.data,
    outW,
    outH,
    targetWidth,
    targetHeight,
    alphaData,
    strength,
    originalData,
  );
}
