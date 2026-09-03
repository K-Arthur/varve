import { isTauriRuntime as isTauri } from '@varve/platform';
import type { RasterTraceOptions } from '../rasterTrace';
import { mapNativePathsToTraceResult } from './mapNativePaths';
import { encodeImageDataToPngBytes } from './pngDecode';
import type { TraceProvider } from './types';

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

interface NativeTraceProgressEvent {
  jobId?: number;
  stage?: string;
  progress?: number;
}

export type TraceProgressFn = (stage: string, progress: number) => void;

/**
 * Native desktop tracing via Tauri `trace_image_binary` (raw PNG request body
 * + options header). Each job carries a monotonic id so the Rust side can
 * report stage progress and honor cancellation through the shared cancel
 * flag — mirroring the upscale provider's lifecycle.
 *
 * Option keys are camelCase — the Rust `TraceImageOptions` contract uses
 * `rename_all = "camelCase"`; snake_case keys would be silently ignored.
 */
export const nativeTraceProvider: TraceProvider = {
  id: 'native-trace',
  label: 'Native (Desktop)',
  isAvailable(options) {
    if (!isTauri()) return false;
    // Native supports every engine mode: monochrome, grayscale, color,
    // pixel-art, and centerline.
    void options;
    return true;
  },
  async trace(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    if (!isTauri()) throw new Error('Native trace requires the desktop app');

    const bytes = await encodeImageDataToPngBytes(imageData);
    if (signal?.aborted) throw new Error('cancelled');

    const [{ invoke }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);

    const jobId = nextJobId();

    await invoke('begin_trace_job', { jobId }).catch(() => {});

    let unlisten: (() => void) | undefined;
    let onAbort: (() => void) | undefined;
    const onProgress = (options as RasterTraceOptions & { onProgress?: TraceProgressFn })
      .onProgress;
    try {
      unlisten = await listen<NativeTraceProgressEvent>('trace:progress', (event) => {
        if (event.payload.jobId !== jobId) return;
        onProgress?.(event.payload.stage ?? '', event.payload.progress ?? 0);
      });
    } catch {
      // Event API unavailable — tracing still works, just without progress.
    }
    onAbort = () => {
      invoke('cancel_trace', { jobId }).catch(() => {});
      unlisten?.();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const wireOptions = {
        threshold: options.threshold ?? 128,
        minPixels: options.minArea ?? 10,
        maxColors: options.mode === 'color' ? (options.maxColors ?? 8) : undefined,
        foreground: options.foreground ?? 'dark',
        cornerAngle: options.cornerAngle ?? 135,
        maxError: options.maxError ?? 1.0,
        simplifyTolerance: options.simplifyTolerance ?? 0.75,
        traceMode: options.traceMode ?? 'silhouette',
        alphaThreshold: options.alphaThreshold ?? 1,
        centerlineWidth: options.centerlineWidth ?? 2,
        centerlinePrune: options.centerlinePrune ?? 4,
        maxPaths: options.maxPaths ?? 1000,
        compoundHoles: options.compoundHoles ?? true,
        jobId,
      };
      const result = await invoke<{
        paths: Array<{
          points: Array<{
            x: number;
            y: number;
            handle_in?: [number, number] | null;
            handle_out?: [number, number] | null;
          }>;
          closed: boolean;
          fill?: { r: number; g: number; b: number; a: number } | null;
          holes?: Array<
            Array<{
              x: number;
              y: number;
              handle_in?: [number, number] | null;
              handle_out?: [number, number] | null;
            }>
          >;
        }>;
        omittedHoles?: number;
      }>('trace_image_binary', arrayBufferForBytes(bytes), {
        headers: { 'x-varve-trace-options': JSON.stringify(wireOptions) },
      });
      if (signal?.aborted) throw new Error('cancelled');
      return mapNativePathsToTraceResult(
        imageData.width,
        imageData.height,
        result.paths,
        result.omittedHoles ?? 0,
        options.traceMode === 'centerline' ? (options.centerlineWidth ?? 2) : undefined,
      );
    } finally {
      unlisten?.();
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
