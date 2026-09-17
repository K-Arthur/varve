import {
  compositeFillResult,
  computeMaskBounds,
  runContentAwareFillPipeline,
} from '../contentAwareFill';
import type { ContentAwareFillQuality, ContentAwareFillResult } from '../contentAwareFill/types';

/**
 * PatchMatch compares a small neighbourhood around every target pixel. An
 * expansion target sits on the edge of the requested frame, so it would not
 * have a complete neighbourhood unless we give the worker a little extra
 * edge-clamped context. The padding is discarded before the result is
 * returned; it is never accepted as document content.
 */
const CONTEXT_GUARD_PIXELS = 4;
const DEFAULT_CONTEXT_PADDING = 32;
/**
 * LaMa's staged-border tiling (below) generates each border tile from an
 * independent model pass; the only signal keeping adjacent tiles' color and
 * lighting consistent is how much *real* shared context each pass sees
 * around its own target rectangle. A real-photo measurement (32px vs 96px,
 * see docs/audits/lama-tile-seam-context-padding-2026-09-16.md) found the
 * default 32px measurably worse at the tile-boundary seam than 96px, with
 * no observed downside (the letterboxed model input is always 512x512
 * either way, so this does not change inference cost). Fast/PatchMatch
 * keeps the original default — PatchMatch's context need is a local
 * neighbourhood search, not measured here, and is not the case that showed
 * seams.
 */
const AI_CONTEXT_PADDING = 96;
const MAX_TILE_PIXELS = 262_144;

/** Exported for direct unit coverage of the padding default itself. */
export function resolveExpandContextPadding(
  quality: ContentAwareFillQuality,
  requested?: number,
): number {
  return Math.max(
    requested ?? (quality === 'ai' ? AI_CONTEXT_PADDING : DEFAULT_CONTEXT_PADDING),
    CONTEXT_GUARD_PIXELS + 1,
  );
}
/**
 * A single model pass keeps horizons, lighting, and corners in one shared
 * context. Above this bound the native/WASM model input and decoded result can
 * become an avoidable memory spike, so the fallback uses ordered border bands.
 * This is a workflow budget, not a claim about the model's maximum size.
 */
const MAX_COHERENT_MODEL_PIXELS = 1_048_576;

export type ExpandGenerationStrategy = 'coherent-full-frame' | 'staged-border';

interface FrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PaddedExpansionFrame {
  imageData: ImageData;
  mask: Uint8Array;
  width: number;
  height: number;
}

function checkedPixelCount(width: number, height: number): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height)
  ) {
    throw new Error('Expand frame dimensions are invalid');
  }
  return width * height;
}

function edgeClampedIndex(value: number, limit: number): number {
  return Math.max(0, Math.min(limit - 1, value));
}

/**
 * Add protected, edge-clamped context around an already-expanded frame.
 * Existing source pixels and the user/provider mask remain aligned at the
 * interior offset. Pixels in the guard are deliberately unmasked.
 */
function padExpansionFrame(imageData: ImageData, mask: Uint8Array): PaddedExpansionFrame {
  const sourcePixels = checkedPixelCount(imageData.width, imageData.height);
  if (mask.length !== sourcePixels) {
    throw new Error('Expand mask dimensions do not match the source frame');
  }

  const width = imageData.width + CONTEXT_GUARD_PIXELS * 2;
  const height = imageData.height + CONTEXT_GUARD_PIXELS * 2;
  const pixels = checkedPixelCount(width, height);
  const padded = new ImageData(width, height);
  const paddedMask = new Uint8Array(pixels);

  for (let y = 0; y < height; y += 1) {
    const sourceY = edgeClampedIndex(y - CONTEXT_GUARD_PIXELS, imageData.height);
    for (let x = 0; x < width; x += 1) {
      const sourceX = edgeClampedIndex(x - CONTEXT_GUARD_PIXELS, imageData.width);
      const sourceOffset = (sourceY * imageData.width + sourceX) * 4;
      const destinationOffset = (y * width + x) * 4;
      padded.data[destinationOffset] = imageData.data[sourceOffset] ?? 0;
      padded.data[destinationOffset + 1] = imageData.data[sourceOffset + 1] ?? 0;
      padded.data[destinationOffset + 2] = imageData.data[sourceOffset + 2] ?? 0;
      padded.data[destinationOffset + 3] = imageData.data[sourceOffset + 3] ?? 0;

      const insideSourceFrame =
        x >= CONTEXT_GUARD_PIXELS &&
        x < CONTEXT_GUARD_PIXELS + imageData.width &&
        y >= CONTEXT_GUARD_PIXELS &&
        y < CONTEXT_GUARD_PIXELS + imageData.height;
      if (insideSourceFrame) {
        paddedMask[y * width + x] =
          mask[(y - CONTEXT_GUARD_PIXELS) * imageData.width + (x - CONTEXT_GUARD_PIXELS)] ?? 0;
      }
    }
  }

  return { imageData: padded, mask: paddedMask, width, height };
}

