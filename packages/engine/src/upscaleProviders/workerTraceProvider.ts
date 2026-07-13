import { runTraceInWorker } from './enhancementWorkerHost';
import type { TraceProvider } from './types';

export const workerTraceProvider: TraceProvider = {
  id: 'worker-trace',
  label: 'CPU (worker)',
  isAvailable() {
    return typeof Worker !== 'undefined';
  },
  trace(imageData, options, signal) {
    return runTraceInWorker(imageData, options, signal);
  },
};
