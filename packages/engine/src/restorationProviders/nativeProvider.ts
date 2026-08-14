/**
 * Native restoration provider — Tauri ORT backend for any image model the
 * Rust side knows (`image_model_spec`). The command name remains
 * `denoise_image` for wire compatibility; it routes on model id.
 */

import { isTauriRuntime } from '@varve/platform';
import {
  decodeImageBytesToImageData,
  encodeImageDataToPngBytes,
} from '../upscaleProviders/pngDecode';
import type {
  RestorationTileProvider,
  RestorationTileRequest,
  RestorationTileResult,
} from './types';

interface NativeRestorationResponse {
  pngBase64: string;
  width: number;
  height: number;
  processingTimeMs: number;
}

export const nativeRestorationProvider: RestorationTileProvider = {
  id: 'native-restoration',

  isAvailable(modelId: string): boolean {
    return isTauriRuntime() && modelId !== '';
  },

  async restore(
    request: RestorationTileRequest,
    signal?: AbortSignal,
  ): Promise<RestorationTileResult> {
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

    const raw = await invoke<NativeRestorationResponse>('denoise_image', {
      imageData: Array.from(pngBytes),
      options: { modelId, strength },
    });

    if (signal?.aborted) throw new Error('cancelled');

    const responseBytes = Uint8Array.from(atob(raw.pngBase64), (c) => c.charCodeAt(0));
    const imageData = await decodeImageBytesToImageData(responseBytes);
    if (signal?.aborted) throw new Error('cancelled');

    return {
      imageData,
      executionProvider: 'native',
      processingTimeMs: raw.processingTimeMs,
    };
  },
};
