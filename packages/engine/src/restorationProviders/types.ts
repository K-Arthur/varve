/**
 * Shared provider contracts for tiled restoration inference (denoise,
 * deblur, compression restoration). One provider chain, one lifecycle:
 * providers are dumb tensor executors keyed by model id; all model
 * semantics (channel order, padding, alpha, strength blending) live in
 * the task adapter so no task knowledge leaks into the runtimes.
 */

export type RestorationModelKind = 'scunet' | 'nafnet';

export type RestorationTask = 'denoise' | 'deblur' | 'compression-restoration';

export interface RestorationTileRequest {
  /** NCHW float32 tensor, already padded and in the model's channel order. */
  tensor: Float32Array;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  originalData: Uint8ClampedArray;
  alphaData: Uint8ClampedArray | null;
  /** Blend factor between the original tile and the restored tile. */
  strength: number;
  modelId: string;
}

export interface RestorationTileResult {
  imageData: ImageData;
  executionProvider: string;
  processingTimeMs: number;
}

export interface RestorationTileProvider {
  readonly id: string;
  isAvailable(modelId: string): boolean;
  restore(request: RestorationTileRequest, signal?: AbortSignal): Promise<RestorationTileResult>;
}

/** Model id -> worker model type mapping (mirrors inferenceWorker registry). */
export function workerModelTypeForModel(modelId: string): string {
  return modelId === 'scunet' ? 'scunet' : 'nafnet';
}
