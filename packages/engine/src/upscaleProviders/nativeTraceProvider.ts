import { mapNativePathsToTraceResult } from './mapNativePaths';
import { encodeImageDataToPngBytes } from './pngDecode';
import type { TraceProvider } from './types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export const nativeTraceProvider: TraceProvider = {
  id: 'native-trace',
  label: 'Native (Desktop)',
  isAvailable(options) {
    if (!isTauri()) return false;
    // Native backend currently only supports monochrome threshold/foreground tracing.
    return (options.mode ?? 'monochrome') === 'monochrome';
  },
  async trace(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    if (!isTauri()) throw new Error('Native trace requires the desktop app');

    const bytes = await encodeImageDataToPngBytes(imageData);
    if (signal?.aborted) throw new Error('cancelled');

    const { invoke } = await import('@tauri-apps/api/core');
    const paths = await invoke<Array<{ points: Array<{ x: number; y: number }>; closed: boolean }>>(
      'trace_image',
      {
        imageData: Array.from(bytes),
        options: {
          threshold: options.threshold ?? 128,
          min_pixels: options.minArea ?? 4,
          max_colors: 0,
          foreground: options.foreground ?? 'dark',
        },
      },
    );

    if (signal?.aborted) throw new Error('cancelled');
    return mapNativePathsToTraceResult(imageData.width, imageData.height, paths);
  },
};
