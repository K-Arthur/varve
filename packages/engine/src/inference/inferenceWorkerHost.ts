/**
 * Main-thread facade for the generic multi-model inference worker.
 *
 * Manages worker lifecycle, request/response correlation, cancellation,
 * and stale-result rejection via generation tracking.
 */

import { InferenceError } from './core/InferenceError';
import type { WorkerInferRequest, WorkerInferResult, WorkerResponse } from './inferenceWorker';

export interface InferenceJobOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingJob {
  resolve: (result: WorkerInferResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  abortCleanup?: () => void;
}

// The host deadline covers session creation plus execution. Encoder graphs are
// the expensive cold path; decoder refinements are warm and should recover
// sooner. These are safety ceilings, not UI progress deadlines. Callers may
// still provide a stricter operation-specific deadline.
const MODEL_TIMEOUT_MS: Partial<Record<WorkerInferRequest['modelType'], number>> = {
  'sam2-encoder': 180_000,
  'sam2-decoder': 60_000,
  detr: 120_000,
};
const DEFAULT_TIMEOUT_MS = 120_000;

export class InferenceWorkerHost {
  private worker: Worker | null = null;
  private pendingJobs = new Map<string, PendingJob>();
  private nextRequestId = 0;
  private workerReady = false;

  constructor(private workerUrl?: string | URL) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    // The default URL MUST be a literal `new Worker(new URL(...))` expression
    // for Vite to bundle the worker: a URL routed through a variable (or a
    // constructor parameter) is treated as a plain asset, the raw .ts source
    // is emitted with its original extension, and the browser refuses to run
    // it in production builds (the worker dies with an empty error event).
    // See inferenceWorkerHost.ts / vite worker detection.
    if (this.workerUrl) {
      this.worker = new Worker(this.workerUrl, { type: 'module' });
    } else {
      this.worker = new Worker(new URL('./inferenceWorker.ts', import.meta.url), {
        type: 'module',
      });
    }
    // A single permanent handler. An earlier readiness probe replaced this with
    // a listener that forwarded only `ready` and discarded everything else —
    // and because the worker emits `ready` *after* creating a session inside an
    // infer request (not at startup), any failure before that point posted an
    // `error` that was silently dropped, leaving the caller to time out minutes
    // later with no diagnostic. `handleMessage` already tracks readiness.
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => this.handleWorkerError(e);
    this.worker.onmessageerror = () => this.handleWorkerMessageError();

    return this.worker;
  }

  private handleMessage(msg: WorkerResponse): void {
    if (msg.type === 'ready') {
      this.workerReady = true;
      return;
    }

    const job = this.pendingJobs.get(msg.requestId);
    if (!job) return;

    clearTimeout(job.timer);
    job.abortCleanup?.();
    this.pendingJobs.delete(msg.requestId);

    if (msg.type === 'result') {
      job.resolve(msg);
    } else {
      job.reject(inferenceErrorFromMessage(msg.message));
    }
  }

  private handleWorkerError(e: ErrorEvent): void {
    this.restartWorker(
      new InferenceError('worker_crash', undefined, {
        message: `Worker error: ${e.message || 'unknown worker failure'}`,
        technical: e.message || 'unknown worker failure',
      }),
    );
  }

  private handleWorkerMessageError(): void {
    this.restartWorker(
      new InferenceError('worker_crash', undefined, {
        message: 'Worker message could not be deserialized',
        technical: 'Structured clone failed while receiving inference output.',
      }),
    );
  }

  private restartWorker(reason: Error): void {
    const worker = this.worker;
    this.worker = null;
    this.workerReady = false;
    worker?.terminate();
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
      job.abortCleanup?.();
      this.pendingJobs.delete(id);
      job.reject(reason);
    }
  }

  async infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: InferenceJobOptions = {},
  ): Promise<WorkerInferResult> {
    const worker = this.ensureWorker();
    const requestId = `inf_${++this.nextRequestId}_${Date.now().toString(36)}`;
    const timeout = options.timeoutMs ?? MODEL_TIMEOUT_MS[request.modelType] ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('cancelled'));
        return;
      }

      const timer = setTimeout(() => {
        const job = this.pendingJobs.get(requestId);
        if (!job) return;
        this.pendingJobs.delete(requestId);
        job.abortCleanup?.();
        job.reject(
          new InferenceError('inference_timeout', undefined, {
            message: `Inference timed out after ${timeout}ms`,
            technical: `The ${request.modelType} request exceeded the host deadline.`,
          }),
        );
        // ONNX Runtime does not expose cooperative cancellation for every
        // graph. Terminating the worker is the only way to prevent a timed-out
        // request from occupying the shared worker and poisoning the retry.
        this.worker?.terminate();
        this.worker = null;
        this.workerReady = false;
        for (const [id, other] of this.pendingJobs) {
          clearTimeout(other.timer);
          other.abortCleanup?.();
          this.pendingJobs.delete(id);
          other.reject(
            new InferenceError('worker_crash', undefined, {
              message: 'Inference worker restarted after a timeout.',
              technical: 'The worker was terminated to stop a non-cancellable graph.',
            }),
          );
        }
      }, timeout);

      const job: PendingJob = { resolve, reject, timer };
      this.pendingJobs.set(requestId, job);

      const fullRequest: WorkerInferRequest = { ...request, requestId };
      try {
        worker.postMessage(fullRequest);
      } catch (error) {
        clearTimeout(timer);
        job.abortCleanup?.();
        this.pendingJobs.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (options.signal) {
        const onAbort = () => {
          const pending = this.pendingJobs.get(requestId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pendingJobs.delete(requestId);
          pending.abortCleanup = undefined;
          pending.reject(new InferenceError('inference_cancelled'));
          // Stop the current graph before a retry can be posted.
          this.restartWorker(
            new InferenceError('worker_crash', undefined, {
              message: 'Inference worker restarted after cancellation.',
              technical: 'The worker was terminated to stop a non-cancellable graph.',
            }),
          );
        };
        job.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** Cancel all pending jobs and terminate the worker */
  dispose(): void {
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
      job.abortCleanup?.();
      job.reject(new Error('Worker disposed'));
      this.pendingJobs.delete(id);
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
  }

  get isReady(): boolean {
    return this.workerReady;
  }

  get pendingCount(): number {
    return this.pendingJobs.size;
  }
}

let sharedHost: InferenceWorkerHost | null = null;

export function getInferenceWorkerHost(): InferenceWorkerHost {
  if (!sharedHost) {
    sharedHost = new InferenceWorkerHost();
  }
  return sharedHost;
}

export function disposeInferenceWorkerHost(): void {
  if (sharedHost) {
    sharedHost.dispose();
    sharedHost = null;
  }
}

function inferenceErrorFromMessage(message: string): Error {
  if (/memory|allocation|out of memory/i.test(message)) {
    return new InferenceError('out_of_memory', undefined, { message, technical: message });
  }
  if (/timed out|timeout/i.test(message)) {
    return new InferenceError('inference_timeout', undefined, { message, technical: message });
  }
  if (/not downloaded|model.*missing|model.*not found/i.test(message)) {
    return new InferenceError('model_not_installed', undefined, { message, technical: message });
  }
  if (/runtime|onnx/i.test(message)) {
    return new InferenceError('runtime_initialisation_failed', undefined, {
      message,
      technical: message,
    });
  }
  return new InferenceError('unknown', undefined, { message, technical: message });
}
