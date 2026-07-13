import { type RasterTraceOptions, traceRasterToPaths } from '../rasterTrace';
import type { TraceProvider } from './types';

export const directTraceProvider: TraceProvider = {
  id: 'direct-trace',
  label: 'CPU (main thread)',
  isAvailable() {
    return true;
  },
  async trace(imageData, options: RasterTraceOptions, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    const result = traceRasterToPaths(imageData, options);
    if (signal?.aborted) throw new Error('cancelled');
    return result;
  },
};
