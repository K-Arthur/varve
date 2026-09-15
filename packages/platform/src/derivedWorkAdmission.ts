/**
 * Shared admission for disposable derived work.
 *
 * Thumbnails, raster-pyramid tiles, and semantic embeddings are useful only
 * while their owning document/view is current.  They therefore share a small
 * FIFO-with-priority gate instead of each queue assuming that its local
 * concurrency limit is the whole application's limit.  Admission never
 * changes document state; callers still own cancellation and stale-result
 * checks.
 */

export type DerivedWorkPriority = 'visible' | 'current-document' | 'background' | 'idle';
export type DerivedWorkKind = 'thumbnail' | 'raster-pyramid' | 'semantic' | 'other';

const PRIORITY_ORDER: Record<DerivedWorkPriority, number> = {
  idle: 0,
  background: 1,
  'current-document': 2,
  visible: 3,
};

export interface DerivedWorkRequest {
  readonly id: string;
  readonly kind: DerivedWorkKind;
  readonly priority: DerivedWorkPriority;
  readonly signal?: AbortSignal;
}

export interface DerivedWorkLease {
  readonly id: string;
  readonly kind: DerivedWorkKind;
  readonly priority: DerivedWorkPriority;
  /** Aborted when the request is cancelled by its owner or the gate closes. */
  readonly signal: AbortSignal;
  /** Release the slot exactly once when the derived work has stopped. */
  release(): void;
}

export interface DerivedWorkAdmissionSnapshot {
  readonly active: number;
  readonly pending: number;
  readonly maxConcurrent: number;
  readonly maxPending: number;
  readonly paused: boolean;
  readonly completed: number;
  readonly cancelled: number;
  readonly rejected: number;
}

export type DerivedWorkAdmissionErrorCode = 'cancelled' | 'queue-full' | 'closed';

export class DerivedWorkAdmissionError extends Error {
  readonly code: DerivedWorkAdmissionErrorCode;

  constructor(code: DerivedWorkAdmissionErrorCode, message: string = code) {
    super(message);
    this.name = 'DerivedWorkAdmissionError';
    this.code = code;
  }
}

function abortError(): DerivedWorkAdmissionError {
  return new DerivedWorkAdmissionError('cancelled', 'Derived work request cancelled');
}

interface PendingRequest {
  readonly request: DerivedWorkRequest;
  readonly sequence: number;
  readonly resolve: (lease: DerivedWorkLease) => void;
  readonly reject: (reason: unknown) => void;
  onAbort?: () => void;
}

interface ActiveLease {
  readonly request: DerivedWorkRequest;
  readonly controller: AbortController;
  removeAbortListener?: () => void;
  released: boolean;
}

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_MAX_PENDING = 64;

export class DerivedWorkAdmission {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly pending: PendingRequest[] = [];
  private readonly active = new Map<string, ActiveLease>();
  private sequence = 0;
  private paused = false;
  private closed = false;
  private completed = 0;
  private cancelled = 0;
  private rejected = 0;

  constructor(options: { maxConcurrent?: number; maxPending?: number } = {}) {
    this.maxConcurrent = validatePositiveInteger(
      options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      'maxConcurrent',
    );
    this.maxPending = validatePositiveInteger(
      options.maxPending ?? DEFAULT_MAX_PENDING,
      'maxPending',
    );
  }

  /** Wait for a bounded slot. Priority is FIFO within each priority level. */
  acquire(request: DerivedWorkRequest): Promise<DerivedWorkLease> {
    if (!request.id || !request.kind || !request.priority) {
      return Promise.reject(new TypeError('Derived work request requires id, kind, and priority'));
    }
    if (this.closed) return Promise.reject(new DerivedWorkAdmissionError('closed'));
    if (request.signal?.aborted) {
      this.cancelled++;
      return Promise.reject(abortError());
    }

    return new Promise<DerivedWorkLease>((resolve, reject) => {
      const pending: PendingRequest = {
        request,
        sequence: this.sequence++,
        resolve,
        reject,
      };
      const onAbort = (): void => {
        const index = this.pending.indexOf(pending);
        if (index < 0) return;
        this.pending.splice(index, 1);
        this.cancelled++;
        reject(abortError());
        this.pump();
      };
      if (request.signal) {
        request.signal.addEventListener('abort', onAbort, { once: true });
        pending.onAbort = onAbort;
      }
      this.pending.push(pending);
      if (this.pending.length > this.maxPending) {
        const victim = this.findEvictionCandidate(request.priority);
        if (victim) {
          this.removePending(victim);
          this.rejected++;
          victim.reject(
            new DerivedWorkAdmissionError('queue-full', 'Lower-priority derived work was evicted'),
          );
        } else {
          this.removePending(pending);
          this.rejected++;
          reject(new DerivedWorkAdmissionError('queue-full', 'Derived work queue is full'));
          return;
        }
      }
      this.pump();
    });
  }