function cropGuardFrame(padded: ImageData, width: number, height: number): ImageData {
  if (
    padded.width < width + CONTEXT_GUARD_PIXELS * 2 ||
    padded.height < height + CONTEXT_GUARD_PIXELS * 2
  ) {
    throw new Error('Expand provider returned a frame smaller than its guarded input');
  }
  const cropped = new ImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = ((y + CONTEXT_GUARD_PIXELS) * padded.width + CONTEXT_GUARD_PIXELS) * 4;
    const destinationOffset = y * width * 4;
    cropped.data.set(
      padded.data.subarray(sourceOffset, sourceOffset + width * 4),
      destinationOffset,
    );
  }
  return cropped;
}

function maskBoundsForCoverage(
  mask: Uint8Array,
  width: number,
  height: number,
  covered: boolean,
): FrameRegion | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const isCovered = (mask[y * width + x] ?? 0) > 128;
      if (isCovered !== covered) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < minX || maxY < minY
    ? null
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function containsCoverage(mask: Uint8Array, width: number, region: FrameRegion): boolean {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if ((mask[(region.y + y) * width + region.x + x] ?? 0) > 128) return true;
    }
  }
  return false;
}

function expandRegion(region: FrameRegion, width: number, height: number, padding: number) {
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const right = Math.min(width, region.x + region.width + padding);
  const bottom = Math.min(height, region.y + region.height + padding);
  return { x, y, width: right - x, height: bottom - y };
}

function splitRegion(region: FrameRegion): FrameRegion[] {
  if (region.width * region.height <= MAX_TILE_PIXELS) return [region];
  const regions: FrameRegion[] = [];
  if (region.width >= region.height) {
    const chunkWidth = Math.max(1, Math.floor(MAX_TILE_PIXELS / region.height));
    for (let x = region.x; x < region.x + region.width; x += chunkWidth) {
      regions.push({
        x,
        y: region.y,
        width: Math.min(chunkWidth, region.x + region.width - x),
        height: region.height,
      });
    }
  } else {
    const chunkHeight = Math.max(1, Math.floor(MAX_TILE_PIXELS / region.width));
    for (let y = region.y; y < region.y + region.height; y += chunkHeight) {
      regions.push({
        x: region.x,
        y,
        width: region.width,
        height: Math.min(chunkHeight, region.y + region.height - y),
      });
    }
  }
  return regions;
}

/**
 * Select the expansion execution shape before any guarded frame or inference
 * buffer is allocated. A model-backed request gets one shared frame while it
 * fits the measured coherence budget; larger requests are explicitly staged.
 * Small heuristic requests also use one frame to avoid needless seams.
 */
export function chooseExpandGenerationStrategy(
  width: number,
  height: number,
  quality: ContentAwareFillQuality,
  hasModel: boolean,
): ExpandGenerationStrategy {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Expand frame dimensions are invalid');
  }
  const pixels = width * height;
  if (quality === 'ai' && hasModel && pixels <= MAX_COHERENT_MODEL_PIXELS) {
    return 'coherent-full-frame';
  }
  if (pixels <= MAX_TILE_PIXELS) return 'coherent-full-frame';
  return 'staged-border';
}

