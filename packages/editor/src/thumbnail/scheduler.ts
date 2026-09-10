/**
 * ThumbnailScheduler — bounded, priority-ordered thumbnail job queue shared
 * by every generation surface (save path, page nav, pages panel, version
 * history, Home misses).
 *
 * Guarantees:
 *  - bounded concurrency (default 1 — background thumbnail work must never
 *    compete with canvas interaction);
 *  - deduplication by identity key: one job per key in flight or queued;
 *  - cancellation: enqueueing the same key replaces the queued job and
 *    aborts a running one (a newer request wins);
 *  - stale-result suppression: every job receives an AbortSignal and runs
 *    only while its key is still the newest request;
 *  - idle-time scheduling with a bounded timeout fallback.
 */

import { isEditorInteractionActive } from '../performance/editorFrameRuntime';

/** Max drain deferrals while an interaction is open (see drain()). */
const INTERACTION_DEFER_LIMIT = 10;

export type ThumbnailJobPriority = 'visible' | 'current-doc' | 'background' | 'idle';

const PRIORITY_ORDER: Record<ThumbnailJobPriority, number> = {
  visible: 3,
  'current-doc': 2,
  background: 1,
  idle: 0,
};

export interface ThumbnailJob {
  /** Identity cache key — used for dedup and cancellation. */
  key: string;
  priority: ThumbnailJobPriority;
  /**
   * Perform the work. `signal` is aborted when a newer job for the same
   * key is enqueued or the scheduler shuts down; implementations must
   * check it before applying results.
   */
  run: (signal: AbortSignal) => Promise<void> | void;
}

export class ThumbnailScheduler {
  private queue: ThumbnailJob[] = [];
  private running = 0;
  private processing = false;
  private shutdownFlag = false;
  private aborters = new Map<string, AbortController>();
  private interactionDeferrals = 0;

  constructor(public readonly maxConcurrency = 1) {}

  get pendingCount(): number {
    return this.queue.length;
  }

  get activeCount(): number {
    return this.running;
  }

  /** True when any job with this key is queued or running. */
  has(key: string): boolean {
    return this.queue.some((j) => j.key === key) || this.aborters.has(key);
  }

  /**
   * Enqueue a job. A queued job with the same key is replaced (newest
   * request wins, priority of the newest request is used). A RUNNING job
   * with the same key is aborted and requeued.
   */
  enqueue(job: ThumbnailJob): void {
    if (this.shutdownFlag) return;

    const existingIdx = this.queue.findIndex((j) => j.key === job.key);
    if (existingIdx >= 0) {
      this.queue[existingIdx] = job;
    } else {
      this.queue.push(job);
    }

    const runningAborter = this.aborters.get(job.key);
    if (runningAborter && !runningAborter.signal.aborted) {
      // A newer request supersedes the running one.
      runningAborter.abort();
    }

    this.scheduleDrain();
  }

  /** Remove a queued job and abort a running one by key. */
  cancel(key: string): void {
    this.queue = this.queue.filter((j) => j.key !== key);
    this.aborters.get(key)?.abort();
  }

  /** Drop queued jobs with priority at or below the given level. */
  cancelIdle(): void {
    this.queue = this.queue.filter((j) => PRIORITY_ORDER[j.priority] > PRIORITY_ORDER.idle);
  }

  /** Cancel all queued + running jobs and refuse new ones. */
  shutdown(): void {
    this.shutdownFlag = true;
    this.queue = [];
    for (const aborter of this.aborters.values()) aborter.abort();
    this.aborters.clear();
  }

  get isShutdown(): boolean {
    return this.shutdownFlag;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private scheduleDrain(): void {
    if (this.processing) return;
    this.processing = true;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => this.drain(), { timeout: 1000 });
    } else {
      setTimeout(() => this.drain(), 0);
    }
  }

  private drain(): void {
    this.processing = false;
    if (this.shutdownFlag) return;

    // While a pointer/wheel interaction is open, the idle-callback timeout
    // would fire mid-drag. Re-schedule instead of competing with input for
    // the frame budget (interaction audit §50). Bounded so a stuck
    // interaction can never starve thumbnail generation permanently.
    if (isEditorInteractionActive() && this.interactionDeferrals < INTERACTION_DEFER_LIMIT) {
      this.interactionDeferrals++;
      this.scheduleDrain();
      return;
    }
    this.interactionDeferrals = 0;

    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const job = this.pickNext();
      if (!job) break;
      this.queue = this.queue.filter((j) => j !== job);

      // Skip jobs cancelled while queued.
      const aborter = new AbortController();
      this.aborters.set(job.key, aborter);
      this.running++;
      const done = (): void => {
        this.running--;
        this.aborters.delete(job.key);
        if (!this.shutdownFlag && this.queue.length > 0) this.scheduleDrain();
      };
      Promise.resolve()
        .then(() => job.run(aborter.signal))
        .catch(() => undefined)
        .finally(done);
    }
  }

  private pickNext(): ThumbnailJob | null {
    let best: ThumbnailJob | null = null;
    for (const job of this.queue) {
      if (!best || PRIORITY_ORDER[job.priority] > PRIORITY_ORDER[best.priority]) {
        best = job;
      }
    }
    return best;
  }
}

/** The single application-wide thumbnail scheduler. */
let globalScheduler: ThumbnailScheduler | null = null;

export function getThumbnailScheduler(): ThumbnailScheduler {
  if (!globalScheduler) globalScheduler = new ThumbnailScheduler(1);
  return globalScheduler;
}

export function setThumbnailSchedulerForTest(scheduler: ThumbnailScheduler | null): void {
  globalScheduler = scheduler;
}
