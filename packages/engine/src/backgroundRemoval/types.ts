/** Default downscale cap for AI inference (mask is upscaled to source dimensions). */
export const DEFAULT_PREVIEW_MAX_DIMENSION = 2048;

export type RemovalMethod = 'quick' | 'ai-balanced' | 'ai-quality';

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
}

export interface BackgroundRemovalResult {
  maskDataUrl: string;
  confidence: number;
  method: RemovalMethod;
  processingTimeMs: number;
  width: number;
  height: number;
  /** Which ONNX execution provider succeeded (Worker/direct AI paths only). */
  executionProvider?: 'webgl' | 'wasm';
  /** Raw single-channel mask data at the result's width/height (0-255).
   *  Set by providers alongside maskDataUrl to avoid redundant PNG decode
   *  during source-resolution reconstruction. */
  rawMask?: Uint8Array;
  /** Source-resolution composited alpha (0-255 per pixel), set when
   *  source dimensions differ from preview dimensions. Reconstructed
   *  via letterbox-aware bilinear interpolation from the model mask. */
  sourceAlpha?: Uint8Array;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Dimensions and transform used to reconstruct the source-resolution matte. */
  sourceResolutionInfo?: SourceResolutionInfo;
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
export type WorkerModelId = 'u2netp' | 'birefnet-general-lite' | 'birefnet-general';

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
    size: 4_700_000,
    quality: 3,
    remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    checksum: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
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
    size: 928_000_000,
    quality: 5,
    remoteUrl:
      'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
    checksum: '',
  },
];
