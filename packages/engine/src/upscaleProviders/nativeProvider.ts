import type { UpscaleOptions } from '../imageEnhancement';
import { DEFAULT_AI_UPSCALE_MODEL_ID } from '../imageEnhancement';
import { decodeImageBytesToImageData, encodeImageDataToPngBytes } from './pngDecode';
import type { UpscaleProvider } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

const MAX_NATIVE_UPSCALE_OUTPUT_PIXELS = 64 * 1024 * 1024;

let lastJobId = 0;

function nextJobId(): number {
  lastJobId = Math.max(lastJobId + 1, Date.now());
  return lastJobId;
}

function arrayBufferForBytes(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function responseBytes(value: ArrayBuffer | number[]): Uint8Array {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
}

/**
 * Native desktop upscaling via Tauri `upscale_image`. IPC returns PNG bytes
 * (not raw RGBA). Each job carries a monotonic id so the Rust side can report
 * per-tile progress and honor cancellation.
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

    // Lazy-import both Tauri modules so the worker/direct paths never load them.
    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);

    // A strictly monotonic id prevents concurrent jobs created in the same
    // millisecond from accepting each other's progress or completion events.
    const jobId = nextJobId();

    // Signal the Rust side that job `jobId` is starting so a later cancel maps
    // to the right in-flight inference.
    await invoke('begin_upscale_job', { jobId }).catch(() => {});

    // Mirror the caller's AbortSignal onto the Rust cancel command so UI
    // cancellation interrupts tile inference. Fires once per cancel signal.
    const onAbort = () => {
      invoke('cancel_upscale', { jobId }).catch(() => {});
      unlisten?.();
      unlistenDone?.();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    // Listen for per-tile progress events; forward to a caller hook if present.
    let unlisten: (() => void) | undefined;
    let unlistenDone: (() => void) | undefined;
    try {
      unlisten = await listen<{ jobId?: number; done?: number; total?: number }>(
        'upscale:progress',
        (event) => {
          if (event.payload.jobId !== jobId) return;
          const onProgress = (options as UpscaleOptions & { onProgress?: ProgressFn }).onProgress;
          onProgress?.(event.payload.done ?? 0, event.payload.total ?? 0);
        },
      );
      unlistenDone = await listen<{ jobId?: number; cancelled?: boolean }>(
        'upscale:done',
        () => {},
      );
    } catch {
      // Event API unavailable — inference still works, just without progress.
    }

    try {
      const wireOptions = {
        scale,
        method,
        modelId: options.modelId ?? DEFAULT_AI_UPSCALE_MODEL_ID,
        maxPixels: Math.min(
          options.maxPixels ?? MAX_NATIVE_UPSCALE_OUTPUT_PIXELS,
          MAX_NATIVE_UPSCALE_OUTPUT_PIXELS,
        ),
        targetWidth: options.targetWidth,
        targetHeight: options.targetHeight,
        jobId,
      };
      // Supplying ArrayBuffer as the invoke body selects Tauri's raw request
      // transport. The compact options object travels as a header, avoiding a
      // JSON number array for both directions of the large payload.
      const resultBytes = await invoke<ArrayBuffer | number[]>(
        'upscale_image_binary',
        arrayBufferForBytes(bytes),
        { headers: { 'x-strata-upscale-options': JSON.stringify(wireOptions) } },
      );
      if (signal?.aborted) throw new Error('cancelled');
      // Current Tauri returns ArrayBuffer for the raw Rust `Response`. Keep
      // number[] support as a compatibility adapter for older desktop builds.
      return decodeImageBytesToImageData(responseBytes(resultBytes));
    } finally {
      unlisten?.();
      unlistenDone?.();
      signal?.removeEventListener('abort', onAbort);
    }
  },
};

export type ProgressFn = (done: number, total: number) => void;
