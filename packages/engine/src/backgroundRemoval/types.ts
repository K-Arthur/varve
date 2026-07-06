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

/** Map a UI removal method to the ONNX model that should run it. */
export function workerModelIdForMethod(method: RemovalMethod): WorkerModelId | null {
  switch (method) {
    case 'quick':
      return null;
    case 'ai-balanced':
      return 'birefnet-general-lite';
    case 'ai-quality':
      return 'birefnet-general';
  }
}

export interface WorkerCommand {
  type: 'infer';
  imageData: ImageData;
  modelPath: string;
  modelId: WorkerModelId;
  /** Gaussian feather radius (px) applied to the upscaled mask before encoding. */
  feather?: number;
  /** Choke the semi-transparent edge halo to reduce background color spill. */
  decontaminate?: boolean;
}

export const AVAILABLE_MODELS: ModelMetadata[] = [
  {
    id: 'u2netp',
    name: 'U^2-Net Light',
    description: '4.7 MB — fast preview quality, works on most images',
    size: 4_700_000,
    quality: 3,
    remoteUrl: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    checksum: '',
  },
  {
    id: 'birefnet-general-lite',
    name: 'BiRefNet Lite',
    description: '120 MB — high quality, handles complex edges',
    size: 120_000_000,
    quality: 4.5,
    remoteUrl:
      'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1.0/birefnet-general-lite.onnx',
    checksum: '',
  },
  {
    id: 'birefnet-general',
    name: 'BiRefNet Full',
    description: '380 MB — best quality, handles hair/fur/transparency',
    size: 380_000_000,
    quality: 5,
    remoteUrl:
      'https://github.com/ZhengPeng7/BiRefNet/releases/download/v1.0/birefnet-general.onnx',
    checksum: '',
  },
];
