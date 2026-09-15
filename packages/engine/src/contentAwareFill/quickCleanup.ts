import { GenerativeEditError } from '../generativeEdit/types';
import { validateMaskFrameGeometry } from './contextExtraction';
import { runContentAwareFillPipeline } from './pipeline';

/** The deterministic provider used for small repairs on constrained devices. */
export const QUICK_CLEANUP_PROVIDER = {
  id: 'varve-quick-cleanup',
  label: 'Quick Cleanup',
  runtime: 'patchmatch' as const,
  modelRequired: false,
  promptConditioned: false,
} as const;

export interface QuickCleanupOptions {
  /** Source pixels in the canonical, untransformed image space. */
  imageData: ImageData;
  /** Coverage mask: 0 preserves a source pixel, 255 repairs it. */
  mask: Uint8Array;
  maskWidth: number;
  maskHeight: number;
  /** Mask origin in source-image pixels, for bounded selection masks. */
  maskOffsetX?: number;
  maskOffsetY?: number;
  /** Context around the marked region; the pipeline caps this value. */
  contextPadding?: number;
  /** Reproducible PatchMatch seed. */
  seed?: number;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}

export interface QuickCleanupResult {
  imageData: ImageData;
  width: number;
  height: number;
  filledBounds: { x: number; y: number; w: number; h: number };
  provider: typeof QUICK_CLEANUP_PROVIDER;
  processingTimeMs: number;
  warnings: string[];
}

function validateOptions(options: QuickCleanupOptions): void {
  const { imageData, mask, maskWidth, maskHeight } = options;
  if (
    !Number.isSafeInteger(imageData.width) ||
    !Number.isSafeInteger(imageData.height) ||
    imageData.width <= 0 ||
    imageData.height <= 0
  ) {
    throw new GenerativeEditError('invalid-image', 'The cleanup source image is invalid.');
  }
  const geometry = validateMaskFrameGeometry(
    imageData.width,
    imageData.height,
    mask,
    maskWidth,
    maskHeight,
    options.maskOffsetX ?? 0,
    options.maskOffsetY ?? 0,
  );
  if (!geometry.valid) throw new GenerativeEditError('invalid-mask', geometry.message);
  if (!mask.some((value) => value > 0)) {
    throw new GenerativeEditError('empty-mask', 'Paint an area to clean up before running it.');
  }
}

/**
 * Repair a small marked region using only existing source pixels.
 *
 * This is intentionally an explicit API instead of an implicit fallback from
 * prompt generation. A caller can tell the user that Quick Cleanup was
 * selected, record its provider identity, and keep the requested semantic
 * recipe untouched when a model is unavailable or too large for the device.
 */
export async function runQuickCleanup(options: QuickCleanupOptions): Promise<QuickCleanupResult> {
  validateOptions(options);
  const result = await runContentAwareFillPipeline({
    imageData: options.imageData,
    mask: options.mask,
    maskWidth: options.maskWidth,
    maskHeight: options.maskHeight,
    maskOffsetX: options.maskOffsetX ?? 0,
    maskOffsetY: options.maskOffsetY ?? 0,
    quality: 'fast',
    outputMode: 'replace-pixels',
    contextPadding: options.contextPadding,
    seed: options.seed,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  return {
    imageData: result.imageData,
    width: result.width,
    height: result.height,
    filledBounds: result.filledBounds,
    provider: QUICK_CLEANUP_PROVIDER,
    processingTimeMs: result.processingTimeMs,
    warnings: result.warnings,
  };
}
