/**
 * Raster pyramid — bounded tile job scheduler.
 *
 * Generates derived tiles on the background lane without stealing frame
 * time (ADR-0214 D9). The queue is bounded per priority, deduplicated by
 * tile key (latest-wins: a newer revision replaces an older job for the same
 * tile), cancellable, and runs at most `concurrency` jobs at once. Every job
 * carries the revision it was issued for; the executor callback receives the
 * live job object and the caller discards results whose revision no longer
 * matches (the commit guard lives in pyramidCache.commitIfCurrent).
 *
 * Execution is synchronous when the executor is synchronous and the queue is
 * idle — an enqueue during idle work runs immediately with no microtask
 * latency (same semantics as the retained-surface cache). Promise-returning
 * executors continue asynchronously and never block enqueue callers.
 *
 * Priorities (highest first):
 *   0 viewport — tiles visible right now
 *   1 interaction — tiles needed during an active gesture
 *   2 near-viewport — one-tile margin around the viewport
 *   3 prefetch — predictive (pan direction, next LOD)
 *   4 background — pyramid maintenance / persistence
 */

export const PYRAMID_PRIORITY_VIEWPORT = 0;
export const PYRAMID_PRIORITY_INTERACTION = 1;
export const PYRAMID_PRIORITY_NEAR = 2;
export const PYRAMID_PRIORITY_PREFETCH = 3;
export const PYRAMID_PRIORITY_BACKGROUND = 4;
export const PYRAMID_PRIORITY_COUNT = 5;

export interface PyramidJob<T> {
  readonly id: string;
  readonly key: string;
  readonly revision: string;
  readonly priority: number;
  readonly layerId: string;
  readonly level: number;
  readonly col: number;
  readonly row: number;
  cancelled: boolean;
  /** Caller-supplied payload (e.g. pixelMode). */
  readonly payload: T;
  enqueuedAt: number;
}

export interface PyramidSchedulerOptions<T> {
  /** Executes one tile-generation job. Called with the live job object. */
  run: (job: PyramidJob<T>) => Promise<void> | void;
  maxConcurrency?: number;
  maxQueued?: number;
  now?: () => number;
}

export interface PyramidSchedulerDiagnostics {
  readonly queued: number;
  readonly running: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly dropped: number;
  readonly rejected: number;
}

export class PyramidScheduler<T> {
  private readonly queues: Array<Array<PyramidJob<T>>>;
  private readonly byKey = new Map<string, PyramidJob<T>>();
  private readonly runningByKey = new Map<string, PyramidJob<T>>();
  private running = 0;
  private completed = 0;
  private cancelled = 0;
  private dropped = 0;
  private rejected = 0;
  private readonly maxConcurrency: number;
  private readonly maxQueued: number;
  private readonly now: () => number;
  private readonly runFn: (job: PyramidJob<T>) => Promise<void> | void;
  private disposed = false;

  constructor(options: PyramidSchedulerOptions<T>) {
    this.runFn = options.run;
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.maxQueued = options.maxQueued ?? 512;
    this.now = options.now ?? (() => performance.now());
    this.queues = Array.from({ length: PYRAMID_PRIORITY_COUNT }, () => []);
  }

  get queuedCount(): number {
    let n = 0;
    for (const q of this.queues) n += q.length;
    return n;
  }

