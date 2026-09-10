/**
 * Background removal inference worker pool — multi-worker, load-balanced.
 *
 * Architecture:
 * - N workers (default = clamp(hardwareConcurrency / 2, 1, 2))
 * - Round-robin dispatch to the least-loaded worker
 * - Each worker maintains a warm ONNX session for its assigned model
 * - Shared cancellation across all workers
 * - Per-job timeout: 120s, including a large-model cold start
 *
 * Revision safety:
 * - Every command/result carries a request ID for correlation
 * - Each worker tracks a generation counter; late results from old
 *   generations are silently discarded
 * - Abort listeners are removed when a request settles
 */

import { generateRequestId } from './protocol';
import type { BackgroundRemovalOptions, BackgroundRemovalResult, WorkerModelId } from './types';

/** Sentinel indicating a job is queued but not yet assigned to a worker. */
const UNASSIGNED = -1;

interface PoolJob {
  id: number;
  requestId: string;
  resolve: (r: BackgroundRemovalResult) => void;
  reject: (e: Error) => void;
  abort: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  /** Index of the worker this job is dispatched to; -1 while queued. */
  workerIndex: number;
  /** Worker generation at dispatch time; stale results are rejected. */
  generation: number;
  imageData: ImageData;
  modelPath: string;
  modelId: WorkerModelId;
  method: 'ai-balanced' | 'ai-quality';
  feather?: number;
  decontaminate?: boolean;
  previewMaxDimension?: number;
  /** Abort signal event listeners — removed on settle to prevent leaks. */
  abortListeners: Array<{ signal: AbortSignal; handler: () => void }>;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  ready: boolean;
  jobCount: number;
  /** Incremented on worker replacement so stale results are rejected. */
  generation: number;
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
      const pw: PoolWorker = {
        worker: w,
        busy: false,
        ready: false,
        jobCount: 0,
        generation: 0,
      };
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

function hasActiveQualityJob(): boolean {
  return pending.some((job) => job.method === 'ai-quality' && job.workerIndex !== UNASSIGNED);
}

/**
 * Remove abort signal listeners registered for a job.
 * Called when a job settles (resolves/rejects) to prevent memory leaks.
 */
function cleanupAbortListeners(job: PoolJob): void {
  for (const { signal, handler } of job.abortListeners) {
    signal.removeEventListener('abort', handler);
  }
  job.abortListeners.length = 0;
}

/**
 * Settle a job: clean up listeners, remove from pending, resolve/reject.
 * This is the single exit point for all job completions.
 */
function settleJob(
  job: PoolJob,
  pw: PoolWorker,
  result: BackgroundRemovalResult | null,
  error: Error | null,
): void {
  cleanupAbortListeners(job);
  clearTimeout(job.timeout);

  // Remove from pending
  const idx = pending.indexOf(job);
  if (idx >= 0) pending.splice(idx, 1);

  pw.busy = false;
  pw.jobCount = Math.max(0, pw.jobCount - 1);

  if (error) {
    job.reject(error);
  } else if (result) {
    job.resolve(result);
  }

  processQueue();
}

function onWorkerMessage(e: MessageEvent, pw: PoolWorker): void {
  if (e.data?.type === 'ready') {
    pw.ready = true;
    return;
  }

  const data = e.data as
    | { type: string; requestId?: string; result?: unknown; message?: string }
    | undefined;
  if (!data?.requestId) return;

  // Find job by requestId (not workerIndex) to prevent race conditions
  const jobIdx = pending.findIndex((j) => j.requestId === data.requestId);
  if (jobIdx < 0) {
    // Stale message from a cancelled/timed-out job — silently discard.
    // Release the worker if it's not serving any other job.
    if (pw.busy) {
      pw.busy = false;
      pw.jobCount = Math.max(0, pw.jobCount - 1);
      processQueue();
    }
    return;
  }

  const job = pending[jobIdx]!;
  // Generation check: reject results from old workers after replacement
  if (job.generation !== pw.generation) {
    settleJob(job, pw, null, new Error('generation-mismatch: stale result from previous worker'));
    return;
  }

  if (data.type === 'result') {
    settleJob(job, pw, data.result as BackgroundRemovalResult, null);
  } else if (data.type === 'error') {
    settleJob(job, pw, null, new Error(String(data.message)));
  }
}

function onWorkerError(e: ErrorEvent, pw: PoolWorker): void {
  const workerIndex = getPool().indexOf(pw);
  // Find any job assigned to this worker
  const jobIdx = pending.findIndex(
    (j) => j.workerIndex === workerIndex && j.generation === pw.generation,
  );
  if (jobIdx >= 0) {
    settleJob(pending[jobIdx]!, pw, null, new Error(e.message));
  } else {
    pw.ready = false;
    pw.busy = false;
    pw.jobCount = Math.max(0, pw.jobCount - 1);
  }

  // Replace the dead worker
  if (workerIndex >= 0) {
    replaceWorker(pw);
  }
  processQueue();
}

/**
 * Replace a worker, incrementing its generation so stale results are rejected.
 */
function replaceWorker(pw: PoolWorker): void {
  pw.worker.terminate();
  pw.generation++;
  pw.ready = false;
  const newWorker = createWorker()!;
  newWorker.addEventListener('message', (msg: MessageEvent) => onWorkerMessage(msg, pw));
  newWorker.addEventListener('error', (err: ErrorEvent) => onWorkerError(err, pw));
  pw.worker = newWorker;
}

function dispatchJobToWorker(job: PoolJob, worker: PoolWorker, workerIndex: number): void {
  job.workerIndex = workerIndex;
  job.generation = worker.generation;
  worker.busy = true;
  worker.jobCount++;
  // Transfer the ImageData buffer to avoid doubling peak RAM in the main
  // thread. After transfer, job.imageData.data is detached (zero-length), but
  // the job object is only used for completion routing and never reads pixels.
  const transfer = [job.imageData.data.buffer];
  worker.worker.postMessage(
    {
      type: 'infer',
      requestId: job.requestId,
      imageData: job.imageData,
      modelPath: job.modelPath,
      modelId: job.modelId,
      method: job.method,
      reuseSession: worker.ready,
      feather: job.feather,
      decontaminate: job.decontaminate,
      previewMaxDimension: job.previewMaxDimension,
    },
    transfer,
  );
}

function processQueue(): void {
  while (pending.length > 0) {
    const jobIdx = pending.findIndex(
      (job) =>
        job.workerIndex === UNASSIGNED && (job.method !== 'ai-quality' || !hasActiveQualityJob()),
    );
    if (jobIdx < 0) break;

    const next = findIdleWorker();
    if (!next) break;

    const [job] = pending.splice(jobIdx, 1);
    if (!job) break;

    const workerIndex = getPool().indexOf(next);
    pending.push(job);
    dispatchJobToWorker(job, next, workerIndex);
  }
}

function cancelJob(job: PoolJob, error: Error): void {
  if (job.workerIndex === UNASSIGNED) {
    cleanupAbortListeners(job);
    clearTimeout(job.timeout);
    const index = pending.indexOf(job);
    if (index >= 0) pending.splice(index, 1);
    job.reject(error);
    processQueue();
    return;
  }

  const worker = getPool()[job.workerIndex];
  if (!worker || worker.generation !== job.generation) {
    cleanupAbortListeners(job);
    clearTimeout(job.timeout);
    const index = pending.indexOf(job);
    if (index >= 0) pending.splice(index, 1);
    job.reject(error);
    processQueue();
    return;
  }

  // ONNX Runtime cannot interrupt an active session.run. Terminate and
  // replace the worker before making the slot available; otherwise a second
  // job can overlap the cancelled inference and its late result can corrupt
  // pool bookkeeping.
  replaceWorker(worker);
  settleJob(job, worker, null, error);
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
    cleanupAbortListeners(job);
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
  const requestId = generateRequestId();

  return new Promise((resolve, reject) => {
    if (signal?.aborted || abort.signal.aborted) {
      reject(new Error('cancelled'));
      return;
    }

    const jobBase: Omit<
      PoolJob,
      | 'id'
      | 'requestId'
      | 'resolve'
      | 'reject'
      | 'timeout'
      | 'workerIndex'
      | 'generation'
      | 'abortListeners'
    > = {
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
    const target =
      options.method === 'ai-quality' && hasActiveQualityJob() ? null : findIdleWorker();
    if (!target) {
      const timeoutMs = options.method === 'ai-quality' ? 300_000 : 120_000;
      const timeout = setTimeout(() => {
        const idx = pending.findIndex((j) => j.requestId === requestId);
        if (idx >= 0) {
          cancelJob(pending[idx]!, new Error('All workers busy — inference timed out'));
        } else {
          reject(new Error('All workers busy — inference timed out'));
        }
      }, timeoutMs);

      const wrappedResolve = (r: BackgroundRemovalResult) => {
        clearTimeout(timeout);
        resolve(r);
      };
      const wrappedReject = (e: Error) => {
        clearTimeout(timeout);
        reject(e);
      };

      const abortListeners: PoolJob['abortListeners'] = [];

      const job: PoolJob = {
        ...jobBase,
        id: nextJobId++,
        requestId,
        resolve: wrappedResolve,
        reject: wrappedReject,
        timeout,
        workerIndex: UNASSIGNED,
        generation: 0,
        abortListeners,
      };

      pending.push(job);

      const onAbort = () => {
        cancelJob(job, new Error('cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      abort.signal.addEventListener('abort', onAbort, { once: true });
      abortListeners.push({ signal: signal ?? abort.signal, handler: onAbort });
      if (signal) abortListeners.push({ signal: abort.signal, handler: onAbort });
      return;
    }

    const workerIndex = getPool().indexOf(target);

    // Determine timeout: cold start (first inference on this worker) vs warm
    const timeoutMs = options.method === 'ai-quality' ? 300_000 : 120_000;
    const timeout = setTimeout(() => {
      const idx = pending.findIndex((j) => j.requestId === requestId);
      if (idx >= 0) {
        cancelJob(pending[idx]!, new Error('Worker inference timed out'));
      } else {
        reject(new Error('Worker inference timed out'));
      }
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

    const abortListeners: PoolJob['abortListeners'] = [];

    const job: PoolJob = {
      ...jobBase,
      id: nextJobId++,
      requestId,
      resolve: wrappedResolve,
      reject: wrappedReject,
      timeout,
      workerIndex,
      generation: target.generation,
      abortListeners,
    };
    pending.push(job);

    const onAbort = () => {
      cancelJob(job, new Error('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    abort.signal.addEventListener('abort', onAbort, { once: true });
    abortListeners.push({ signal: signal ?? abort.signal, handler: onAbort });
    if (signal) abortListeners.push({ signal: abort.signal, handler: onAbort });

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
