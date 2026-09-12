import { isTauriRuntime } from '@varve/platform';
import {
  estimateInferenceReservation,
  getInferenceAdmission,
  type InferenceLease,
} from '../inference/admission';
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

function validateNativeResponse(response: NativeLaMaResponse, imageData: ImageData): void {
  if (
    !Number.isSafeInteger(response.width) ||
    !Number.isSafeInteger(response.height) ||
    response.width <= 0 ||
    response.height <= 0
  ) {
    throw new Error('Native LaMa returned invalid output dimensions');
  }
  if (response.width !== imageData.width || response.height !== imageData.height) {
    throw new Error(
      `Native LaMa output ${response.width}x${response.height} does not match the requested ${imageData.width}x${imageData.height}`,
    );
  }
  if (typeof response.model_id !== 'string' || response.model_id.trim().length === 0) {
    throw new Error('Native LaMa returned no model id');
  }
  if (
    typeof response.execution_backend !== 'string' ||
    response.execution_backend.trim().length === 0
  ) {
    throw new Error('Native LaMa returned no execution backend');
  }
  if (!Number.isSafeInteger(response.processing_time_ms) || response.processing_time_ms < 0) {
    throw new Error('Native LaMa returned invalid processing time');
  }
  if (
    !Array.isArray(response.warnings) ||
    response.warnings.some((warning) => typeof warning !== 'string')
  ) {
    throw new Error('Native LaMa returned invalid warnings');
  }
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

    const lease: InferenceLease = await getInferenceAdmission().acquire({
      kind: 'other',
      reservationBytes: estimateInferenceReservation({
        width: imageData.width,
        height: imageData.height,
        outputWidth: imageData.width,
        outputHeight: imageData.height,
      }),
      signal,
      label: 'content-aware fill',
    });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const requestId = `lama-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      let rejectOnAbort: ((reason: Error) => void) | null = null;
      const abort = () => {
        void invoke('cancel_content_aware_fill', { requestId });
        rejectOnAbort?.(new Error('cancelled'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      let raw: NativeLaMaResponse;
      try {
        raw = await new Promise<NativeLaMaResponse>((resolve, reject) => {
          rejectOnAbort = reject;
          if (signal?.aborted) {
            abort();
            return;
          }
          void invoke<NativeLaMaResponse>('content_aware_fill', {
            options: {
              request_id: requestId,
              image_data: Array.from(imageData.data),
              image_w: imageData.width,
              image_h: imageData.height,
              mask: Array.from(mask),
              mask_w: imageData.width,
              mask_h: imageData.height,
              preview_max_dimension: 2048,
            },
          }).then(resolve, reject);
        });
      } finally {
        rejectOnAbort = null;
        signal?.removeEventListener('abort', abort);
      }

      if (signal?.aborted) throw new Error('cancelled');
      if (!raw?.png_base64) throw new Error('Native LaMa returned no image');
      validateNativeResponse(raw, imageData);

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
    } finally {
      lease.release();
    }
  },
};
