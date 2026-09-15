/**
 * Main-thread facade for the generic multi-model inference worker.
 *
 * Manages worker lifecycle, request/response correlation, cancellation,
 * and stale-result rejection via generation tracking.
 */

import { estimateInferenceReservation, getInferenceAdmission } from './admission';
import { InferenceError } from './core/InferenceError';
import type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerReleaseRequest,
  WorkerReleaseResponse,
  WorkerResponse,
  WorkerTensor,
} from './inferenceWorker';
import { workerSessionKey } from './sessionKeys';

export interface InferenceJobOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Override the conservative shared-admission estimate when known. */
  reservationBytes?: number;
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
/** Release confirmation deadline; shorter than inference, longer than a JS turn. */
const RELEASE_TIMEOUT_MS = 30_000;

export class InferenceWorkerHost {
  private worker: Worker | null = null;
  private pendingJobs = new Map<string, PendingJob>();
  private pendingReleases = new Map<
    string,
    {
      resolve: (response: WorkerReleaseResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  /** Accumulated release evidence; never treats a cache miss as reclaimed bytes. */
  private residency = {
    releasedSessions: 0,
    failedReleases: 0,
    /** Bytes whose release could not be confirmed in the current worker. */
    unresolvedBytes: 0,
    lastReport: null as WorkerReleaseResponse | null,
  };
  /** Requests whose caller stopped caring while the graph is still running. */
  private discardedRequestIds = new Set<string>();
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

    if (msg.type === 'released') {
      const pending = this.pendingReleases.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pendingReleases.delete(msg.requestId);
      this.residency.lastReport = msg;
      this.residency.releasedSessions += msg.released.length;
      this.residency.failedReleases += msg.failed.length;
      this.residency.unresolvedBytes = msg.snapshot.unresolvedBytes;
      pending.resolve(msg);
      return;
    }

    const job = this.pendingJobs.get(msg.requestId);
    if (!job) {
      this.discardedRequestIds.delete(msg.requestId);
      return;
    }

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
    for (const [id, pending] of this.pendingReleases) {
      clearTimeout(pending.timer);
      this.pendingReleases.delete(id);
      pending.reject(reason);
    }
    // The worker process is gone, so its wasm heap and GPU resources are
    // reclaimed by the platform. This is the one case where accounting may
    // return to zero without a successful release call.
    this.residency.unresolvedBytes = 0;
    this.discardedRequestIds.clear();
  }

  /**
   * Stop observing one request without tearing down the shared worker.
   *
   * ORT does not expose a portable cancellation hook for every graph, so the
   * computation may finish in the worker. Its late result is discarded by
   * request id. Callers that need hard interruption use the timeout/crash path,
   * which explicitly reports that the shared worker was restarted.
   */
  cancel(requestId: string): boolean {
    const job = this.pendingJobs.get(requestId);
    if (!job) return false;
    clearTimeout(job.timer);
    job.abortCleanup?.();
    this.pendingJobs.delete(requestId);
    this.discardedRequestIds.add(requestId);
    job.reject(
      new InferenceError('inference_cancelled', undefined, {
        message: 'Inference result discarded after cancellation.',
        technical: 'The request was detached from its caller; the shared worker was kept alive.',
        recovery: 'Retry the operation when ready.',
      }),
    );
    return true;
  }

  async infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: InferenceJobOptions = {},
  ): Promise<WorkerInferResult> {
    const admissionRequest = {
      kind: 'worker' as const,
      // Unresolved residency from a failed release cannot be proven reclaimed,
      // so the next expensive stage reserves it again until a recycle clears it.
      reservationBytes:
        (options.reservationBytes ?? estimateWorkerReservation(request)) +
        this.residency.unresolvedBytes,
      signal: options.signal,
      label: `${request.modelType} inference`,
    };
    const lease =
      getInferenceAdmission().tryAcquire(admissionRequest) ??
      (await getInferenceAdmission().acquire(admissionRequest));

    try {
      const worker = this.ensureWorker();
      const requestId = `inf_${++this.nextRequestId}_${Date.now().toString(36)}`;
      const timeout =
        options.timeoutMs ?? MODEL_TIMEOUT_MS[request.modelType] ?? DEFAULT_TIMEOUT_MS;

      return await new Promise((resolve, reject) => {
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
            this.cancel(requestId);
          };
          job.abortCleanup = () => options.signal?.removeEventListener('abort', onAbort);
          options.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    } finally {
      lease.release();
    }
  }

  /**
   * Release a specific model session (or every idle session) before another
   * memory-heavy stage. Returns the worker's actual outcome; callers must use
   * it to decide the next admission step instead of assuming memory returned.
   */
  async releaseModels(
    keys?: readonly string[],
    options: { timeoutMs?: number } = {},
  ): Promise<WorkerReleaseResponse> {
    const worker = this.ensureWorker();
    const requestId = `rel_${++this.nextRequestId}_${Date.now().toString(36)}`;
    const request: WorkerReleaseRequest = {
      type: 'release',
      requestId,
      ...(keys ? { keys: [...keys] } : {}),
    };
    const timeout = options.timeoutMs ?? RELEASE_TIMEOUT_MS;
    return new Promise<WorkerReleaseResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReleases.delete(requestId);
        reject(
          new InferenceError('inference_timeout', undefined, {
            message: `Session release timed out after ${timeout}ms`,
            technical: 'The worker did not confirm release; residency stays accounted.',
          }),
        );
      }, timeout);
      this.pendingReleases.set(requestId, { resolve, reject, timer });
      try {
        worker.postMessage(request);
      } catch (error) {
        clearTimeout(timer);
        this.pendingReleases.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Release one model identified by the same key the worker cached it under. */
  async releaseModel(
    modelType: WorkerInferRequest['modelType'],
    modelPath: string,
  ): Promise<WorkerReleaseResponse> {
    return this.releaseModels([workerSessionKey(modelType, modelPath)]);
  }

  /** Release evidence for diagnostics and admission decisions. */
  getResidencyDiagnostics(): {
    releasedSessions: number;
    failedReleases: number;
    unresolvedBytes: number;
    pendingReleases: number;
    lastReport: WorkerReleaseResponse | null;
  } {
    return {
      releasedSessions: this.residency.releasedSessions,
      failedReleases: this.residency.failedReleases,
      unresolvedBytes: this.residency.unresolvedBytes,
      pendingReleases: this.pendingReleases.size,
      lastReport: this.residency.lastReport,
    };
  }

  /**
   * Terminate and lazily recreate the worker, but only when nothing is in
   * flight. This is the bounded fallback when a release failed and the
   * runtime cannot confirm reclamation: worker termination is the only way to
   * return a grown WASM heap, and recycling an idle shared host is safe.
   */
  recycleWorkerIfIdle(): boolean {
    if (this.pendingJobs.size > 0 || this.pendingReleases.size > 0) return false;
    if (!this.worker) return true;
    this.worker.terminate();
    this.worker = null;
    this.workerReady = false;
    this.residency.unresolvedBytes = 0;
    return true;
  }

  /** Cancel all pending jobs and terminate the worker */
  dispose(): void {
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
      job.abortCleanup?.();
      job.reject(new Error('Worker disposed'));
      this.pendingJobs.delete(id);
    }
    for (const [id, pending] of this.pendingReleases) {
      clearTimeout(pending.timer);
      this.pendingReleases.delete(id);
      pending.reject(new Error('Worker disposed'));
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    this.residency.unresolvedBytes = 0;
    this.discardedRequestIds.clear();
  }

  get isReady(): boolean {
    return this.workerReady;
  }

  get pendingCount(): number {
    return this.pendingJobs.size;
  }
}

function estimateWorkerReservation(request: Omit<WorkerInferRequest, 'requestId'>): number {
  const tensorBytes = Object.values(request.tensors ?? {}).reduce(
    (total, tensor) => total + tensorByteLength(tensor),
    0,
  );
  const auxBytes = request.auxImageData
    ? request.auxImageData.width * request.auxImageData.height * 4
    : 0;
  if (!request.imageData) {
    return Math.max(1 * 1024 * 1024, tensorBytes * 2 + auxBytes);
  }
  return estimateInferenceReservation({
    width: request.imageData.width,
    height: request.imageData.height,
    outputWidth: request.targetWidth,
    outputHeight: request.targetHeight,
    additionalBytes: auxBytes + tensorBytes,
  });
}

function tensorByteLength(tensor: WorkerTensor): number {
  return tensor.data.byteLength;
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
