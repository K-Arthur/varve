import { isTauriRuntime } from '@strata/platform';
import { encodeImageDataToPngBytes } from '../upscaleProviders/pngDecode';
import type { DenoiseProvider, DenoiseTileRequest, DenoiseTileResult } from './types';

interface NativeDenoiseResponse {
  pngBase64: string;
  width: number;
  height: number;
  processingTimeMs: number;
}

export const nativeDenoiseProvider: DenoiseProvider = {
  id: 'native-scunet',

  isAvailable(modelId: string): boolean {
    return isTauriRuntime() && modelId === 'scunet';
  },

  async denoise(request: DenoiseTileRequest, signal?: AbortSignal): Promise<DenoiseTileResult> {
    const { strength, modelId, originalData, targetWidth, targetHeight } = request;
    if (signal?.aborted) throw new Error('cancelled');

    // The Rust command decodes `imageData` as an encoded image file (via
    // `image::load_from_memory`), not a raw RGBA buffer — it must be
    // PNG-encoded first, same as the native upscale path.
    const sourceImage = new ImageData(
      new Uint8ClampedArray(originalData),
      targetWidth,
      targetHeight,
    );
    const pngBytes = await encodeImageDataToPngBytes(sourceImage);
    if (signal?.aborted) throw new Error('cancelled');

    const { invoke } = await import('@tauri-apps/api/core');
    if (signal?.aborted) throw new Error('cancelled');

    const raw = await invoke<NativeDenoiseResponse>('denoise_image', {
      imageData: Array.from(pngBytes),
      options: { modelId, strength },
    });

    if (signal?.aborted) throw new Error('cancelled');

    const responseBytes = Uint8Array.from(atob(raw.pngBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([responseBytes], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    return {
      imageData: ctx.getImageData(0, 0, bitmap.width, bitmap.height),
      executionProvider: 'native',
      processingTimeMs: raw.processingTimeMs,
    };
  },
};