  /**
   * Enqueue a tile job. Deduplicates by key: a newer revision for the same
   * tile replaces the queued job (latest-wins); the older job is cancelled.
   * A running job with the same key is marked cancelled; its in-flight
   * result will be discarded by the caller's commit guard. Returns false
   * when the queue is full (caller may degrade or skip).
   */
  enqueue(job: Omit<PyramidJob<T>, 'cancelled' | 'enqueuedAt'>): boolean {
    if (this.disposed) return false;
    const running = this.runningByKey.get(job.key);
    if (running) {
      // The running copy may be older or newer than the request; either way
      // the running result must not commit after this enqueue: cancel it and
      // queue the freshest revision.
      running.cancelled = true;
    }
    const existing = this.byKey.get(job.key);
    if (existing) {
      if (existing.revision === job.revision && existing.priority <= job.priority) {
        return true; // already queued with same-or-better revision and priority
      }
      // Replace: cancel the stale queued job.
      existing.cancelled = true;
      this.removeQueued(existing);
      this.byKey.delete(existing.key);
      this.cancelled++;
      this.dropped++;
    }
    if (this.queuedCount >= this.maxQueued) {
      this.rejected++;
      return false;
    }
    const full: PyramidJob<T> = {
      ...job,
      cancelled: false,
      enqueuedAt: this.now(),
    };
    this.queues[full.priority]?.push(full);
    this.byKey.set(full.key, full);
    this.drain();
    return true;
  }

  /** Cancel a job by key; a running job is marked cancelled so its result is discarded. */
  cancel(key: string): boolean {
    const running = this.runningByKey.get(key);
    if (running) {
      running.cancelled = true;
      this.cancelled++;
      return true;
    }
    const job = this.byKey.get(key);
    if (!job) return false;
    job.cancelled = true;
    this.byKey.delete(key);
    if (this.removeQueued(job)) this.cancelled++;
    return true;
  }

  /** Cancel every job for a layer, including running ones (document close, layer delete). */
  cancelLayer(layerId: string): number {
    let n = 0;
    for (const job of [...this.runningByKey.values()]) {
      if (job.layerId === layerId) {
        job.cancelled = true;
        n++;
      }
    }
    for (const job of [...this.byKey.values()]) {
      if (job.layerId === layerId) {
        job.cancelled = true;
        this.byKey.delete(job.key);
        this.removeQueued(job);
        n++;
      }
    }
    this.cancelled += n;
    return n;
  }

  /** Suspend background-level work; running jobs finish, prefetch/background queues clear. */
  suspend(): void {
    for (const job of [...this.byKey.values()]) {
      if (job.priority >= PYRAMID_PRIORITY_PREFETCH) {
        job.cancelled = true;
        this.byKey.delete(job.key);
        this.removeQueued(job);
        this.cancelled++;
      }
    }
  }

  queuedByKey(key: string): PyramidJob<T> | null {
    return this.byKey.get(key) ?? null;
  }

  diagnostics(): PyramidSchedulerDiagnostics {
    return {
      queued: this.queuedCount,
      running: this.running,
      completed: this.completed,
      cancelled: this.cancelled,
      dropped: this.dropped,
      rejected: this.rejected,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const q of this.queues) q.length = 0;
    this.byKey.clear();
    for (const job of this.runningByKey.values()) job.cancelled = true;
    this.runningByKey.clear();
  }

  private removeQueued(job: PyramidJob<T>): boolean {
    const q = this.queues[job.priority];
    if (!q) return false;
    const i = q.indexOf(job);
    if (i < 0) return false;
    q.splice(i, 1);
    return true;
  }

  private nextJob(): PyramidJob<T> | null {
    for (let p = 0; p < PYRAMID_PRIORITY_COUNT; p++) {
      const q = this.queues[p];
      if (!q || q.length === 0) continue;
      const job = q.shift();
      if (!job) continue;
      if (job.cancelled) {
        this.cancelled++;
        this.byKey.delete(job.key);
        return this.nextJob();
      }
      this.byKey.delete(job.key);
      return job;
    }
    return null;
  }

  private drain(): void {
    if (this.disposed || this.running >= this.maxConcurrency) return;
    const job = this.nextJob();
    if (!job) return;
    this.running++;
    this.runningByKey.set(job.key, job);
    let result: Promise<void> | void;
    try {
      result = this.runFn(job);
    } catch {
      result = undefined;
    }
    const finished = () => {
      this.runningByKey.delete(job.key);
      this.running--;
      this.completed++;
      this.drain();
    };
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).catch(() => undefined).finally(finished);
    } else {
      finished(); // synchronous executor: drain the whole queue inline
    }
  }
}
