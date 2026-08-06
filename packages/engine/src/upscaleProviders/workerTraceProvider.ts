import { runTraceInWorker } from './enhancementWorkerHost';
import type { TraceProvider } from './types';

export const workerTraceProvider: TraceProvider = {
  id: 'worker-trace',
  label: 'CPU (worker)',
  isAvailable(options) {
    if (typeof Worker === 'undefined') return false;
    // The worker runs the TS fallback tracer, which has no centerline
    // implementation; only the native engine supports centerline.
    if (options.traceMode === 'centerline') return false;
    return true;
  },
  trace(imageData, options, signal) {
    return runTraceInWorker(imageData, options, signal);
  },
};
