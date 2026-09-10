/** Default downscale cap for AI inference (mask is upscaled to source dimensions). */
export const DEFAULT_PREVIEW_MAX_DIMENSION = 2048;

export type RemovalMethod = 'quick' | 'ai-balanced' | 'ai-quality';

/** User-facing precision preference for AI inference.
 *  Controls whether INT8 quantized model variants are preferred over FP32.
 *  'automatic' — conservative default, returns FP32 always
 *  'performance' — prefers INT8, but only if runtime benchmark shows INT8 is faster on this CPU
 *  'quality' — always FP32
 */
export type InferenceQualityPreference = 'automatic' | 'performance' | 'quality';
export const DEFAULT_QUALITY_PREFERENCE: InferenceQualityPreference = 'automatic';

/** Model IDs that have INT8 quantized variants bundled with the app. */
export const INT8_MODEL_IDS = new Set<string>(['u2netp-int8']);

/** Return the INT8 variant ID for a given FP32 model, or null if none exists. */
export function int8VariantId(modelId: WorkerModelId): WorkerModelId | null {
  switch (modelId) {
    case 'u2netp':
      return 'u2netp-int8';
    default:
      return null;
  }
}

/** Return the FP32 source ID for a given model (identity for non-INT8 variants). */
export function fp32SourceId(modelId: WorkerModelId): WorkerModelId {
  if (modelId === 'u2netp-int8') return 'u2netp';
  return modelId;
}

/** Resolve a model ID given a removal method and quality preference.
 *  Returns null for 'quick' mode (no model).
 */
export function resolveModelIdForPreference(
  method: RemovalMethod,
  preference: InferenceQualityPreference,
): WorkerModelId | null {
  const baseId = workerModelIdForMethod(method);
  if (!baseId) return null;
  if (preference === 'quality') return baseId;
  const int8Id = int8VariantId(baseId);
  if (!int8Id) return baseId;
  if (preference === 'performance') return int8Id;
  // 'automatic': use FP32 for the bundled model (conservative default).
  return baseId;
}

export type ModelState = 'unavailable' | 'downloading' | 'ready' | 'error';

export type HeuristicMethod = 'floodFill' | 'chromaKey' | 'kMeans' | 'edgeDetect' | 'auto';

export interface BackgroundRemovalOptions {
  method: RemovalMethod;
  heuristicMethod?: HeuristicMethod;
  tolerance?: number;
  feather?: number;
  smooth?: number;
  decontaminate?: boolean;
  clickPoint?: { x: number; y: number };
  previewMaxDimension?: number;
  /** Precision preference for AI model selection. Controls FP32 vs INT8 variant. */
  qualityPreference?: InferenceQualityPreference;
  /**
   * Monotonic revision counter for stale-result rejection.
   * When set, the caller can increment this value on each new request;
   * results from an older revision are discarded.
   */
  requestRevision?: number;
}

export interface BackgroundRemovalResult {
  maskDataUrl: string;
  confidence: number;
  method: RemovalMethod;
  processingTimeMs: number;
  width: number;
  height: number;
  /** Which ONNX execution provider succeeded. */
  executionProvider?: 'webgpu' | 'webgl' | 'wasm' | 'native';
  /** ONNX model that produced this result (absent for Quick/cloud providers). */
  modelId?: WorkerModelId;
  /** Precision of the model that produced this result (FP32 or INT8). */
  modelPrecision?: 'fp32' | 'int8';
  /** True when INT8 was attempted but fell back to FP32. */
  precisionFallback?: boolean;
  /** Human-readable reason for precision fallback. */
  precisionFallbackReason?: string;
  /** Raw single-channel mask data at the result's width/height (0-255). */
  rawMask?: Uint8Array;
  /** Source-resolution composited alpha (0-255 per pixel). */
  sourceAlpha?: Uint8Array;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Dimensions and transform used to reconstruct the source-resolution matte. */
  sourceResolutionInfo?: SourceResolutionInfo;
  /**
   * The request revision that produced this result, for stale-result
   * rejection. Callers should compare against their current revision
   * before applying the mask.
   */
  requestRevision?: number;
}

export interface SourceResolutionInfo {
  modelWidth: number;
  modelHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}

export interface ModelMetadata {
  id: string;
  name: string;
  description: string;
  size: number;
  quality: number;
  remoteUrl: string;
  checksum: string;
}

/** ONNX model ids used by the Web Worker inference path. */
export type WorkerModelId =
  | 'u2netp'
  | 'u2netp-int8'
  | 'isnet-general-use'
  | 'birefnet-general-lite'
  | 'birefnet-general';

/** Best installed model for a method. Balanced falls back to bundled U2-Net Light. */
export function preferredWorkerModelIdForMethod(method: RemovalMethod): WorkerModelId | null {
  switch (method) {
    case 'quick':
      return null;
    case 'ai-balanced':
      return 'isnet-general-use';
    case 'ai-quality':
      return 'birefnet-general-lite';
  }
}

/** Map a UI removal method to the ONNX model that should run it.
 *
 * `'ai-balanced'` uses the bundled `u2netp` (4.5 MB, zero-download) so it
 * works out of the box. `'ai-quality'` requires an explicit BiRefNet download.
 */
export function workerModelIdForMethod(method: RemovalMethod): WorkerModelId | null {
  switch (method) {
    case 'quick':
      return null;
    case 'ai-balanced':
      return 'u2netp';
    case 'ai-quality':
      return 'birefnet-general-lite';
  }
}

export interface WorkerCommand {
  type: 'infer';
  /** Unique request ID for correlation between command and result. */
  requestId: string;
  imageData: ImageData;
  modelPath: string;
  modelId: WorkerModelId;
  method: 'ai-balanced' | 'ai-quality';
  /** Gaussian feather radius (px) applied to the upscaled mask before encoding. */
  feather?: number;
  /** Choke the semi-transparent edge halo to reduce background color spill. */
  decontaminate?: boolean;
  /** Downscale source before inference; mask is upscaled to original dimensions. */
  previewMaxDimension?: number;
  /** Reuse a warm ONNX session when switching models is not required. */
  reuseSession?: boolean;
}

export const AVAILABLE_MODELS: ModelMetadata[] = [
  {
    id: 'u2netp',
    name: 'U^2-Net Light',
    description: '4.7 MB — fast preview quality, works on most images',
    size: 4_574_861,
    quality: 3,
    remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    checksum: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
  },
  {
    id: 'isnet-general-use',
    name: 'IS-Net General Use',
    description: '179 MB — enhanced balanced quality for people, animals, vehicles, and objects',
    size: 178_648_008,
    quality: 4,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    checksum: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
  },
  {
    id: 'birefnet-general-lite',
    name: 'BiRefNet Lite',
    description: '224 MB — high quality, handles complex edges',
    size: 224_005_088,
    quality: 4.5,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    checksum: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333',
  },
  {
    id: 'birefnet-general',
    name: 'BiRefNet Full',
    description: '928 MB — best quality, handles hair/fur/transparency',
    size: 972_666_916,
    quality: 5,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
    checksum: '',
  },
];