function extractRegion(imageData: ImageData, region: FrameRegion): ImageData {
  const result = new ImageData(region.width, region.height);
  for (let y = 0; y < region.height; y += 1) {
    const sourceOffset = ((region.y + y) * imageData.width + region.x) * 4;
    result.data.set(
      imageData.data.subarray(sourceOffset, sourceOffset + region.width * 4),
      y * region.width * 4,
    );
  }
  return result;
}

function extractMask(mask: Uint8Array, width: number, region: FrameRegion): Uint8Array {
  const result = new Uint8Array(region.width * region.height);
  for (let y = 0; y < region.height; y += 1) {
    const sourceOffset = (region.y + y) * width + region.x;
    result.set(mask.subarray(sourceOffset, sourceOffset + region.width), y * region.width);
  }
  return result;
}

function copyCoveredRegion(
  destination: ImageData,
  generated: ImageData,
  mask: Uint8Array,
  region: FrameRegion,
): void {
  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      if ((mask[y * region.width + x] ?? 0) <= 128) continue;
      const sourceOffset = (y * generated.width + x) * 4;
      const destinationOffset = ((region.y + y) * destination.width + region.x + x) * 4;
      destination.data[destinationOffset] = generated.data[sourceOffset] ?? 0;
      destination.data[destinationOffset + 1] = generated.data[sourceOffset + 1] ?? 0;
      destination.data[destinationOffset + 2] = generated.data[sourceOffset + 2] ?? 0;
      destination.data[destinationOffset + 3] = generated.data[sourceOffset + 3] ?? 0;
    }
  }
}

/**
 * Run promptless Expand through the deterministic local repair provider.
 *
 * The caller supplies a frame that already contains the source translated
 * into its final expanded output frame and a mask where only newly exposed
 * pixels are non-zero. This function never changes protected pixels, even if
 * the repair provider writes outside its intended mask.
 */
