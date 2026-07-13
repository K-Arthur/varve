/**
 * Background removal inference worker pool — multi-worker, load-balanced.
 *
 * Architecture:
 * - N workers (default = clamp(hardwareConcurrency / 2, 1, 2))
 * - Round-robin dispatch to the least-loaded worker
 * - Each worker maintains a warm ONNX session for its assigned model
 * - Shared cancellation across all workers
 * - Per-job timeout: 120s, including a large-model cold start
 */
import type {
  BackgroundRemovalOptions,
  BackgroundRemovalResult,
  WorkerCommand,
  WorkerModelId,
} from './types';

/** Sentinel indicating a job is queued but not yet assigned to a worker. */
const UNASSIGNED = -1;

interface PoolJob {
  id: number;
  resolve: (r: BackgroundRemovalResult) => void;
  reject: (e: Error) => void;
  abort: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  /** Index of the worker this job is dispatched to; -1 while queued. */
  workerIndex: number;
  imageData: ImageData;
  modelPath: string;
  modelId: WorkerModelId;
  method: 'ai-balanced' | 'ai-quality';
  feather?: number;
  decontaminate?: boolean;
  previewMaxDimension?: number;
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
    return Math.max(1, Math.min(2, Math.floor(navigator.hardwareConcurrency / 2)));
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

function findIdleWorker(): PoolWorker | null {
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

  const workerIndex = getPool().indexOf(pw);
  const jobIdx = pending.findIndex((j) => j.workerIndex === workerIndex);
  if (jobIdx < 0) {
    // Defensive: a message arrived for a job that already timed out or was
    // cancelled. Release the worker so it doesn't become permanently busy.
    pw.busy = false;
    pw.jobCount = Math.max(0, pw.jobCount - 1);
    processQueue();
    return;
  }

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
  const workerIndex = getPool().indexOf(pw);
  const jobIdx = pending.findIndex((j) => j.workerIndex === workerIndex);
  if (jobIdx >= 0) {
    const [job] = pending.splice(jobIdx, 1);
    if (job) {
      clearTimeout(job.timeout);
      job.reject(new Error(e.message));
    }
  }
  pw.ready = false;
  pw.busy = false;
  pw.jobCount = Math.max(0, pw.jobCount - 1);
  // Replace the dead worker
  if (workerIndex >= 0) {
    pw.worker.terminate();
    const newWorker = createWorker()!;
    newWorker.addEventListener('message', (msg: MessageEvent) => onWorkerMessage(msg, pw));
    newWorker.addEventListener('error', (err: ErrorEvent) => onWorkerError(err, pw));
    pw.worker = newWorker;
  }
  processQueue();
}

function dispatchJobToWorker(job: PoolJob, worker: PoolWorker, workerIndex: number): void {
  job.workerIndex = workerIndex;
  worker.busy = true;
  worker.jobCount++;
  worker.worker.postMessage({
    type: 'infer',
    imageData: job.imageData,
    modelPath: job.modelPath,
    modelId: job.modelId,
    method: job.method,
    reuseSession: worker.ready,
    feather: job.feather,
    decontaminate: job.decontaminate,
    previewMaxDimension: job.previewMaxDimension,
  } satisfies WorkerCommand & { reuseSession?: boolean });
}

function processQueue(): void {
  while (pending.length > 0) {
    const next = findIdleWorker();
    if (!next) break;

    const jobIdx = pending.findIndex((j) => j.workerIndex === UNASSIGNED);
    if (jobIdx < 0) break;

    const [job] = pending.splice(jobIdx, 1);
    if (!job) break;

    const workerIndex = getPool().indexOf(next);
    pending.push(job);
    dispatchJobToWorker(job, next, workerIndex);
  }
}

export function cancelAllWorkerJobs(): void {
  const jobs = pending.slice();
  pending.length = 0;
  const workers = getPool();
  for (const pw of workers) {
    pw.busy = false;
    pw.jobCount = 0;
  }
  // Reject after clearing, so the abort handler does not try to remove
  // the job from a now-empty pending list (avoids double-reject).
  for (const job of jobs) {
    clearTimeout(job.timeout);
    job.reject(new Error('cancelled'));
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

    const jobBase: Omit<PoolJob, 'id' | 'resolve' | 'reject' | 'timeout' | 'workerIndex'> = {
      abort,
      imageData,
      modelPath,
      modelId,
      method: options.method === 'ai-quality' ? 'ai-quality' : 'ai-balanced',
      feather: options.feather,
      decontaminate: options.decontaminate,
      previewMaxDimension: options.previewMaxDimension,
    };

    // Find an idle worker; if none, queue the job.
    const target = findIdleWorker();
    if (!target) {
      const timeoutMs = options.method === 'ai-quality' ? 300_000 : 120_000;
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
        ...jobBase,
        id: nextJobId++,
        resolve: wrappedResolve,
        reject: wrappedReject,
        timeout,
        workerIndex: UNASSIGNED,
      };

      pending.push(job);

      const onAbort = () => {
        const idx = pending.indexOf(job);
        if (idx >= 0) pending.splice(idx, 1);
        clearTimeout(timeout);
        reject(new Error('cancelled'));
        processQueue();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      abort.signal.addEventListener('abort', onAbort, { once: true });
      return;
    }

    const workerIndex = getPool().indexOf(target);

    // Determine timeout: cold start (first inference on this worker) vs warm
    const timeoutMs = options.method === 'ai-quality' ? 300_000 : 120_000;
    const timeout = setTimeout(() => {
      const idx = pending.findIndex((j) => j.reject === wrappedReject);
      if (idx >= 0) pending.splice(idx, 1);
      target.busy = false;
      target.jobCount = Math.max(0, target.jobCount - 1);
      if (!target.ready) {
        // Cold start timeout — replace the hung worker
        const workerIdx = getPool().indexOf(target);
        if (workerIdx >= 0) {
          target.worker.terminate();
          const newWorker = createWorker()!;
          newWorker.addEventListener('message', (msg: MessageEvent) =>
            onWorkerMessage(msg, target),
          );
          newWorker.addEventListener('error', (err: ErrorEvent) => onWorkerError(err, target));
          target.worker = newWorker;
        }
      }
      reject(new Error('Worker inference timed out'));
      processQueue();
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
      ...jobBase,
      id: nextJobId++,
      resolve: wrappedResolve,
      reject: wrappedReject,
      timeout,
      workerIndex,
    };
    pending.push(job);

    const onAbort = () => {
      const idx = pending.indexOf(job);
      if (idx >= 0) pending.splice(idx, 1);
      clearTimeout(timeout);
      target.busy = false;
      target.jobCount = Math.max(0, target.jobCount - 1);
      reject(new Error('cancelled'));
      processQueue();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    abort.signal.addEventListener('abort', onAbort, { once: true });

    dispatchJobToWorker(job, target, workerIndex);
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

export type { PoolJob, PoolWorker };
