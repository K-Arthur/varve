/**
 * Background removal worker pool — warm session reuse + cancellation.
 */
import type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  WorkerCommand,
  WorkerModelId,
} from './types';

interface PoolJob {
  id: number;
  resolve: (r: BackgroundRemovalResult) => void;
  reject: (e: Error) => void;
  abort: AbortController;
  timeout: ReturnType<typeof setTimeout>;
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

function removeJob(job: PoolJob): void {
  const idx = pending.indexOf(job);
  if (idx >= 0) pending.splice(idx, 1);
}

function onWorkerMessage(e: MessageEvent): void {
  if (e.data?.type === 'ready') {
    sessionReady = true;
    return;
  }
  const job = pending.shift();
  if (!job) return;
  clearTimeout(job.timeout);
  if (e.data?.type === 'result') {
    job.resolve(e.data.result as BackgroundRemovalResult);
  } else if (e.data?.type === 'error') {
    job.reject(new Error(String(e.data.message)));
  }
}

function onWorkerError(e: ErrorEvent): void {
  const job = pending.shift();
  if (job) {
    clearTimeout(job.timeout);
    job.reject(new Error(e.message));
  }
  sessionReady = false;
  sharedWorker?.terminate();
  sharedWorker = null;
}

export function cancelAllWorkerJobs(): void {
  for (const job of pending) {
    clearTimeout(job.timeout);
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
  options: BackgroundRemovalOptions,
  modelPath: string,
  modelId: WorkerModelId,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  const worker = getWorker();
  const abort = new AbortController();

  return new Promise((resolve, reject) => {
    if (signal?.aborted || abort.signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const timeout = setTimeout(() => {
      const idx = pending.findIndex((j) => j.reject === wrappedReject);
      if (idx >= 0) pending.splice(idx, 1);
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

    const job: PoolJob = {
      id: nextJobId++,
      resolve: wrappedResolve,
      reject: wrappedReject,
      abort,
      timeout,
    };
    pending.push(job);

    const onAbort = () => {
      removeJob(job);
      clearTimeout(timeout);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    abort.signal.addEventListener('abort', onAbort, { once: true });

    worker.postMessage({
      type: 'infer',
      imageData,
      modelPath,
      modelId,
      reuseSession: sessionReady,
      feather: options.feather,
      decontaminate: options.decontaminate,
      previewMaxDimension: options.previewMaxDimension,
    } satisfies WorkerCommand & { reuseSession?: boolean });
  });
}