  /** Stop admitting work while the page is hidden/frozen or under pressure. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.closed) return;
    this.paused = false;
    this.pump();
  }

  /** Abort active work and reject queued work. Intended for teardown only. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.splice(0)) {
      pending.request.signal?.removeEventListener('abort', pending.onAbort!);
      this.cancelled++;
      pending.reject(new DerivedWorkAdmissionError('closed', 'Derived work admission is closed'));
    }
    for (const active of this.active.values()) active.controller.abort();
  }

  snapshot(): DerivedWorkAdmissionSnapshot {
    return {
      active: this.active.size,
      pending: this.pending.length,
      maxConcurrent: this.maxConcurrent,
      maxPending: this.maxPending,
      paused: this.paused,
      completed: this.completed,
      cancelled: this.cancelled,
      rejected: this.rejected,
    };
  }

  private pump(): void {
    if (this.closed || this.paused) return;
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const next = this.nextPending();
      if (!next) return;
      if (next.request.signal?.aborted) {
        this.cancelled++;
        next.reject(abortError());
        continue;
      }
      const controller = new AbortController();
      const removeAbortListener = next.request.signal
        ? () => next.request.signal?.removeEventListener('abort', next.onAbort!)
        : undefined;
      const active: ActiveLease = {
        request: next.request,
        controller,
        removeAbortListener,
        released: false,
      };
      this.active.set(next.request.id, active);
      if (next.request.signal) {
        const abortActive = (): void => controller.abort();
        next.request.signal.addEventListener('abort', abortActive, { once: true });
        active.removeAbortListener = () => {
          next.request.signal?.removeEventListener('abort', abortActive);
          next.request.signal?.removeEventListener('abort', next.onAbort!);
        };
      }
      const lease: DerivedWorkLease = {
        id: next.request.id,
        kind: next.request.kind,
        priority: next.request.priority,
        signal: controller.signal,
        release: () => this.release(active),
      };
      next.resolve(lease);
    }
  }

  private release(active: ActiveLease): void {
    if (active.released) return;
    active.released = true;
    if (this.active.get(active.request.id) !== active) return;
    this.active.delete(active.request.id);
    active.removeAbortListener?.();
    this.completed++;
    this.pump();
  }

  private nextPending(): PendingRequest | undefined {
    let bestIndex = -1;
    for (let index = 0; index < this.pending.length; index++) {
      const current = this.pending[index]!;
      const best = bestIndex < 0 ? undefined : this.pending[bestIndex];
      if (
        !best ||
        PRIORITY_ORDER[current.request.priority] > PRIORITY_ORDER[best.request.priority] ||
        (current.request.priority === best.request.priority && current.sequence < best.sequence)
      ) {
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return undefined;
    const [next] = this.pending.splice(bestIndex, 1);
    next?.request.signal?.removeEventListener('abort', next.onAbort!);
    return next;
  }

  private findEvictionCandidate(incoming: DerivedWorkPriority): PendingRequest | undefined {
    let candidate: PendingRequest | undefined;
    for (const pending of this.pending) {
      if (pending.request.priority === incoming) continue;
      if (PRIORITY_ORDER[pending.request.priority] >= PRIORITY_ORDER[incoming]) continue;
      if (
        !candidate ||
        PRIORITY_ORDER[pending.request.priority] < PRIORITY_ORDER[candidate.request.priority] ||
        (pending.request.priority === candidate.request.priority &&
          pending.sequence < candidate.sequence)
      ) {
        candidate = pending;
      }
    }
    return candidate;
  }

  private removePending(pending: PendingRequest): void {
    const index = this.pending.indexOf(pending);
    if (index < 0) return;
    this.pending.splice(index, 1);
    pending.request.signal?.removeEventListener('abort', pending.onAbort!);
  }
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

let globalAdmission: DerivedWorkAdmission | null = null;

/** The one application-wide gate used by default background schedulers. */
export function getDerivedWorkAdmission(): DerivedWorkAdmission {
  if (!globalAdmission) globalAdmission = new DerivedWorkAdmission();
  return globalAdmission;
}

/** Test/host hook; production callers should use the singleton above. */
export function setDerivedWorkAdmissionForTest(admission: DerivedWorkAdmission | null): void {
  globalAdmission = admission;
}
