/**
 * Main-thread facade for the generic multi-model inference worker.
 *
 * Manages worker lifecycle, request/response correlation, cancellation,
 * and stale-result rejection via generation tracking.
 */

import type { DerivedResidentLease } from '@varve/platform';
import {
  estimateInferenceReservation,
  getInferenceAdmission,
  type InferenceAdmission,
  type InferenceLease,
} from './admission';
import { InferenceError } from './core/InferenceError';
import type {
  WorkerInferRequest,
  WorkerInferResult,
  WorkerReleaseRequest,
  WorkerReleaseResponse,
  WorkerResponse,
  WorkerSessionReady,
  WorkerTensor,
} from './inferenceWorker';
import { estimateModelMemory, getModelById, getRecommendedProvider } from './modelCatalog';
import type { WorkerSessionIdentity } from './sessionKeys';
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
  admissionLease: InferenceLease;
  sessionKey: string;
  sessionEstimateBytes: number;
  /** Release admission only when this worker request is actually finished. */
  finishExecution: () => void;
  callerSettled: boolean;
  abortCleanup?: () => void;
}

interface TrackedSessionResident {
  estimateBytes: number;
  legacyKey: string;
  lease: DerivedResidentLease | null;
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
  private workerGeneration = 0;
  private sessionResidents = new Map<string, TrackedSessionResident>();
  private legacySessionKeys = new Map<string, Set<string>>();
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
  private nextRequestId = 0;
  private workerReady = false;

