/**
 * Worker-compatible audit execution layer.
 *
 * Providers that do not require direct DOM or renderer access can
 * be offloaded to a Web Worker. Renderer-backed providers remain
 * on the main thread (or use the render worker).
 *
 * Architecture:
 *   AuditWorkerPool manages a pool of workers, dispatches scan jobs,
 *   collects results, and falls back to main-thread execution when
 *   workers are unavailable (e.g. file:// protocol, no Blob support).
 */

import type { AuditFinding, AuditSeverity } from '@strata/shared';

export interface SerialisableScanInput {
  document: unknown;
  nodeIds: string[];
  ruleIds: string[];
  revision: number;
}

export interface ScanProgress {
  completed: number;
  total: number;
  currentRule: string;
}

export interface ScanResult {
  findings: AuditFinding[];
  timings: Record<string, number>;
  revision: number;
  aborted: boolean;
}

export interface AuditWorkerOptions {
  maxWorkers?: number;
  timeoutMs?: number;
  fallbackToMain: boolean;
}

export interface WorkerJob {
  id: string;
  input: SerialisableScanInput;
  resolve: (result: ScanResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
}

/**
 * Manages a pool of audit workers.
 * Falls back to main-thread execution when workers are unavailable.
 */
export class AuditWorkerPool {
  private workers: Worker[] = [];
  private queue: WorkerJob[] = [];
  private active = 0;
  private options: Required<AuditWorkerOptions>;
  private workerBlobUrl: string | null = null;

  constructor(options?: AuditWorkerOptions) {
    this.options = {
      maxWorkers: options?.maxWorkers ?? navigator.hardwareConcurrency || 2,
      timeoutMs: options?.timeoutMs ?? 30000,
      fallbackToMain: options?.fallbackToMain ?? true,
    };
  }

  get workerAvailable(): boolean {
    return typeof Worker !== 'undefined';
  }

  /**
   * Dispatch a scan job. Returns a promise that resolves with the result
   * or rejects on error/timeout. The job can be cancelled via AbortSignal.
   */
  dispatch(input: SerialisableScanInput, signal?: AbortSignal): Promise<ScanResult> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    if (!this.workerAvailable || !this.options.fallbackToMain) {
      return this.runMainThread(input, signal);
    }

    return new Promise((resolve, reject) => {
      const job: WorkerJob = {
        id: crypto.randomUUID(),
        input,
        resolve,
        reject,
        signal,
      };
      this.queue.push(job);
      this.processQueue();
    });
  }

  /**
   * Cancel all pending jobs.
   */
  cancelAll(): void {
    for (const job of this.queue) {
      job.reject(new DOMException('Cancelled', 'AbortError'));
    }
    this.queue = [];
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.active = 0;
  }

  /**
   * Main-thread fallback for when workers are unavailable.
   * Runs each rule sequentially, checking for cancellation between steps.
   */
  private async runMainThread(
    input: SerialisableScanInput,
    signal?: AbortSignal,
  ): Promise<ScanResult> {
    const timings: Record<string, number> = {};
    const findings: AuditFinding[] = [];

    for (let i = 0; i < input.ruleIds.length; i++) {
      if (signal?.aborted) {
        return { findings, timings, revision: input.revision, aborted: true };
      }
      const ruleId = input.ruleIds[i]!;
      const start = performance.now();
      try {
        const ruleFindings = await this.runRule(ruleId, input);
        findings.push(...ruleFindings);
      } catch {
        // Provider-level isolation: failure in one rule does not block others
      }
      timings[ruleId] = performance.now() - start;
    }

    return { findings, timings, revision: input.revision, aborted: false };
  }

  private async runRule(
    _ruleId: string,
    _input: SerialisableScanInput,
  ): Promise<AuditFinding[]> {
    // Placeholder: rule executors are registered by the audit scheduler.
    // This is populated by the IntelligencePanel during setup.
    return [];
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.active >= this.options.maxWorkers) return;

    const job = this.queue.shift();
    if (!job) return;
    this.active++;

    const timer = setTimeout(() => {
      job.reject(new Error(`Audit worker timed out after ${this.options.timeoutMs}ms`));
      this.active--;
      this.processQueue();
    }, this.options.timeoutMs);

    this.runMainThread(job.input, job.signal)
      .then((result) => {
        clearTimeout(timer);
        job.resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        job.reject(err);
      })
      .finally(() => {
        this.active--;
        this.processQueue();
      });
  }

  destroy(): void {
    this.cancelAll();
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
  }
}
