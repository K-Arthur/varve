import type { RasterTraceResult } from '../rasterTrace';
import { tryLoadTraceWasm } from '../wasmLoader';
import type { TraceProvider } from './types';

export const wasmTraceProvider: TraceProvider = {
  id: 'wasm-trace',
  label: 'CPU (WASM)',
  async isAvailable() {
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

    const resultJson = mod.trace_contours_json(
      pixels,
      imageData.width,
      imageData.height,
      threshold,
      minPixels,
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
