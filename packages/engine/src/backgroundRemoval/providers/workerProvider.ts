import { resolveWebModel } from '../modelSelection';
import type { BackgroundRemovalOptions, BackgroundRemovalResult } from '../types';
import { workerModelIdForMethod } from '../types';
import { runPooledInference } from '../workerPool';
import type { RemovalProvider } from './types';

export const workerRemovalProvider: RemovalProvider = {
  id: 'worker-onnx',

  isAvailable(_options: BackgroundRemovalOptions): Promise<boolean> {
    if (_options.method === 'quick') return Promise.resolve(false);
    return Promise.resolve(typeof Worker !== 'undefined');
  },

  async remove(
    imageData: ImageData,
    options: BackgroundRemovalOptions,
    signal?: AbortSignal,
  ): Promise<BackgroundRemovalResult> {
    const fallbackModelId = workerModelIdForMethod(options.method);
    if (!fallbackModelId) {
      throw new Error(`No worker model for method: ${options.method}`);
    }
    const { getModelLoader } = await import('../modelLoader');
    const loader = getModelLoader(signal);
    await loader.syncFromStorage(signal);
    const resolved = await resolveWebModel(options.method, loader, signal);
    if (!resolved) throw new Error(`No installed worker model for method: ${options.method}`);
    return runPooledInference(imageData, options, resolved.modelPath, resolved.modelId, signal);
  },
};
