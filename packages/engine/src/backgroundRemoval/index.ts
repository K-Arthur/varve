import { maskToDataUrl } from './heuristic';
import { resizeMaskBilinear } from './maskOps';
import { downscaleImageData } from './previewDownscale';
import { dispatchBackgroundRemoval } from './providers/dispatch';
import { composeSourceAndSubjectAlpha } from './reconstructMask';
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
export type { EnvironmentCapabilities } from './environmentCapabilities';
export {
  getBestOnnxProviders,
  getEnvironmentCapabilities,
  getEnvironmentCapabilitiesSync,
  isWasmModelSafe,
  resetEnvironmentCapabilities,
} from './environmentCapabilities';
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
export type { ModelInfo } from './modelInfo';
export { getModelInfo, MODEL_INFO_MAP } from './modelInfo';
export { getModelLoader, getModelLoaderReady, resetModelLoader } from './modelLoader';
export type { SegmentationModelSpec } from './modelSpec';
export { getSegmentationModelSpec, packModelInput } from './modelSpec';
export { ModelStorageQuotaError } from './modelStore';
export type { FlowVector } from './opticalFlow';
export { computeBlockFlow, warpMask } from './opticalFlow';
export { downscaleImageData } from './previewDownscale';
export { cloudRemovalProvider } from './providers/cloudProvider';
export { AI_PROVIDER_CHAIN } from './providers/dispatch';
export type { RemovalProvider } from './providers/types';
export type { ModelToSourceTransform, ReconstructionResult } from './reconstructMask';
export {
  composeSourceAndSubjectAlpha,
  computeLetterboxTransform,
  extractAlignedEdgeBand,
  reconstructModelMask,
  refineEdgeBand,
} from './reconstructMask';
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
  SourceResolutionInfo,
  WorkerModelId,
} from './types';
export {
  AVAILABLE_MODELS,
  DEFAULT_PREVIEW_MAX_DIMENSION,
  preferredWorkerModelIdForMethod,
  workerModelIdForMethod,
} from './types';
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
 * After inference completes, the preview-resolution mask is reconstructed
 * to the original source resolution via letterbox-aware bilinear
 * interpolation, then composited with the source image's alpha channel.
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
  const needsDownscale = imageData.width > maxDim || imageData.height > maxDim;
  const workingBuffer = needsDownscale ? downscaleImageData(imageData, maxDim) : imageData;

  const result = await dispatchBackgroundRemoval(workingBuffer, resolved, signal);
  const srcW = imageData.width;
  const srcH = imageData.height;

  const sourceInfo = {
    modelWidth: result.width,
    modelHeight: result.height,
    sourceWidth: srcW,
    sourceHeight: srcH,
  };

  const previewMask = result.rawMask;
  const canReconstruct = needsDownscale && previewMask && previewMask.length > 0;

  if (!canReconstruct) {
    return {
      ...result,
      width: srcW,
      height: srcH,
      sourceWidth: srcW,
      sourceHeight: srcH,
      sourceResolutionInfo: sourceInfo,
    };
  }

  // Providers return a mask already aligned to the working image buffer.
  // That preprocessing stretches the working buffer to the model's square
  // input and then restores it, so applying a second letterbox transform here
  // crops valid pixels. Only scale the aligned working mask back to the
  // oriented source dimensions.
  const reconstructedAlpha = resizeMaskBilinear(
    previewMask,
    result.width,
    result.height,
    srcW,
    srcH,
  );

  const srcData = imageData.data;
  const sourceAlpha = new Uint8Array(srcW * srcH);
  for (let i = 0; i < srcW * srcH; i++) {
    sourceAlpha[i] = srcData[i * 4 + 3] ?? 255;
  }
  const finalAlpha = composeSourceAndSubjectAlpha(sourceAlpha, reconstructedAlpha);

  return {
    ...result,
    maskDataUrl: maskToDataUrl(finalAlpha, srcW, srcH),
    rawMask: finalAlpha,
    width: srcW,
    height: srcH,
    sourceAlpha: finalAlpha,
    sourceWidth: srcW,
    sourceHeight: srcH,
    sourceResolutionInfo: sourceInfo,
  };
}
