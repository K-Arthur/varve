/**
 * Denoise dispatch — compatibility entry point over the shared restoration
 * task dispatch. Denoise runs the validated SCUNet checkpoint through the
 * same provider chain (native -> worker) and tiled orchestrator used by
 * every restoration task; see `restorationProviders/`.
 */
import { dispatchRestorationTask } from '../restorationProviders/dispatch';

export interface DenoiseOptions {
  strength: number;
  modelId?: string;
  tileSize?: number;
  overlap?: number;
  maxDim?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface DenoiseResult {
  denoised: ImageData;
  processingTimeMs: number;
  executionProvider: string;
  tilesUsed: number;
}

export async function dispatchDenoise(
  source: ImageData,
  options: DenoiseOptions,
): Promise<DenoiseResult> {
  const result = await dispatchRestorationTask(source, 'denoise', options.strength, {
    signal: options.signal,
    onProgress: options.onProgress,
    modelId: options.modelId,
    tileSize: options.tileSize,
    overlap: options.overlap,
    maxDim: options.maxDim,
  });
  return {
    denoised: result.imageData,
    processingTimeMs: result.processingTimeMs,
    executionProvider: result.executionProvider,
    tilesUsed: result.tilesUsed,
  };
}

/** Re-export for callers that need the postprocessor directly. */
export { postprocessScunet } from '../inference/models/scunet';
