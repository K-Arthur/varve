import { upscaleImageData } from '../imageEnhancement';
import type { UpscaleProvider } from './types';

/** Main-thread TypeScript CPU upscale (last-resort fallback). */
export const directUpscaleProvider: UpscaleProvider = {
  id: 'direct-cpu',
  label: 'CPU (main thread)',
  isAvailable(options) {
    return options.method !== 'ai';
  },
  async upscale(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    if (options.method === 'ai') {
      throw new Error('AI upscaling requires the Real-ESRGAN worker or native backend');
    }
    const result = upscaleImageData(imageData, options);
    if (signal?.aborted) throw new Error('cancelled');
    return result;
  },
};
