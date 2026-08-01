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

import type { AuditContext, AuditFinding, AuditRuleDef } from '@strata/scene';
import { getAllRules } from '@strata/scene';
import { runAuditScan } from './auditScanExecutor';
import type { ScanResult, ScanResultChunk, SerialisableScanInput } from './auditScanTypes';

export type {
  ScanProgress,
  ScanResult,
  ScanResultChunk,
  SerialisableScanInput,
} from './auditScanTypes';

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
  private ruleExecutors = new Map<
    string,
    (input: SerialisableScanInput) => Promise<AuditFinding[]>
  >();
  private latestRevision = 0;

  constructor(options?: AuditWorkerOptions) {
    this.options = {
      maxWorkers: options?.maxWorkers ?? (navigator.hardwareConcurrency || 2),
      timeoutMs: options?.timeoutMs ?? 30000,
      fallbackToMain: options?.fallbackToMain ?? true,
    };
  }

  get workerAvailable(): boolean {
    return typeof Worker !== 'undefined';
  }

  /**
   * Register a custom rule executor. When runRule() is called for ruleId,
   * the registered executor is invoked. This allows callers to inject rule
   * logic that doesn't come from the audit engine registry.
   */
  registerRule(
    ruleId: string,
    executor: (input: SerialisableScanInput) => Promise<AuditFinding[]>,
  ): void {
    this.ruleExecutors.set(ruleId, executor);
  }

  /**
   * Unregister a previously registered rule executor.
   */
  unregisterRule(ruleId: string): void {
    this.ruleExecutors.delete(ruleId);
  }

  /**
   * Update the latest document revision. When a scan completes, its revision
   * is compared against this value — stale results are discarded.
   */
  setLatestRevision(revision: number): void {
    this.latestRevision = revision;
  }

  /**
   * Get the current latest revision (for testing).
   */
  getLatestRevision(): number {
    return this.latestRevision;
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
   * Dispatch a scan job with incremental chunk delivery.
   * After each rule completes, onChunk is called with partial results.
   * Returns the final merged result when all rules finish.
   */
  dispatchChunked(
    input: SerialisableScanInput,
    onChunk: (chunk: ScanResultChunk) => void,
    signal?: AbortSignal,
  ): Promise<ScanResult> {
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }

    return this.runChunkedMainThread(input, onChunk, signal);
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
   * Uses the scan executor to run engine-registered rules with progress
   * and cancellation support. Validates revision before returning results.
   */
  private async runMainThread(
    input: SerialisableScanInput,
    signal?: AbortSignal,
  ): Promise<ScanResult> {
    const result = await runAuditScan(input, { signal });

    // Stale-result rejection: discard results if document has been modified
    if (result.revision !== this.latestRevision) {
      return {
        findings: [],
        timings: result.timings,
        failures: result.failures,
        revision: input.revision,
        aborted: true,
      };
    }

    return result;
  }

  /**
   * Chunked main-thread execution. Runs rules one at a time and calls
   * onChunk after each rule completes with partial results.
   */
  private async runChunkedMainThread(
    input: SerialisableScanInput,
    onChunk: (chunk: ScanResultChunk) => void,
    signal?: AbortSignal,
  ): Promise<ScanResult> {
    const timings: Record<string, number> = {};
    const findings: AuditFinding[] = [];
    let failures = 0;

    // Resolve which rules to run: custom executors first, then engine rules
    const executorIds = Array.from(this.ruleExecutors.keys());
    const engineRuleIds =
      input.ruleIds.length > 0 ? input.ruleIds.filter((id) => !this.ruleExecutors.has(id)) : [];
    const allEngineRules = engineRuleIds.length > 0 ? resolveEngineRules(engineRuleIds) : [];
    const totalRules = executorIds.length + allEngineRules.length;
    let completed = 0;

    // Run custom executors
    for (const ruleId of executorIds) {
      if (signal?.aborted) {
        return { findings, timings, failures, revision: input.revision, aborted: true };
      }

      const executor = this.ruleExecutors.get(ruleId)!;
      const start = performance.now();
      try {
        const ruleFindings = await executor(input);
        findings.push(...ruleFindings);
      } catch (err) {
        console.error(`[audit-worker] Custom rule ${ruleId} failed:`, err);
        failures++;
      }
      timings[ruleId] = performance.now() - start;
      completed++;

      onChunk({ findings: [...findings], completed, total: totalRules, currentRule: ruleId });
      await Promise.resolve();
    }

    // Run engine-registered rules sequentially with chunk reporting
    for (const rule of allEngineRules) {
      if (signal?.aborted) {
        return { findings, timings, failures, revision: input.revision, aborted: true };
      }

      const start = performance.now();
      try {
        const ctx = buildContext(input);
        const ruleFindings = rule.run(ctx);
        findings.push(...ruleFindings);
      } catch (err) {
        console.error(`[audit-worker] Rule ${rule.id} failed:`, err);
        failures++;
      }
      timings[rule.id] = performance.now() - start;
      completed++;

      onChunk({ findings: [...findings], completed, total: totalRules, currentRule: rule.id });
      await Promise.resolve();
    }

    // Stale-result rejection
    if (input.revision !== this.latestRevision) {
      return {
        findings: [],
        timings,
        failures,
        revision: input.revision,
        aborted: true,
      };
    }

    return { findings, timings, failures, revision: input.revision, aborted: false };
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

// ---------------------------------------------------------------------------
// Helpers (module-level, not exported)
// ---------------------------------------------------------------------------

/** Resolve AuditRuleDef entries from the engine registry by ID. */
function resolveEngineRules(ruleIds: string[]): AuditRuleDef[] {
  const allRules = getAllRules();
  if (ruleIds.length === 0) return allRules;
  const idSet = new Set(ruleIds);
  return allRules.filter((r) => idSet.has(r.id));
}

/** Build a minimal AuditContext from a serializable input. */
function buildContext(input: SerialisableScanInput): AuditContext {
  return {
    doc: input.document as AuditContext['doc'],
    workspaceMode: 'design',
    canvasMode: 'full',
    tool: 'select',
    selection: input.nodeIds,
    isPresenting: false,
  };
}
