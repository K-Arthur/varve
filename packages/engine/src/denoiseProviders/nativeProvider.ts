import type { DenoiseProvider, DenoiseTileRequest, DenoiseTileResult } from './types';

interface NativeDenoiseResponse {
  pngBase64: string;
  width: number;
  height: number;
  processingTimeMs: number;
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export const nativeDenoiseProvider: DenoiseProvider = {
  id: 'native-scunet',

  isAvailable(modelId: string): boolean {
    return isTauriRuntime() && modelId === 'scunet';
  },

  async denoise(request: DenoiseTileRequest, signal?: AbortSignal): Promise<DenoiseTileResult> {
    const { strength, modelId } = request;
    if (signal?.aborted) throw new Error('cancelled');

    const { invoke } = await import('@tauri-apps/api/core');
    if (signal?.aborted) throw new Error('cancelled');

    const raw = await invoke<NativeDenoiseResponse>('denoise_image', {
      imageData: Array.from(request.originalData),
      options: { modelId, strength },
    });

    if (signal?.aborted) throw new Error('cancelled');

    const pngBytes = Uint8Array.from(atob(raw.pngBase64), (c) => c.charCodeAt(0));
    const blob = new Blob([pngBytes], { type: 'image/png' });
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
