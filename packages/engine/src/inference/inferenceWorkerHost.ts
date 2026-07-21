/**
 * Main-thread facade for the generic multi-model inference worker.
 *
 * Manages worker lifecycle, request/response correlation, cancellation,
 * and stale-result rejection via generation tracking.
 */
import type { WorkerInferRequest, WorkerInferResult, WorkerResponse } from './inferenceWorker';

export interface InferenceJobOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface PendingJob {
  resolve: (result: WorkerInferResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT = 120_000;

export class InferenceWorkerHost {
  private worker: Worker | null = null;
  private pendingJobs = new Map<string, PendingJob>();
  private nextRequestId = 0;
  private workerReady = false;

  constructor(private workerUrl: string | URL) {}

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    this.worker = new Worker(this.workerUrl, { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => this.handleWorkerError(e);
    new Promise<void>((resolve) => {
      const checkReady = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.type === 'ready') {
          this.worker!.onmessage = (ev) => this.handleMessage(ev.data);
          this.workerReady = true;
          resolve();
        }
      };
      this.worker!.onmessage = checkReady;
    });

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
    this.pendingJobs.delete(msg.requestId);

    if (msg.type === 'result') {
      job.resolve(msg);
    } else {
      job.reject(new Error(msg.message));
    }
  }

  private handleWorkerError(e: ErrorEvent): void {
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
      job.reject(new Error(`Worker error: ${e.message}`));
      this.pendingJobs.delete(id);
    }
  }

  async infer(
    request: Omit<WorkerInferRequest, 'requestId'>,
    options: InferenceJobOptions = {},
  ): Promise<WorkerInferResult> {
    const worker = this.ensureWorker();
    const requestId = `inf_${++this.nextRequestId}_${Date.now().toString(36)}`;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;

    return new Promise((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('cancelled'));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingJobs.delete(requestId);
        reject(new Error(`Inference timed out after ${timeout}ms`));
      }, timeout);

      this.pendingJobs.set(requestId, { resolve, reject, timer });

      const fullRequest: WorkerInferRequest = { ...request, requestId };
      worker.postMessage(fullRequest);

      options.signal?.addEventListener(
        'abort',
        () => {
          const job = this.pendingJobs.get(requestId);
          if (job) {
            clearTimeout(job.timer);
            this.pendingJobs.delete(requestId);
            reject(new Error('cancelled'));
          }
        },
        { once: true },
      );
    });
  }

  /** Cancel all pending jobs and terminate the worker */
  dispose(): void {
    for (const [id, job] of this.pendingJobs) {
      clearTimeout(job.timer);
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
    sharedHost = new InferenceWorkerHost(new URL('./inferenceWorker.ts', import.meta.url));
  }
  return sharedHost;
}

export function disposeInferenceWorkerHost(): void {
  if (sharedHost) {
    sharedHost.dispose();
    sharedHost = null;
  }
}
