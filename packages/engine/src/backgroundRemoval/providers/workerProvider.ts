import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import { workerModelIdForMethod } from '../types';
import { runPooledInference } from '../workerPool';
import type { RemovalProvider } from './types';

export const workerRemovalProvider: RemovalProvider = {
  id: 'worker-onnx',

  isAvailable(_options: BackgroundRemovalOptions): boolean {
    return typeof Worker !== 'undefined';
  },

  async remove(
    imageData: ImageData,
    options: BackgroundRemovalOptions,
    signal?: AbortSignal,
  ): Promise<BackgroundRemovalResult> {
    const workerModelId = workerModelIdForMethod(options.method);
    if (!workerModelId) {
      throw new Error(`No worker model for method: ${options.method}`);
    }
    const { getModelLoader } = await import('../modelLoader');
    const loader = getModelLoader(signal);
    await loader.syncFromStorage(signal);
    const path =
      (await loader.getModelPath(workerModelId, signal)) ?? `/models/${workerModelId}.onnx`;
    return runPooledInference(imageData, options, path, workerModelId, signal);
  },
};
