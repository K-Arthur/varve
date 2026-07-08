import { dispatchBackgroundRemoval } from './providers/dispatch';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from './types';
import { DEFAULT_PREVIEW_MAX_DIMENSION } from './types';

export { removeBackgroundHeuristic, maskToDataUrl as maskArrayToDataUrl } from './heuristic';
export { getModelLoader, getModelLoaderReady, resetModelLoader } from './modelLoader';
export { ModelStorageQuotaError } from './modelStore';
export type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  HeuristicMethod,
  ModelMetadata,
  ModelState,
  RemovalMethod,
  WorkerModelId,
} from './types';
export { AVAILABLE_MODELS, DEFAULT_PREVIEW_MAX_DIMENSION, workerModelIdForMethod } from './types';
export { cancelAllWorkerJobs, terminateWorkerPool } from './workerPool';
export type { RemovalProvider } from './providers/types';
export { AI_PROVIDER_CHAIN } from './providers/dispatch';

function withPreviewDefaults(options: BackgroundRemovalOptions): BackgroundRemovalOptions {
  if (options.method === 'quick') return options;
  return {
    ...options,
    previewMaxDimension: options.previewMaxDimension ?? DEFAULT_PREVIEW_MAX_DIMENSION,
  };
}

/**
 * Remove background from an ImageData buffer.
 *
 * Dispatch is handled by the provider chain in `providers/dispatch.ts`:
 * 1. `method: 'quick'` — pure TypeScript heuristic (always available).
 * 2. AI methods — Worker ONNX → Tauri IPC → direct ONNX → heuristic fallback.
 */
export async function removeBackground(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  if (imageData.width === 0 || imageData.height === 0) {
    throw new Error('Cannot remove background from a 0-byte image (width or height is zero)');
  }

  const resolved = withPreviewDefaults(options);
  return dispatchBackgroundRemoval(imageData, resolved, signal);
}

export type { FinalizeMaskOptions, FinalizeMaskResult } from './finalizeMask';
export { finalizeMaskResult } from './finalizeMask';
export { decodeMaskDataUrl } from './maskDecode';
export type { MaskComponent, MaskComponentBBox } from './maskOps';
export {
  decontaminateMask,
  featherMaskArray,
  filterMaskByComponents,
  findConnectedComponents,
  maskFromImageData,
  maskToImageData,
} from './maskOps';
export { downscaleImageData } from './previewDownscale';
export type { HairMattingOptions } from './refineHairMatting';
export { refineHairMatting, TRIMap } from './refineHairMatting';
export type { TrimapMattingOptions } from './trimapMatting';
export { solveTrimapMatting, trimapFromMask } from './trimapMatting';
