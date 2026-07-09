/**
 * Background removal inference worker pool — multi-worker, load-balanced.
 *
 * Architecture:
 * - N workers (default = clamp(hardwareConcurrency / 2, 1, 4))
 * - Round-robin dispatch to the least-loaded worker
 * - Each worker maintains a warm ONNX session for its assigned model
 * - Shared cancellation across all workers
 * - Per-job timeout: 10s for cold start, 60s for warm session
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
  workerIndex: number;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  ready: boolean;
  jobCount: number;
}

let nextJobId = 1;
let pool: PoolWorker[] | null = null;
const pending: PoolJob[] = [];

/** Determine the ideal number of inference workers. */
export function getIdealWorkerCount(): number {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return Math.max(1, Math.min(4, Math.floor(navigator.hardwareConcurrency / 2)));
  }
  return 2;
}

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') {
    return null;
  }
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function initPool(): PoolWorker[] {
  if (!pool) {
    if (typeof Worker === 'undefined') {
      pool = [];
      return pool;
    }
    const count = getIdealWorkerCount();
    pool = [];
    for (let i = 0; i < count; i++) {
      const w = createWorker()!;
      const pw: PoolWorker = { worker: w, busy: false, ready: false, jobCount: 0 };
      w.addEventListener('message', (e: MessageEvent) => onWorkerMessage(e, pw));
      w.addEventListener('error', (e: ErrorEvent) => onWorkerError(e, pw));
      pool.push(pw);
    }
  }
  return pool;
}

function getPool(): PoolWorker[] {
  return initPool();
}

function findLeastLoadedWorker(): PoolWorker | null {
  const workers = getPool();
  let best: PoolWorker | null = null;
  let minJobs = Infinity;
  for (const w of workers) {
    if (!w.busy && w.jobCount < minJobs) {
      best = w;
      minJobs = w.jobCount;
    }
  }
  return best;
}

function onWorkerMessage(e: MessageEvent, pw: PoolWorker): void {
  if (e.data?.type === 'ready') {
    pw.ready = true;
    return;
  }
  const jobIdx = pending.findIndex((j) => j.workerIndex === getPool().indexOf(pw));
  if (jobIdx < 0) return;
  const [job] = pending.splice(jobIdx, 1);
  if (!job) return;
  clearTimeout(job.timeout);
  pw.busy = false;
  pw.jobCount = Math.max(0, pw.jobCount - 1);
  if (e.data?.type === 'result') {
    job.resolve(e.data.result as BackgroundRemovalResult);
  } else if (e.data?.type === 'error') {
    job.reject(new Error(String(e.data.message)));
  }
  // Process next queued job if any
  processQueue();
}

function onWorkerError(e: ErrorEvent, pw: PoolWorker): void {
  const jobIdx = pending.findIndex((j) => j.workerIndex === getPool().indexOf(pw));
  if (jobIdx >= 0) {
    const [job] = pending.splice(jobIdx, 1);
    if (job) {
      clearTimeout(job.timeout);
      job.reject(new Error(e.message));
    }
  }
  pw.ready = false;
  pw.busy = false;
  // Replace the dead worker
  const idx = getPool().indexOf(pw);
  if (idx >= 0) {
    pw.worker.terminate();
    const newWorker = createWorker()!;
    newWorker.addEventListener('message', (msg: MessageEvent) => onWorkerMessage(msg, pw));
    newWorker.addEventListener('error', (err: ErrorEvent) => onWorkerError(err, pw));
    pw.worker = newWorker;
  }
  processQueue();
}

function processQueue(): void {
  while (pending.length > 0) {
    const next = findLeastLoadedWorker();
    if (!next) break;
    const jobIdx = pending.findIndex((j) => !j.workerIndex && j.workerIndex === undefined);
    const job = jobIdx >= 0 ? pending[jobIdx] : pending[0];
    if (!job) break;
    const actualIdx = pending.indexOf(job);
    if (actualIdx >= 0) {
      pending.splice(actualIdx, 1);
    }
    next.busy = true;
    next.jobCount++;
    const workerIndex = getPool().indexOf(next);
    const updatedJob: PoolJob = { ...job, workerIndex };
    const msgIdx = pending.findIndex((j) => j.id === job.id);
    if (msgIdx >= 0) pending.splice(msgIdx, 1);
    pending.push(updatedJob);
    next.worker.postMessage({
      type: 'infer',
      imageData: (job as any)._imageData,
      modelPath: (job as any)._modelPath,
      modelId: (job as any)._modelId,
      reuseSession: next.ready,
      feather: (job as any)._feather,
      decontaminate: (job as any)._decontaminate,
      previewMaxDimension: (job as any)._previewMaxDimension,
    } satisfies WorkerCommand & { reuseSession?: boolean });
  }
}

