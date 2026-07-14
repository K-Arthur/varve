import { downscaleImageData } from './previewDownscale';
import { dispatchBackgroundRemoval } from './providers/dispatch';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from './types';
import { DEFAULT_PREVIEW_MAX_DIMENSION } from './types';

export type { CategoryProfile, ImageCategoryFeatures } from './categoryTuning';
export {
  extractCategoryFeatures,
  findBestCategoryMatch,
  updateCategoryProfile,
} from './categoryTuning';
export type { CloudProviderSettings } from './cloudConfig';
export {
  DEFAULT_CONFIG as DEFAULT_CLOUD_CONFIG,
  loadCloudConfig,
  resetCloudConfig,
  saveCloudConfig,
} from './cloudConfig';
export type { FinalizeMaskOptions, FinalizeMaskResult } from './finalizeMask';
export { finalizeMaskResult } from './finalizeMask';
export type { GpuCapabilities } from './gpuAccelerator';
export { GpuAccelerator, getGpuCapabilities, gpuFeatherMask } from './gpuAccelerator';
export { maskToDataUrl as maskArrayToDataUrl, removeBackgroundHeuristic } from './heuristic';
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
export { getModelLoader, getModelLoaderReady, resetModelLoader } from './modelLoader';
export { ModelStorageQuotaError } from './modelStore';
export type { FlowVector } from './opticalFlow';
export { computeBlockFlow, warpMask } from './opticalFlow';
export { downscaleImageData } from './previewDownscale';
export { cloudRemovalProvider } from './providers/cloudProvider';
export { AI_PROVIDER_CHAIN } from './providers/dispatch';
export type { RemovalProvider } from './providers/types';
export type { HairMattingOptions } from './refineHairMatting';
export { refineHairMatting, TRIMap } from './refineHairMatting';
export type { TrimapMattingOptions } from './trimapMatting';
export { solveTrimapMatting, trimapFromMask } from './trimapMatting';
export {
  deleteTuningProfile,
  getTuningStats,
  loadTuningProfiles,
  saveTuningProfile,
} from './tuningStore';
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
export type { VideoFrame, VideoMatteOptions, VideoMatteResult } from './videoMatte';
export { processVideoMatte } from './videoMatte';
export { cancelAllWorkerJobs, terminateWorkerPool } from './workerPool';

function withPreviewDefaults(options: BackgroundRemovalOptions): BackgroundRemovalOptions {
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
 * 2. AI methods — Worker ONNX → Tauri IPC → direct ONNX → cloud API.
 *
 * AI requests fail when every AI provider is unavailable. The Quick heuristic
 * runs only when the caller explicitly requests `method: 'quick'`.
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
  const maxDim = resolved.previewMaxDimension ?? DEFAULT_PREVIEW_MAX_DIMENSION;
  const workingBuffer =
    imageData.width > maxDim || imageData.height > maxDim
      ? downscaleImageData(imageData, maxDim)
      : imageData;
  return dispatchBackgroundRemoval(workingBuffer, resolved, signal);
}
