import type { RasterTraceOptions, RasterTraceResult } from '../rasterTrace';
import { tryLoadTraceWasm } from '../wasmLoader';
import type { TraceProvider } from './types';

function wasmSupportsOptions(options: RasterTraceOptions): boolean {
  // The wasm binding currently only supports threshold/foreground monochrome
  // tracing. Pixel-art and centerline are handled by other providers.
  if (options.traceMode === 'centerline') return false;
  if (options.mode === 'pixel-art') return false;
  return (options.mode ?? 'monochrome') === 'monochrome';
}

export const wasmTraceProvider: TraceProvider = {
  id: 'wasm-trace',
  label: 'CPU (WASM)',
  async isAvailable(options) {
    if (!wasmSupportsOptions(options)) return false;
    try {
      const mod = await tryLoadTraceWasm();
      return mod !== null;
    } catch {
      return false;
    }
  },
  async trace(imageData, options, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    const mod = await tryLoadTraceWasm();
    if (!mod) throw new Error('WASM trace module not available');
    if (signal?.aborted) throw new Error('cancelled');

    const pixels = new Uint8Array(imageData.data.buffer);
    const threshold = options.threshold ?? 128;
    const minPixels = options.minArea ?? 4;
    const foreground = options.foreground ?? 'dark';

    if (typeof mod.trace_contours_json !== 'function') {
      throw new Error('WASM trace module missing trace_contours_json');
    }

    const resultJson = mod.trace_contours_json(
      pixels,
      imageData.width,
      imageData.height,
      threshold,
      minPixels,
      foreground === 'light' ? 'light' : 'dark',
    );
    const result: RasterTraceResult = JSON.parse(resultJson);
    return {
      width: result.width,
      height: result.height,
      paths: result.paths.map((p) => ({
        points: p.points.map((pt) => ({ x: pt.x, y: pt.y })),
        closed: true as const,
        area: p.area,
        bounds: p.bounds || { x: 0, y: 0, w: 0, h: 0 },
      })),
      omittedHoles: result.omittedHoles ?? 0,
    };
  },
};
