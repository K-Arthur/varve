import type { UpscaleOptions } from '../imageEnhancement';
import { runUpscaleInWorker } from './enhancementWorkerHost';
import type { UpscaleProvider } from './types';

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/** Off-main-thread CPU or ONNX upscale. */
export const workerUpscaleProvider: UpscaleProvider = {
  id: 'worker-upscale',
  label: 'Worker',
  isAvailable(_options: UpscaleOptions) {
    return workersAvailable();
  },
  upscale(imageData, options, signal) {
    return runUpscaleInWorker(imageData, options, signal);
  },
};
