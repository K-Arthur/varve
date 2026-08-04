import { isTauriRuntime as isTauri } from '@varve/platform';
import { mapNativePathsToTraceResult } from './mapNativePaths';
import { encodeImageDataToPngBytes } from './pngDecode';
import type { TraceProvider } from './types';

export const nativeTraceProvider: TraceProvider = {
  id: 'native-trace',
  label: 'Native (Desktop)',
  isAvailable(_options) {
    if (!isTauri()) return false;
    // Native backend supports monochrome, grayscale, and color tracing.
    return true;
  },
  async trace(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    if (!isTauri()) throw new Error('Native trace requires the desktop app');

    const bytes = await encodeImageDataToPngBytes(imageData);
    if (signal?.aborted) throw new Error('cancelled');

    const { invoke } = await import('@tauri-apps/api/core');
    const paths = await invoke<
      Array<{
        points: Array<{
          x: number;
          y: number;
          handle_in?: [number, number] | null;
          handle_out?: [number, number] | null;
        }>;
        closed: boolean;
        fill?: { r: number; g: number; b: number; a: number } | null;
      }>
    >('trace_image', {
      imageData: Array.from(bytes),
      options: {
        threshold: options.threshold ?? 128,
        min_pixels: options.minArea ?? 4,
        max_colors: options.mode === 'color' ? (options.maxColors ?? 8) : 0,
        foreground: options.foreground ?? 'dark',
        corner_angle: options.cornerAngle ?? 135,
        max_error: options.maxError ?? 1.0,
      },
    });

    if (signal?.aborted) throw new Error('cancelled');
    return mapNativePathsToTraceResult(imageData.width, imageData.height, paths);
  },
};
