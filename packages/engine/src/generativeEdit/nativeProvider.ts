import { isTauriRuntime } from '@varve/platform';
import {
  estimateInferenceReservation,
  getInferenceAdmission,
  type InferenceLease,
} from '../inference/admission';
import { decodeImageBytesToImageData } from '../upscaleProviders/pngDecode';
import { NATIVE_GENERATIVE_MODEL_PROFILE } from './nativeModel';
import { GenerativeEditError, type GenerativeEditMode, type GenerativeEditRequest } from './types';

export interface NativeGenerativeResponse {
  png_base64: string;
  width: number;
  height: number;
  execution_backend: 'native-cpu' | 'native-accelerated' | string;
  processing_time_ms: number;
  warnings: string[];
}

export interface NativeGenerativeResult {
  imageData: ImageData;
  width: number;
  height: number;
  executionProvider: string;
  processingTimeMs: number;
  warnings: string[];
}

function defaultPrompt(mode: GenerativeEditMode): string {
  return mode === 'expand' ? 'seamless continuation of the surrounding scene' : '';
}

function nativeFailure(error: unknown): GenerativeEditError {
  if (error instanceof GenerativeEditError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('cancel')) return new GenerativeEditError('cancelled', message);
  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return new GenerativeEditError('timeout', message);
  }
  if (normalized.includes('out of memory') || normalized.includes('allocation')) {
    return new GenerativeEditError('insufficient-memory', message);
  }
  if (
    normalized.includes('device') ||
    normalized.includes('vulkan') ||
    normalized.includes('metal') ||
    normalized.includes('cuda')
  ) {
    return new GenerativeEditError('device-loss', message);
  }
  return new GenerativeEditError('runtime-failure', message);
}

/**
 * Prompt-capable local provider. The helper executable is supervised by the
 * desktop command, so this adapter transports only pixels/settings and never
 * model bytes or executable paths through the webview.
 */
export const nativeGenerativeProvider = {
  isAvailable(): boolean {
    return isTauriRuntime();
  },

  async infer(request: GenerativeEditRequest): Promise<NativeGenerativeResult> {
    if (request.signal?.aborted) throw new Error('cancelled');
    if (!isTauriRuntime()) throw new Error('Prompt-capable generation requires the desktop app');
    if (!request.modelHandle) {
      throw new GenerativeEditError(
        'missing-model',
        'Install and validate the local diffusion model before generating.',
      );
    }
    const reservationBytes = estimateInferenceReservation({
      width: request.imageData.width,
      height: request.imageData.height,
      outputWidth: request.outputWidth,
      outputHeight: request.outputHeight,
      modelBytes: NATIVE_GENERATIVE_MODEL_PROFILE.minimumMemoryBytes,
    });
    let lease: InferenceLease | undefined;
    try {
      lease = await getInferenceAdmission().acquire({
        kind: 'generation',
        reservationBytes,
        signal: request.signal,
        label: 'generative edit',
      });
      const { invoke } = await import('@tauri-apps/api/core');
      const requestId = `generative-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const cancel = () => {
        void invoke('cancel_generative_edit', { requestId });
      };
      let rejectOnAbort: ((reason: GenerativeEditError) => void) | null = null;
      const abort = () => {
        cancel();
        rejectOnAbort?.(new GenerativeEditError('cancelled', 'cancelled'));
      };
      request.signal?.addEventListener('abort', abort, { once: true });
      let raw: NativeGenerativeResponse;
      try {
        raw = await new Promise<NativeGenerativeResponse>((resolve, reject) => {
          rejectOnAbort = reject;
          if (request.signal?.aborted) {
            abort();
            return;
          }
          void invoke<NativeGenerativeResponse>('generative_edit', {
            options: {
              request_id: requestId,
              model_handle: request.modelHandle,
              image_data: Array.from(request.imageData.data),
              image_w: request.imageData.width,
              image_h: request.imageData.height,
              mask: Array.from(request.mask),
              mask_w: request.maskWidth,
              mask_h: request.maskHeight,
              mode: request.mode,
              prompt: request.prompt?.trim() || defaultPrompt(request.mode),
              negative_prompt: request.negativePrompt ?? '',
              output_w: request.outputWidth ?? request.imageData.width,
              output_h: request.outputHeight ?? request.imageData.height,
              steps: request.steps ?? (request.quality === 'draft' ? 12 : 24),
              guidance_scale: request.guidanceScale ?? 7,
              seed: request.seed ?? -1,
              strength: request.strength ?? (request.mode === 'replace' ? 0.85 : 0.75),
            },
          }).then(resolve, reject);
        });
      } finally {
        rejectOnAbort = null;
        request.signal?.removeEventListener('abort', abort);
      }
      if (request.signal?.aborted) throw new Error('cancelled');
      if (!raw?.png_base64) throw new Error('Native generation returned no image');
      const binary = atob(raw.png_base64);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const imageData = await decodeImageBytesToImageData(bytes);
      if (imageData.width !== raw.width || imageData.height !== raw.height) {
        throw new Error(
          `Native generation dimensions ${imageData.width}x${imageData.height} do not match response ${raw.width}x${raw.height}`,
        );
      }
      return {
        imageData,
        width: raw.width,
        height: raw.height,
        executionProvider: raw.execution_backend || 'native-cpu',
        processingTimeMs: raw.processing_time_ms,
        warnings: raw.warnings ?? [],
      };
    } catch (error) {
      if (request.signal?.aborted) throw new GenerativeEditError('cancelled', 'cancelled');
      throw nativeFailure(error);
    } finally {
      lease?.release();
    }
  },
};
