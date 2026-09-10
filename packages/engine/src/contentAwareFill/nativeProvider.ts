import { isTauriRuntime } from '@varve/platform';
import { decodeImageBytesToImageData } from '../upscaleProviders/pngDecode';

export interface NativeLaMaResponse {
  png_base64: string;
  width: number;
  height: number;
  model_id: string;
  execution_backend: string;
  processing_time_ms: number;
  warnings: string[];
}

export interface NativeLaMaResult {
  imageData: ImageData;
  width: number;
  height: number;
  executionProvider: string;
  processingTimeMs: number;
  warnings: string[];
}

/**
 * Desktop LaMa inference through the Rust ONNX Runtime command.
 *
 * LaMa is intentionally not allowed to fall back to bare WASM: its ~208 MB
 * graph can require substantially more linear memory during session creation
 * than the model file suggests. The native command uses the same downloaded
 * model from the Tauri model store and is not subject to that webview limit.
 */
export const nativeLaMaProvider = {
  isAvailable(): boolean {
    return isTauriRuntime();
  },

  async infer(
    imageData: ImageData,
    mask: Uint8Array,
    signal?: AbortSignal,
  ): Promise<NativeLaMaResult> {
    if (signal?.aborted) throw new Error('cancelled');
    if (!isTauriRuntime()) {
      throw new Error('Native LaMa inference requires the desktop app');
    }

    const { invoke } = await import('@tauri-apps/api/core');
    const raw = await invoke<NativeLaMaResponse>('content_aware_fill', {
      options: {
        image_data: Array.from(imageData.data),
        image_w: imageData.width,
        image_h: imageData.height,
        mask: Array.from(mask),
        mask_w: imageData.width,
        mask_h: imageData.height,
        preview_max_dimension: 2048,
      },
    });

    if (signal?.aborted) throw new Error('cancelled');
    if (!raw?.png_base64) throw new Error('Native LaMa returned no image');

    const binary = atob(raw.png_base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = await decodeImageBytesToImageData(bytes);

    if (decoded.width !== raw.width || decoded.height !== raw.height) {
      throw new Error(
        `Native LaMa dimensions ${decoded.width}x${decoded.height} do not match response ${raw.width}x${raw.height}`,
      );
    }

    return {
      imageData: decoded,
      width: raw.width,
      height: raw.height,
      executionProvider: 'native',
      processingTimeMs: raw.processing_time_ms,
      warnings: raw.warnings ?? [],
    };
  },
};
