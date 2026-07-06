/**
 * Background removal worker pool — warm session reuse + cancellation.
 */
import type { BackgroundRemovalOptions, BackgroundRemovalResult, WorkerCommand } from './types';

interface PoolJob {
  id: number;
  resolve: (r: BackgroundRemovalResult) => void;
  reject: (e: Error) => void;
  abort: AbortController;
}

let nextJobId = 1;
let sharedWorker: Worker | null = null;
let sessionReady = false;
const pending: PoolJob[] = [];

function getWorker(): Worker {
  if (!sharedWorker) {
    sharedWorker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    sharedWorker.addEventListener('message', onWorkerMessage);
    sharedWorker.addEventListener('error', onWorkerError);
  }
  return sharedWorker;
}

function onWorkerMessage(e: MessageEvent): void {
  if (e.data?.type === 'ready') {
    sessionReady = true;
    return;
  }
  const job = pending.shift();
  if (!job) return;
  if (e.data?.type === 'result') {
    job.resolve(e.data.result as BackgroundRemovalResult);
  } else if (e.data?.type === 'error') {
    job.reject(new Error(String(e.data.message)));
  }
}

function onWorkerError(e: ErrorEvent): void {
  const job = pending.shift();
  job?.reject(new Error(e.message));
  sessionReady = false;
  sharedWorker?.terminate();
  sharedWorker = null;
}

export function cancelAllWorkerJobs(): void {
  for (const job of pending) {
    job.abort.abort();
    job.reject(new Error('cancelled'));
  }
  pending.length = 0;
}

export function terminateWorkerPool(): void {
  cancelAllWorkerJobs();
  sharedWorker?.terminate();
  sharedWorker = null;
  sessionReady = false;
}

export async function runPooledInference(
  imageData: ImageData,
  _options: BackgroundRemovalOptions,
  modelPath: string,
  modelId: 'u2netp' | 'birefnet-general-lite',
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  const worker = getWorker();
  const abort = new AbortController();
  signal?.addEventListener('abort', () => abort.abort());

  return new Promise((resolve, reject) => {
    if (abort.signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }
    const job: PoolJob = { id: nextJobId++, resolve, reject, abort };
    pending.push(job);

    const timeout = setTimeout(() => {
      reject(new Error('Worker inference timed out'));
    }, 60_000);

    const wrappedResolve = (r: BackgroundRemovalResult) => {
      clearTimeout(timeout);
      resolve(r);
    };
    const wrappedReject = (e: Error) => {
      clearTimeout(timeout);
      reject(e);
    };
    job.resolve = wrappedResolve;
    job.reject = wrappedReject;

    worker.postMessage({
      type: 'infer',
      imageData,
      modelPath,
      modelId,
      reuseSession: sessionReady,
    } satisfies WorkerCommand & { reuseSession?: boolean });
  });
}
