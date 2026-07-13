import type { UpscaleOptions } from '../imageEnhancement';
import { DEFAULT_AI_UPSCALE_MODEL_ID } from '../imageEnhancement';
import { decodeImageBytesToImageData, encodeImageDataToPngBytes } from './pngDecode';
import type { UpscaleProvider } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/**
 * Native desktop upscaling via Tauri `upscale_image`.
 * IPC returns PNG bytes (not raw RGBA).
 */
export const nativeUpscaleProvider: UpscaleProvider = {
  id: 'native-upscale',
  label: 'Native (Desktop)',

  isAvailable(_options: UpscaleOptions) {
    return isTauri();
  },

  async upscale(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    if (!isTauri()) {
      throw new Error('Native upscale requires the desktop app');
    }

    const bytes = await encodeImageDataToPngBytes(imageData);
    if (signal?.aborted) throw new Error('cancelled');

    const scale = options.scale ?? 2;
    const method = options.method ?? 'bilinear';
    const { invoke } = await import('@tauri-apps/api/core');
    const resultBytes = await invoke<number[]>('upscale_image', {
      imageData: Array.from(bytes),
      options: {
        scale,
        method,
        modelId: options.modelId ?? DEFAULT_AI_UPSCALE_MODEL_ID,
        maxPixels: options.maxPixels,
        targetWidth: options.targetWidth,
        targetHeight: options.targetHeight,
      },
    });

    if (signal?.aborted) throw new Error('cancelled');
    return decodeImageBytesToImageData(new Uint8Array(resultBytes));
  },
};
