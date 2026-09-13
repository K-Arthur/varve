/**
 * Small bounded queue for derived semantic work.
 *
 * Jobs are cancellable, priority ordered, and never run more than the
 * configured concurrency. A caller can mark a job stale before its result is
 * committed; this prevents a late inference result from resurrecting a
 * replaced or deleted asset.
 */

import type { DerivedWorkAdmission } from './derivedWorkAdmission';

export interface SemanticEmbeddingJob<T> {
  id: string;
  priority?: number;
  isCurrent?: () => boolean;
  run(signal: AbortSignal): Promise<T>;
}

export interface SemanticEmbeddingQueueStats {
  pending: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  rejected: number;
  paused: boolean;
}

interface PendingJob<T> {
  job: SemanticEmbeddingJob<T>;
  sequence: number;
  resolve: (value: T | undefined) => void;
  reject: (reason: unknown) => void;
}

function abortError(): DOMException {
  return new DOMException('Semantic embedding job cancelled', 'AbortError');
}

export class SemanticEmbeddingQueue<T> {
  private readonly concurrency: number;
  private readonly pending: PendingJob<T>[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private sequence = 0;
  private active = 0;
  private completed = 0;
  private failed = 0;
  private cancelled = 0;
  private rejected = 0;
  private paused = false;
  private closed = false;
  private readonly maxPending: number;

  constructor(
    concurrency = 1,
    /** Optional shared app-wide gate; null keeps an isolated queue for tests/hosts. */
    private readonly admission: DerivedWorkAdmission | null = null,
    maxPending = 64,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('Semantic embedding queue concurrency must be a positive integer');
    }
    if (!Number.isInteger(maxPending) || maxPending < 1) {
      throw new Error('Semantic embedding queue maxPending must be a positive integer');
    }
    this.concurrency = concurrency;
    this.maxPending = maxPending;
  }

  enqueue(job: SemanticEmbeddingJob<T>): Promise<T | undefined> {
    if (this.closed) return Promise.reject(new Error('Semantic embedding queue is closed'));
    if (!job.id || typeof job.run !== 'function')
      return Promise.reject(new Error('Invalid semantic embedding job'));
    if (this.pending.length >= this.maxPending) {
      this.rejected += 1;
      return Promise.reject(new Error('Semantic embedding queue is full'));
    }
    return new Promise<T | undefined>((resolve, reject) => {
      this.pending.push({ job, sequence: this.sequence++, resolve, reject });
      this.pending.sort(
        (a, b) => (b.job.priority ?? 0) - (a.job.priority ?? 0) || a.sequence - b.sequence,
      );
      this.pump();
    });
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  cancel(id: string): boolean {
    const pendingIndex = this.pending.findIndex((entry) => entry.job.id === id);
    if (pendingIndex >= 0) {
      const [entry] = this.pending.splice(pendingIndex, 1);
      this.cancelled += 1;
      entry?.reject(abortError());
      return true;
    }
    const controller = this.controllers.get(id);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.splice(0)) {
      this.cancelled += 1;
      entry.reject(abortError());
    }
    for (const controller of this.controllers.values()) controller.abort();
  }

  getStats(): SemanticEmbeddingQueueStats {
    return {
      pending: this.pending.length,
      active: this.active,
      completed: this.completed,
      failed: this.failed,
      cancelled: this.cancelled,
      rejected: this.rejected,
      paused: this.paused,
    };
  }

  private pump(): void {
    if (this.paused || this.closed) return;
    while (this.active < this.concurrency && this.pending.length > 0) {
      const entry = this.pending.shift();
      if (!entry) return;
      this.active += 1;
      const controller = new AbortController();
      this.controllers.set(entry.job.id, controller);
      void this.run(entry, controller);
    }
  }

  private async run(entry: PendingJob<T>, controller: AbortController): Promise<void> {
    let lease: Awaited<ReturnType<DerivedWorkAdmission['acquire']>> | undefined;
    try {
      if (this.admission) {
        lease = await this.admission.acquire({
          id: `semantic:${entry.job.id}`,
          kind: 'semantic',
          priority: 'background',
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          this.cancelled += 1;
          entry.reject(abortError());
          return;
        }
      }
      const value = await entry.job.run(controller.signal);
      if (controller.signal.aborted || entry.job.isCurrent?.() === false) {
        this.cancelled += 1;
        entry.resolve(undefined);
      } else {
        this.completed += 1;
        entry.resolve(value);
      }
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        this.cancelled += 1;
        entry.reject(abortError());
      } else {
        this.failed += 1;
        entry.reject(error);
      }
    } finally {
      lease?.release();
      this.controllers.delete(entry.job.id);
      this.active -= 1;
      this.pump();
    }
  }
}
