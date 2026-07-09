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
    const loader = (await import('../modelLoader')).getModelLoader();
    await loader.syncFromStorage();
    const path = (await loader.getModelPath(workerModelId)) ?? `/models/${workerModelId}.onnx`;
    return runPooledInference(imageData, options, path, workerModelId, signal);
  },
};
