export interface DenoiseTileRequest {
  tensor: Float32Array;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  originalData: Uint8ClampedArray;
  alphaData: Uint8ClampedArray | null;
  strength: number;
  modelId: string;
}

export interface DenoiseTileResult {
  imageData: ImageData;
  executionProvider: string;
  processingTimeMs: number;
}

export interface DenoiseProvider {
  readonly id: string;
  isAvailable(modelId: string): boolean;
  denoise(request: DenoiseTileRequest, signal?: AbortSignal): Promise<DenoiseTileResult>;
}
