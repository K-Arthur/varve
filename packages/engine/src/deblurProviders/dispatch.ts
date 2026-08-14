/**
 * Deblur dispatch — NAFNet deblur (GoPro checkpoint) through the shared
 * restoration task dispatch. Uses the same provider chain and tiled
 * orchestrator as denoise; tile policy (768/128) favours context over
 * throughput because deblur needs wider receptive field than denoise.
 */
import { dispatchRestorationTask, NAFNET_DEBLUR_GOPRO_ID } from '../restorationProviders/dispatch';

export interface DeblurOptions {
  strength?: number;
  tileSize?: number;
  overlap?: number;
  maxDim?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface DeblurResult {
  deblurred: ImageData;
  processingTimeMs: number;
  executionProvider: string;
  tilesUsed: number;
  modelId: string;
}

export async function dispatchDeblur(
  source: ImageData,
  options: DeblurOptions = {},
): Promise<DeblurResult> {
  const result = await dispatchRestorationTask(source, 'deblur', options.strength ?? 0.7, {
    signal: options.signal,
    onProgress: options.onProgress,
    tileSize: options.tileSize,
    overlap: options.overlap,
    maxDim: options.maxDim,
  });
  return {
    deblurred: result.imageData,
    processingTimeMs: result.processingTimeMs,
    executionProvider: result.executionProvider,
    tilesUsed: result.tilesUsed,
    modelId: NAFNET_DEBLUR_GOPRO_ID,
  };
}
