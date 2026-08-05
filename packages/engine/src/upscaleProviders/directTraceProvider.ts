import { type RasterTraceOptions, traceRasterToPaths } from '../rasterTrace';
import type { TraceProvider } from './types';

export const directTraceProvider: TraceProvider = {
  id: 'direct-trace',
  label: 'CPU (main thread)',
  isAvailable(options) {
    // The TS fallback tracer has no skeleton/centerline implementation.
    // Declaring unavailability keeps the capability report honest and lets
    // dispatch skip to a provider that can actually run the mode.
    if (options.traceMode === 'centerline') return false;
    return true;
  },
  async trace(imageData, options: RasterTraceOptions, signal) {
    if (signal?.aborted) throw new Error('cancelled');
    const result = traceRasterToPaths(imageData, options);
    if (signal?.aborted) throw new Error('cancelled');
    return result;
  },
};