export async function runDeterministicExpandFallback(options: {
  imageData: ImageData;
  mask: Uint8Array;
  quality: ContentAwareFillQuality;
  contextPadding?: number;
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  modelPath?: string;
  modelId?: string;
}): Promise<ContentAwareFillResult> {
  const startTime = performance.now();
  const { imageData, mask } = options;
  checkedPixelCount(imageData.width, imageData.height);
  if (mask.length !== imageData.width * imageData.height) {
    throw new Error('Expand mask dimensions do not match the source frame');
  }
  if (!computeMaskBounds(mask, imageData.width, imageData.height)) {
    throw new Error('Expand has no newly exposed pixels to generate');
  }
  if (options.signal?.aborted) throw new Error('cancelled');

  const protectedBounds = maskBoundsForCoverage(mask, imageData.width, imageData.height, false);
  if (!protectedBounds) {
    throw new Error('Expand must retain a protected source frame');
  }
  const contextPadding = resolveExpandContextPadding(options.quality, options.contextPadding);
  const strategy = chooseExpandGenerationStrategy(
    imageData.width,
    imageData.height,
    options.quality,
    Boolean(options.modelPath),
  );
  const targetBands: FrameRegion[] =
    strategy === 'coherent-full-frame'
      ? [{ x: 0, y: 0, width: imageData.width, height: imageData.height }]
      : [
          { x: 0, y: 0, width: imageData.width, height: protectedBounds.y },
          {
            x: 0,
            y: protectedBounds.y + protectedBounds.height,
            width: imageData.width,
            height: imageData.height - protectedBounds.y - protectedBounds.height,
          },
          {
            x: 0,
            y: protectedBounds.y,
            width: protectedBounds.x,
            height: protectedBounds.height,
          },
          {
            x: protectedBounds.x + protectedBounds.width,
            y: protectedBounds.y,
            width: imageData.width - protectedBounds.x - protectedBounds.width,
            height: protectedBounds.height,
          },
        ].filter(
          (region) =>
            region.width > 0 &&
            region.height > 0 &&
            containsCoverage(mask, imageData.width, region),
        );

  // A stale or deliberately holey mask can contain editable pixels inside
  // the protected rectangle. Keep that case correct too, without turning a
  // normal expansion into a full-frame PatchMatch request.
  if (containsCoverage(mask, imageData.width, protectedBounds)) {
    targetBands.push(protectedBounds);
  }

  const tiles = targetBands.flatMap(splitRegion);
  if (tiles.length === 0) throw new Error('Expand has no newly exposed pixels to generate');

  const composited = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  let executionProvider = options.quality === 'fast' ? 'heuristic' : 'wasm';
  let generatedModelId: string | undefined;
  const generationWarnings: string[] = [
    ...(options.quality === 'ai'
      ? [
          'LaMa is an inpainting model rather than a dedicated outpainting model; inspect the full generated border at 1:1 and discard or reduce the expansion if structure drifts.',
        ]
      : []),
    ...(strategy === 'coherent-full-frame'
      ? [
          options.quality === 'ai'
            ? 'Expansion used one shared model frame so borders and corners receive common context.'
            : 'Expansion used one shared frame so the generated border and corners receive common context.',
        ]
      : options.quality === 'ai'
        ? [
            'Expansion used ordered border stages because the requested frame exceeds the coherent model-pass budget; inspect side and corner seams at 1:1.',
          ]
        : []),
  ];
  for (let index = 0; index < tiles.length; index += 1) {
    if (options.signal?.aborted) throw new Error('cancelled');
    const target = tiles[index]!;
    const contextualRegion = expandRegion(
      target,
      imageData.width,
      imageData.height,
      contextPadding,
    );
    const targetImage = extractRegion(composited, contextualRegion);
    const targetMask = extractMask(mask, imageData.width, contextualRegion);
    for (let y = 0; y < contextualRegion.height; y += 1) {
      for (let x = 0; x < contextualRegion.width; x += 1) {
        const globalX = contextualRegion.x + x;
        const globalY = contextualRegion.y + y;
        if (
          globalX < target.x ||
          globalX >= target.x + target.width ||
          globalY < target.y ||
          globalY >= target.y + target.height
        ) {
          targetMask[y * contextualRegion.width + x] = 0;
        }
      }
    }
    const guarded = padExpansionFrame(targetImage, targetMask);
    const generated = await runContentAwareFillPipeline({
      imageData: guarded.imageData,
      mask: guarded.mask,
      maskWidth: guarded.width,
      maskHeight: guarded.height,
      maskOffsetX: 0,
      maskOffsetY: 0,
      quality: options.quality,
      outputMode: 'new-layer',
      contextPadding,
      seed: (options.seed ?? 0) + index,
      signal: options.signal,
      onProgress: (progress) =>
        options.onProgress?.((index + progress) / Math.max(1, tiles.length)),
      modelPath: options.modelPath,
      modelId: options.modelId,
    });
    if (options.signal?.aborted) throw new Error('cancelled');
    if (generated.executionProvider) executionProvider = generated.executionProvider;
    if (generated.modelId) generatedModelId = generated.modelId;
    generationWarnings.push(...generated.warnings);
    const generatedRegion = cropGuardFrame(
      generated.imageData,
      contextualRegion.width,
      contextualRegion.height,
    );
    copyCoveredRegion(composited, generatedRegion, targetMask, contextualRegion);
  }

  // The deterministic provider is expected to honour the mask, but the
  // compositing contract must enforce it rather than trusting an algorithm.
  const protectedResult = compositeFillResult(imageData, composited, 0, 0, mask);
  const filledBounds = computeMaskBounds(mask, imageData.width, imageData.height);
  if (!filledBounds) throw new Error('Expand has no newly exposed pixels to generate');
  return {
    imageData: protectedResult,
    width: protectedResult.width,
    height: protectedResult.height,
    filledBounds,
    quality: options.quality,
    executionProvider,
    ...((generatedModelId ?? options.modelId)
      ? { modelId: generatedModelId ?? options.modelId }
      : {}),
    processingTimeMs: performance.now() - startTime,
    warnings: [
      ...generationWarnings,
      'Expand used promptless local reconstruction; semantic prompts require a qualified diffusion provider.',
    ],
  };
}