export function cancelAllWorkerJobs(): void {
  for (const job of pending) {
    clearTimeout(job.timeout);
    job.abort.abort();
    job.reject(new Error('cancelled'));
  }
  pending.length = 0;
  const workers = getPool();
  for (const pw of workers) {
    pw.busy = false;
  }
}

export function terminateWorkerPool(): void {
  cancelAllWorkerJobs();
  if (pool) {
    for (const pw of pool) {
      pw.worker.terminate();
    }
    pool = null;
  }
}

export async function runPooledInference(
  imageData: ImageData,
  options: BackgroundRemovalOptions,
  modelPath: string,
  modelId: WorkerModelId,
  signal?: AbortSignal,
): Promise<BackgroundRemovalResult> {
  initPool();
  const abort = new AbortController();

  return new Promise((resolve, reject) => {
    if (signal?.aborted || abort.signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    // Find the least-loaded ready worker first; failing that, any idle worker
    let target = findLeastLoadedWorker();
    if (!target) {
      // All busy — queue the job; will be dispatched when a worker frees up
      // (processQueue is called from onWorkerMessage / onWorkerError)
      const timeoutMs = 120_000;
      const timeout = setTimeout(() => {
        const idx = pending.findIndex((j) => j.reject === wrappedReject);
        if (idx >= 0) pending.splice(idx, 1);
        reject(new Error('All workers busy — inference timed out'));
      }, timeoutMs);

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
        workerIndex: -1,
      };
      (job as any)._imageData = imageData;
      (job as any)._modelPath = modelPath;
      (job as any)._modelId = modelId;
      (job as any)._feather = options.feather;
      (job as any)._decontaminate = options.decontaminate;
      (job as any)._previewMaxDimension = options.previewMaxDimension;

      pending.push(job);

      const onAbort = () => {
        const idx = pending.indexOf(job);
        if (idx >= 0) pending.splice(idx, 1);
        clearTimeout(timeout);
        reject(new Error('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      abort.signal.addEventListener('abort', onAbort, { once: true });
      return;
    }

    target.busy = true;
    target.jobCount++;
    const workerIndex = getPool().indexOf(target);

    // Determine timeout: cold start (first inference on this worker) vs warm
    const timeoutMs = target.ready ? 60_000 : 10_000;
    const timeout = setTimeout(() => {
      const idx = pending.findIndex((j) => j.reject === wrappedReject);
      if (idx >= 0) pending.splice(idx, 1);
      target!.busy = false;
      target!.jobCount = Math.max(0, target!.jobCount - 1);
      if (!target!.ready) {
        // Cold start timeout — replace the hung worker
        const idx2 = getPool().indexOf(target!);
        if (idx2 >= 0) {
          target!.worker.terminate();
          const newWorker = createWorker()!;
          newWorker.addEventListener('message', (msg: MessageEvent) =>
            onWorkerMessage(msg, target!),
          );
          newWorker.addEventListener('error', (err: ErrorEvent) => onWorkerError(err, target!));
          target!.worker = newWorker;
        }
      }
      reject(new Error('Worker inference timed out'));
    }, timeoutMs);

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
      workerIndex,
    };
    pending.push(job);

    const onAbort = () => {
      const idx = pending.indexOf(job);
      if (idx >= 0) pending.splice(idx, 1);
      clearTimeout(timeout);
      target!.busy = false;
      target!.jobCount = Math.max(0, target!.jobCount - 1);
      reject(new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    abort.signal.addEventListener('abort', onAbort, { once: true });

    target.worker.postMessage({
      type: 'infer',
      imageData,
      modelPath,
      modelId,
      reuseSession: target.ready,
      feather: options.feather,
      decontaminate: options.decontaminate,
      previewMaxDimension: options.previewMaxDimension,
    } satisfies WorkerCommand & { reuseSession?: boolean });
  });
}

// Test utilities (used by workerPool.test.ts)
export function __getPool(): PoolWorker[] {
  return initPool();
}
export function __getPending(): PoolJob[] {
  return pending;
}
export function __getIdealWorkerCount(): number {
  return getIdealWorkerCount();
}

export type { PoolWorker, PoolJob };