  constructor(
    private workerUrl?: string | URL,
    private admission: InferenceAdmission = getInferenceAdmission(),
  ) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.workerGeneration += 1;

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
    // A single permanent handler for module readiness, correlated session
    // creation, inference results, and release confirmations. A readiness-only
    // probe would discard failures and resident-session accounting messages.
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
      for (const key of msg.released) this.clearSessionResident(key);
      const accountedFailedBytes = msg.snapshot.unresolvedKeys.reduce((sum, key) => {
        const resident = this.sessionResidents.get(key);
        return sum + (resident?.lease ? resident.estimateBytes : 0);
      }, 0);
      this.residency.unresolvedBytes = Math.max(
        0,
        msg.snapshot.unresolvedBytes - accountedFailedBytes,
      );
      pending.resolve(msg);
      return;
    }

    if (msg.type === 'session-ready') {
      this.acceptSessionReady(msg);
      return;
    }

    if (msg.type === 'fatal') {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference worker retired after an unreleased session creation.',
          technical: msg.message,
        }),
      );
      return;
    }

    const job = this.pendingJobs.get(msg.requestId);
    if (!job) return;

    clearTimeout(job.timer);
    job.abortCleanup?.();
    this.pendingJobs.delete(msg.requestId);

    if (!job.callerSettled) {
      job.callerSettled = true;
      if (msg.type === 'result') {
        job.resolve(msg);
      } else {
        job.reject(inferenceErrorFromMessage(msg.message));
      }
    }
    job.finishExecution();
  }

  private acceptSessionReady(message: WorkerSessionReady): void {
    const job = this.pendingJobs.get(message.requestId);
    if (
      !job ||
      job.sessionKey !== message.sessionKey ||
      job.sessionEstimateBytes !== message.estimateBytes
    ) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference session admission identity did not match its worker result.',
          technical: `Unaccounted or mismatched session '${message.sessionKey}' was reported.`,
        }),
      );
      return;
    }

    for (const key of message.evictedKeys) this.clearSessionResident(key);
    if (this.sessionResidents.has(message.sessionKey)) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference worker recreated a session that the host still tracks.',
          technical: `Duplicate resident identity '${message.sessionKey}'.`,
        }),
      );
      return;
    }

    let residentLease: DerivedResidentLease | null = null;
    try {
      if (message.estimateBytes > 0) {
        residentLease = job.admissionLease.retainResident(message.estimateBytes, {
          key: `inference-session:${message.sessionKey}`,
          priority: 'background',
          onEvict: () => this.evictSession(message.sessionKey),
        });
      }
    } catch (error) {
      this.restartWorker(
        new InferenceError('worker_crash', undefined, {
          message: 'Inference session could not transfer its reserved bytes to resident ownership.',
          technical: error instanceof Error ? error.message : String(error),
        }),
      );
      return;
    }

    const legacyKey = workerSessionKey(message.modelType, message.modelPath);
    this.sessionResidents.set(message.sessionKey, {
      estimateBytes: message.estimateBytes,
      legacyKey,
      lease: residentLease,
    });
    const aliases = this.legacySessionKeys.get(legacyKey) ?? new Set<string>();
    aliases.add(message.sessionKey);
    this.legacySessionKeys.set(legacyKey, aliases);
  }

  private async evictSession(sessionKey: string): Promise<boolean> {
    if (!this.sessionResidents.has(sessionKey)) return true;
    try {
      const report = await this.releaseModels([sessionKey]);
      return report.released.includes(sessionKey);
    } catch {
      // A failed IPC release can still coincide with a worker crash. The
      // restart path clears residents only after terminating that owner.
      return !this.sessionResidents.has(sessionKey);
    }
  }

  private clearSessionResident(sessionKey: string): void {
    const resident = this.sessionResidents.get(sessionKey);
    if (!resident) return;
    resident.lease?.release();
    this.sessionResidents.delete(sessionKey);
    const aliases = this.legacySessionKeys.get(resident.legacyKey);
    aliases?.delete(sessionKey);
    if (aliases?.size === 0) this.legacySessionKeys.delete(resident.legacyKey);
  }

  private clearAllSessionResidents(): void {
    for (const resident of this.sessionResidents.values()) resident.lease?.release();
    this.sessionResidents.clear();
    this.legacySessionKeys.clear();
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
      if (!job.callerSettled) {
        job.callerSettled = true;
        job.reject(reason);
      }
      job.finishExecution();
    }
    for (const [id, pending] of this.pendingReleases) {
      clearTimeout(pending.timer);
      this.pendingReleases.delete(id);
      pending.reject(reason);
    }
    // The worker process is gone, so its wasm heap and GPU resources are
    // reclaimed by the platform. This is the one case where accounting may
    // return to zero without a successful release call.
    this.clearAllSessionResidents();
    this.residency.unresolvedBytes = 0;
  }

  /**
   * Stop waiting for one request without tearing down the shared worker.
   *
   * ORT does not expose a portable cancellation hook for every graph, so the
   * computation may finish in the worker. Keep its request, deadline, and
   * admission lease until the late result arrives or the worker is restarted.
   * This prevents a cancelled caller from admitting overlapping work while
   * its original graph still owns CPU/GPU and model memory.
   */
  cancel(requestId: string): boolean {
    const job = this.pendingJobs.get(requestId);
    if (!job || job.callerSettled) return false;
    job.abortCleanup?.();
    job.callerSettled = true;
    job.reject(
      new InferenceError('inference_cancelled', undefined, {
        message: 'Inference result discarded after cancellation.',
        technical:
          'The caller stopped waiting; its worker request remains accounted until it finishes.',
        recovery:
          'The result will be discarded. New inference waits for the worker request to finish.',
      }),
    );
    return true;
  }

  async infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: InferenceJobOptions = {},
  ): Promise<WorkerInferResult> {
    const model = getModelById(request.modelId);
    const sessionEstimateBytes = request.sessionPeakBytes ?? estimateModelMemory(request.modelId);
    if (!Number.isSafeInteger(sessionEstimateBytes) || sessionEstimateBytes < 0) {
      throw new RangeError(
        'Inference session memory estimate must be a non-negative safe integer.',
      );
    }
    const recommendedProvider = getRecommendedProvider(request.modelId);
    const baseSessionIdentity: Omit<WorkerSessionIdentity, 'deviceGeneration'> = {
      ...request.sessionIdentity,
      artifactRevision:
        request.sessionIdentity?.artifactRevision ?? model?.checksum ?? request.modelPath,
      precision: request.sessionIdentity?.precision ?? model?.precision ?? 'unknown',
      providerConfiguration:
        request.sessionIdentity?.providerConfiguration ??
        (recommendedProvider === 'cpu'
          ? 'wasm-only'
          : recommendedProvider === 'gpu'
            ? 'accelerator-with-wasm-fallback'
            : 'runtime-auto'),
      runtimeConfiguration:
        request.sessionIdentity?.runtimeConfiguration ?? 'ort-worker:threads=1:proxy=off',
      externalDataRevision:
        request.sessionIdentity?.externalDataRevision ??
        request.externalData?.checksum ??
        request.externalData?.url,
    };
    const transientBytes = options.reservationBytes ?? estimateWorkerReservation(request);
    let expectedWorkerGeneration = this.worker ? this.workerGeneration : this.workerGeneration + 1;
    let sessionIdentity: WorkerSessionIdentity;
    let sessionKey: string;
    let lease: InferenceLease;
    while (true) {
      sessionIdentity = { ...baseSessionIdentity, deviceGeneration: expectedWorkerGeneration };
      sessionKey = workerSessionKey(request.modelType, request.modelPath, {
        ...sessionIdentity,
        modelId: request.modelId,
        externalDataPath: request.externalData?.path,
      });
      const sessionBytesToReserve = this.sessionResidents.has(sessionKey)
        ? 0
        : sessionEstimateBytes;
      const admissionRequest = {
        kind: 'worker' as const,
        // New sessions are admitted with their model working set plus transient
        // tensors/surfaces. A cached session already owns a resident lease and
        // is therefore not charged twice. Any legacy failed-release bytes that
        // have no matching resident lease remain conservatively reserved.
        reservationBytes: transientBytes + sessionBytesToReserve + this.residency.unresolvedBytes,
        signal: options.signal,
        label: `${request.modelType} inference`,
      };
      lease =
        this.admission.tryAcquire(admissionRequest) ??
        (await this.admission.acquire(admissionRequest));

      const currentWorkerGeneration = this.worker
        ? this.workerGeneration
        : this.workerGeneration + 1;
      if (currentWorkerGeneration === expectedWorkerGeneration) break;

      // The request waited in the shared queue while its worker was retired.
      // Do not post an old-generation key or try transferring bytes that the
      // new worker did not reserve. Re-enter admission for the new identity.
      lease.release();
      expectedWorkerGeneration = currentWorkerGeneration;
    }

    let executionOwned = false;
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
          if (!job.callerSettled) {
            job.callerSettled = true;
            job.reject(
              new InferenceError('inference_timeout', undefined, {
                message: `Inference timed out after ${timeout}ms`,
                technical: `The ${request.modelType} request exceeded the host deadline.`,
              }),
            );
          }
          // ONNX Runtime does not expose cooperative cancellation for every
          // graph. Terminating the worker is the only way to prevent a timed-out
          // request from occupying the shared worker and poisoning the retry.
          this.restartWorker(
            new InferenceError('worker_crash', undefined, {
              message: 'Inference worker restarted after a timeout.',
              technical: 'The worker was terminated to stop a non-cancellable graph.',
            }),
          );
          job.finishExecution();
        }, timeout);

        let finished = false;
        const job: PendingJob = {
          resolve,
          reject,
          timer,
          admissionLease: lease,
          sessionKey,
          sessionEstimateBytes,
          callerSettled: false,
          finishExecution: () => {
            if (finished) return;
            finished = true;
            lease.release();
          },
        };
        this.pendingJobs.set(requestId, job);
        executionOwned = true;

        const fullRequest: WorkerInferRequest = {
          ...request,
          sessionPeakBytes: sessionEstimateBytes,
          sessionIdentity,
          requestId,
        };
        try {
          worker.postMessage(fullRequest);
        } catch (error) {
          clearTimeout(timer);
          job.abortCleanup?.();
          this.pendingJobs.delete(requestId);
          job.callerSettled = true;
          job.finishExecution();
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
      // After posting, the response, deadline, or worker teardown releases the
      // lease. Caller cancellation alone leaves the underlying request owned.
      if (!executionOwned) lease.release();
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
    const resolvedKeys = keys?.flatMap((key) => {
      const aliases = this.legacySessionKeys.get(key);
      return aliases?.size ? [...aliases] : [key];
    });
    const request: WorkerReleaseRequest = {
      type: 'release',
      requestId,
      ...(resolvedKeys ? { keys: resolvedKeys } : {}),
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
    residentSessions: number;
    trackedResidentBytes: number;
    pendingReleases: number;
    lastReport: WorkerReleaseResponse | null;
  } {
    return {
      releasedSessions: this.residency.releasedSessions,
      failedReleases: this.residency.failedReleases,
      unresolvedBytes: this.residency.unresolvedBytes,
      residentSessions: this.sessionResidents.size,
      trackedResidentBytes: [...this.sessionResidents.values()].reduce(
        (sum, resident) => sum + (resident.lease?.bytes ?? 0),
        0,
      ),
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
    this.clearAllSessionResidents();
    this.residency.unresolvedBytes = 0;
    return true;
  }

  /** Cancel all pending jobs and terminate the worker */
  dispose(): void {
    this.restartWorker(new Error('Worker disposed'));
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
