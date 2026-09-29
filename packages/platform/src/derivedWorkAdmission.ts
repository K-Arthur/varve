/**
 * Process-wide admission for memory-heavy local work.
 *
 * Visible effects, thumbnails, inference, exports, and other derived work use
 * one bounded queue and one byte ledger. A work lease owns its reservation
 * until execution stops; bytes can be transferred to a resident lease when a
 * reusable session or cache must outlive the job. Evictable residents are
 * asked to release before a new allocation is admitted.
 */

export type DerivedWorkPriority =
  | 'idle'
  | 'background'
  | 'current-document'
  | 'visible'
  | 'explicit-export'
  | 'foreground';
export type DerivedWorkKind =
  | 'thumbnail'
  | 'raster-pyramid'
  | 'semantic'
  | 'inference'
  | 'effect'
  | 'decode'
  | 'export'
  | 'model-download'
  | 'other';

export type DerivedWorkMemoryProfile = 'unknown-or-4gb' | 'reference-8gb';

export const DERIVED_WORK_MEMORY_LIMITS: Readonly<Record<DerivedWorkMemoryProfile, number>> = {
  'unknown-or-4gb': 400_000_000,
  'reference-8gb': 600_000_000,
};

const PRIORITY_ORDER: Record<DerivedWorkPriority, number> = {
  idle: 0,
  background: 1,
  'current-document': 2,
  visible: 3,
  'explicit-export': 4,
  foreground: 5,
};

export interface DerivedWorkRequest {
  readonly id: string;
  readonly kind: DerivedWorkKind;
  readonly priority: DerivedWorkPriority;
  /** Conservative bytes reserved before decode, transfer, tensor, or surface allocation. */
  readonly estimatedBytes?: number;
  readonly signal?: AbortSignal;
  readonly label?: string;
}

export interface DerivedResidentOptions {
  readonly key?: string;
  readonly priority?: DerivedWorkPriority;
  /** Return true only after synchronous or asynchronous disposal is confirmed. */
  readonly onEvict?: () => boolean | Promise<boolean>;
}

export interface DerivedResidentLease {
  readonly id: string;
  readonly key?: string;
  readonly kind: DerivedWorkKind;
  readonly bytes: number;
  release(): void;
}

export interface DerivedWorkLease {
  readonly id: string;
  readonly kind: DerivedWorkKind;
  readonly priority: DerivedWorkPriority;
  readonly reservationBytes: number;
  /** Aborted when the request is cancelled by its owner or the gate closes. */
  readonly signal: AbortSignal;
  /** Transfer part of this reservation into a long-lived resident lease. */
  retainResident(bytes: number, options?: DerivedResidentOptions): DerivedResidentLease;
  /** Release the slot and remaining transient reservation after work stops. */
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
  readonly evictionFailures: number;
  readonly activeBytes: number;
  readonly pendingBytes: number;
  readonly residentBytes: number;
  /** Active plus resident ownership. Pending estimates are reported separately. */
  readonly reservedBytes: number;
  readonly maxReservedBytes: number;
}

export type DerivedWorkAdmissionErrorCode =
  | 'cancelled'
  | 'queue-full'
  | 'closed'
  | 'invalid-estimate'
  | 'memory-limit'
  | 'reservation-overflow';

export class DerivedWorkAdmissionError extends Error {
  readonly code: DerivedWorkAdmissionErrorCode;

  constructor(code: DerivedWorkAdmissionErrorCode, message: string = code) {
    super(message);
    this.name = 'DerivedWorkAdmissionError';
    this.code = code;
  }
}

interface PendingRequest {
  readonly request: DerivedWorkRequest;
  readonly sequence: number;
  readonly enqueuedAt: number;
  readonly estimatedBytes: number;
  readonly resolve: (lease: DerivedWorkLease) => void;
  readonly reject: (reason: unknown) => void;
  onAbort?: () => void;
}

interface ActiveLease {
  readonly request: DerivedWorkRequest;
  readonly controller: AbortController;
  readonly reservationBytes: number;
  remainingBytes: number;
  removeAbortListener?: () => void;
  released: boolean;
}

interface ResidentRecord {
  readonly id: string;
  readonly key?: string;
  readonly kind: DerivedWorkKind;
  readonly bytes: number;
  readonly priority: DerivedWorkPriority;
  readonly sequence: number;
  readonly onEvict?: () => boolean | Promise<boolean>;
  released: boolean;
  evicting: boolean;
  evictionFailed: boolean;
  lease: DerivedResidentLease;
}

const DEFAULT_MAX_CONCURRENT = 1;
const DEFAULT_MAX_PENDING = 64;
const DEFAULT_PRIORITY_AGING_MS = 15_000;

function normalizeBytes(bytes: number | undefined): number {
  if (bytes === undefined) return 0;
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new DerivedWorkAdmissionError(
      'invalid-estimate',
      'Estimated work bytes must be a non-negative safe integer.',
    );
  }
  return bytes;
}

function normalizeLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeByteLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('maxReservedBytes must be a positive safe integer or Infinity.');
  }
  return value;
}

function abortError(): DerivedWorkAdmissionError {
  return new DerivedWorkAdmissionError('cancelled', 'Derived work request cancelled');
}

function refusalFor(error: unknown): DerivedWorkAdmissionError {
  return error instanceof DerivedWorkAdmissionError
    ? error
    : new DerivedWorkAdmissionError('invalid-estimate', String(error));
}

/**
 * One bounded, byte-aware queue. The unknown/4 GB default is 400 MB; callers
 * with an explicit 8 GB reference profile can select its 600 MB ceiling.
 */
export class DerivedWorkAdmission {
  private readonly maxConcurrent: number;
  private readonly maxPending: number;
  private readonly priorityAgingMs: number;
  private readonly pending: PendingRequest[] = [];
  private readonly active = new Map<string, ActiveLease>();
  private readonly residents = new Map<string, ResidentRecord>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private paused = false;
  private closed = false;
  private completed = 0;
  private cancelled = 0;
  private rejected = 0;
  private evictionFailures = 0;
  private evictionInProgress = false;
  private activeBytes = 0;
  private residentBytes = 0;
  private maxReservedBytes: number;

  constructor(
    options: {
      maxConcurrent?: number;
      maxPending?: number;
      maxReservedBytes?: number;
      memoryProfile?: DerivedWorkMemoryProfile;
      priorityAgingMs?: number;
    } = {},
  ) {
    this.maxConcurrent = normalizeLimit(
      options.maxConcurrent,
      DEFAULT_MAX_CONCURRENT,
      'maxConcurrent',
    );
    this.maxPending = normalizeLimit(options.maxPending, DEFAULT_MAX_PENDING, 'maxPending');
    this.priorityAgingMs = normalizeLimit(
      options.priorityAgingMs,
      DEFAULT_PRIORITY_AGING_MS,
      'priorityAgingMs',
    );
    this.maxReservedBytes = normalizeByteLimit(
      options.maxReservedBytes,
      DERIVED_WORK_MEMORY_LIMITS[options.memoryProfile ?? 'unknown-or-4gb'],
    );
  }

  /** Wait for a bounded slot. Priority ages for explicit exports that wait. */
  acquire(request: DerivedWorkRequest): Promise<DerivedWorkLease> {
    let estimatedBytes: number;
    try {
      this.validateRequest(request);
      estimatedBytes = normalizeBytes(request.estimatedBytes);
      this.assertFits(estimatedBytes);
    } catch (error) {
      this.rejected++;
      return Promise.reject(refusalFor(error));
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
        enqueuedAt: Date.now(),
        estimatedBytes,
        resolve,
        reject,
      };
      const onAbort = (): void => {
        const index = this.pending.indexOf(pending);
        if (index < 0) return;
        this.pending.splice(index, 1);
        this.cancelled++;
        reject(abortError());
        this.notify();
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
            new DerivedWorkAdmissionError('queue-full', 'Lower-priority work was evicted.'),
          );
        } else {
          this.removePending(pending);
          this.rejected++;
          reject(new DerivedWorkAdmissionError('queue-full', 'Derived work queue is full.'));
          this.notify();
          return;
        }
      }
      this.notify();
      this.pump();
    });
  }

  /** Acquire synchronously if this request can start now without queueing. */
  tryAcquire(request: DerivedWorkRequest): DerivedWorkLease | null {
    this.validateRequest(request);
    const estimatedBytes = normalizeBytes(request.estimatedBytes);
    this.assertFits(estimatedBytes);
    if (this.closed) throw new DerivedWorkAdmissionError('closed');
    if (request.signal?.aborted) throw abortError();
    if (this.paused && !this.isProtectedFromPause(request.priority)) return null;
    if (this.pending.length > 0 || this.active.size >= this.maxConcurrent) return null;
    if (!this.makeRoomFor(estimatedBytes)) return null;
    return this.startLease({
      request,
      sequence: this.sequence++,
      enqueuedAt: Date.now(),
      estimatedBytes,
      resolve: () => undefined,
      reject: () => undefined,
    });
  }

  /** Stop speculative admission when hidden; explicit exports still proceed. */
  pause(): void {
    this.paused = true;
    for (const active of this.active.values()) {
      if (!this.isProtectedFromPause(active.request.priority)) active.controller.abort();
    }
    this.notify();
    this.pump();
  }

  resume(): void {
    if (this.closed) return;
    this.paused = false;
    this.notify();
    this.pump();
  }

  /**
   * Change the conservative process budget when a profile is known. Lowering
   * the ceiling evicts disposable residents first; untracked live ownership is
   * never silently released to force the new value.
   */
  setMemoryProfile(profile: DerivedWorkMemoryProfile): void {
    this.maxReservedBytes = DERIVED_WORK_MEMORY_LIMITS[profile];
    this.evictResidentsToFit(0);
    this.notify();
    this.pump();
  }

  /** Abort active work and reject queued work. Intended for teardown only. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.splice(0)) {
      pending.request.signal?.removeEventListener('abort', pending.onAbort!);
      this.cancelled++;
      pending.reject(new DerivedWorkAdmissionError('closed', 'Derived work admission is closed.'));
    }
    for (const active of this.active.values()) active.controller.abort();
    this.evictResidentsToFit(0, true);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot(): DerivedWorkAdmissionSnapshot {
    return this.makeSnapshot([...this.active.values()], this.pending, [...this.residents.values()]);
  }

  /** Per-kind view used by compatibility adapters that share this process gate. */
  snapshotForKind(kind: DerivedWorkKind): DerivedWorkAdmissionSnapshot {
    return this.makeSnapshot(
      [...this.active.values()].filter((lease) => lease.request.kind === kind),
      this.pending.filter((entry) => entry.request.kind === kind),
      [...this.residents.values()].filter((resident) => resident.kind === kind),
    );
  }

  private makeSnapshot(
    active: ActiveLease[],
    pending: PendingRequest[],
    residents: ResidentRecord[],
  ): DerivedWorkAdmissionSnapshot {
    const activeBytes = active.reduce((sum, lease) => sum + lease.remainingBytes, 0);
    const pendingBytes = pending.reduce((sum, entry) => sum + entry.estimatedBytes, 0);
    const residentBytes = residents.reduce((sum, resident) => sum + resident.bytes, 0);
    return {
      active: active.length,
      pending: pending.length,
      maxConcurrent: this.maxConcurrent,
      maxPending: this.maxPending,
      paused: this.paused,
      completed: this.completed,
      cancelled: this.cancelled,
      rejected: this.rejected,
      evictionFailures: this.evictionFailures,
      activeBytes,
      pendingBytes,
      residentBytes,
      reservedBytes: activeBytes + residentBytes,
      maxReservedBytes: this.maxReservedBytes,
    };
  }

  private validateRequest(request: DerivedWorkRequest): void {
    if (!request.id || !request.kind || !request.priority) {
      throw new TypeError('Derived work request requires id, kind, and priority.');
    }
    if (
      this.active.has(request.id) ||
      this.pending.some((entry) => entry.request.id === request.id)
    ) {
      throw new DerivedWorkAdmissionError(
        'invalid-estimate',
        `Derived work id '${request.id}' is already active or queued.`,
      );
    }
  }

  private assertFits(bytes: number): void {
    if (bytes > this.maxReservedBytes) {
      throw new DerivedWorkAdmissionError(
        'memory-limit',
        `Request reserves ${bytes} bytes, above the ${this.maxReservedBytes}-byte process limit.`,
      );
    }
  }

  private get reservedBytes(): number {
    return this.activeBytes + this.residentBytes;
  }

  private canStart(bytes: number): boolean {
    return (
      this.active.size < this.maxConcurrent && this.reservedBytes + bytes <= this.maxReservedBytes
    );
  }

  private makeRoomFor(bytes: number): boolean {
    if (this.reservedBytes + bytes <= this.maxReservedBytes) return true;
    this.evictResidentsToFit(bytes);
    return this.reservedBytes + bytes <= this.maxReservedBytes;
  }

  private evictResidentsToFit(bytes: number, all = false): void {
    if (this.evictionInProgress) return;
    const candidates = [...this.residents.values()]
      .filter(
        (resident) =>
          resident.onEvict && !resident.released && !resident.evicting && !resident.evictionFailed,
      )
      .sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.sequence - b.sequence,
      );
    for (const resident of candidates) {
      if (!all && this.reservedBytes + bytes <= this.maxReservedBytes) break;
      try {
        const evicted = resident.onEvict?.();
        if (typeof evicted === 'object' && evicted !== null && 'then' in evicted) {
          resident.evicting = true;
          this.evictionInProgress = true;
          void Promise.resolve(evicted).then(
            (confirmed) => {
              resident.evicting = false;
              this.evictionInProgress = false;
              if (confirmed === true) {
                resident.lease.release();
              } else {
                resident.evictionFailed = true;
                this.evictionFailures++;
                this.notify();
              }
              if (all && this.closed) this.evictResidentsToFit(0, true);
              else this.pump();
            },
            () => {
              resident.evicting = false;
              this.evictionInProgress = false;
              resident.evictionFailed = true;
              this.evictionFailures++;
              this.notify();
              if (all && this.closed) this.evictResidentsToFit(0, true);
              else this.pump();
            },
          );
          // Keep the current reservation until the owner's release confirms
          // that the underlying session/cache has actually stopped using it.
          return;
        }
        if (evicted !== true) {
          resident.evictionFailed = true;
          this.evictionFailures++;
          continue;
        }
        if (!resident.released) resident.lease.release();
      } catch {
        this.evictionFailures++;
      }
    }
  }

  private pump(): void {
    if (this.closed) return;
    while (this.active.size < this.maxConcurrent && this.pending.length > 0) {
      const next = this.nextAdmissiblePending();
      if (!next) return;
      const index = this.pending.indexOf(next);
      if (index >= 0) this.pending.splice(index, 1);
      next.request.signal?.removeEventListener('abort', next.onAbort!);
      if (next.request.signal?.aborted) {
        this.cancelled++;
        next.reject(abortError());
        continue;
      }
      const lease = this.startLease(next);
      next.resolve(lease);
    }
  }

  private nextAdmissiblePending(): PendingRequest | undefined {
    const ordered = [...this.pending].sort((a, b) => {
      const scoreDelta = this.priorityScore(b) - this.priorityScore(a);
      return scoreDelta || a.sequence - b.sequence;
    });
    for (const candidate of ordered) {
      if (this.paused && !this.isProtectedFromPause(candidate.request.priority)) continue;
      if (this.makeRoomFor(candidate.estimatedBytes) && this.canStart(candidate.estimatedBytes)) {
        return candidate;
      }
    }
    return undefined;
  }

  private priorityScore(pending: PendingRequest): number {
    const base = PRIORITY_ORDER[pending.request.priority];
    if (pending.request.priority !== 'explicit-export') return base;
    const waitedMs = Math.max(0, Date.now() - pending.enqueuedAt);
    return Math.min(PRIORITY_ORDER.foreground, base + Math.floor(waitedMs / this.priorityAgingMs));
  }

  private isProtectedFromPause(priority: DerivedWorkPriority): boolean {
    return priority === 'explicit-export' || priority === 'foreground';
  }

  private startLease(pending: PendingRequest): DerivedWorkLease {
    const controller = new AbortController();
    const active: ActiveLease = {
      request: pending.request,
      controller,
      reservationBytes: pending.estimatedBytes,
      remainingBytes: pending.estimatedBytes,
      released: false,
    };
    this.active.set(pending.request.id, active);
    this.activeBytes += active.remainingBytes;
    if (pending.request.signal) {
      const abortActive = (): void => controller.abort();
      pending.request.signal.addEventListener('abort', abortActive, { once: true });
      active.removeAbortListener = () => {
        pending.request.signal?.removeEventListener('abort', abortActive);
        pending.request.signal?.removeEventListener('abort', pending.onAbort!);
      };
    }
    const lease: DerivedWorkLease = {
      id: pending.request.id,
      kind: pending.request.kind,
      priority: pending.request.priority,
      reservationBytes: pending.estimatedBytes,
      signal: controller.signal,
      retainResident: (bytes, options = {}) => this.retainResident(active, bytes, options),
      release: () => this.release(active),
    };
    this.notify();
    return lease;
  }

  private retainResident(
    active: ActiveLease,
    bytesValue: number,
    options: DerivedResidentOptions,
  ): DerivedResidentLease {
    const bytes = normalizeBytes(bytesValue);
    if (active.released || !this.active.has(active.request.id)) {
      throw new DerivedWorkAdmissionError(
        'reservation-overflow',
        'Resident bytes can only be transferred from a live work lease.',
      );
    }
    if (bytes > active.remainingBytes) {
      throw new DerivedWorkAdmissionError(
        'reservation-overflow',
        `Cannot retain ${bytes} bytes from a ${active.remainingBytes}-byte work reservation.`,
      );
    }
    if (
      options.key &&
      [...this.residents.values()].some((resident) => resident.key === options.key)
    ) {
      throw new DerivedWorkAdmissionError(
        'reservation-overflow',
        `Resident key '${options.key}' already has an active lease.`,
      );
    }
    const id = `resident_${++this.sequence}`;
    active.remainingBytes -= bytes;
    this.activeBytes -= bytes;
    this.residentBytes += bytes;
    const record: ResidentRecord = {
      id,
      ...(options.key ? { key: options.key } : {}),
      kind: active.request.kind,
      bytes,
      priority: options.priority ?? active.request.priority,
      sequence: this.sequence,
      onEvict: options.onEvict,
      released: false,
      evicting: false,
      evictionFailed: false,
      lease: undefined as unknown as DerivedResidentLease,
    };
    const residentLease: DerivedResidentLease = {
      id,
      ...(options.key ? { key: options.key } : {}),
      kind: active.request.kind,
      bytes,
      release: () => {
        if (record.released) return;
        record.released = true;
        this.residents.delete(record.id);
        this.residentBytes -= record.bytes;
        this.notify();
        this.pump();
      },
    };
    record.lease = residentLease;
    this.residents.set(id, record);
    this.notify();
    return residentLease;
  }

  private release(active: ActiveLease): void {
    if (active.released) return;
    active.released = true;
    if (this.active.get(active.request.id) !== active) return;
    this.active.delete(active.request.id);
    active.removeAbortListener?.();
    this.activeBytes -= active.remainingBytes;
    active.remainingBytes = 0;
    this.completed++;
    this.notify();
    this.pump();
  }

  private findEvictionCandidate(incoming: DerivedWorkPriority): PendingRequest | undefined {
    let candidate: PendingRequest | undefined;
    for (const pending of this.pending) {
      if (pending.request.priority === incoming) continue;
      if (this.priorityScore(pending) >= PRIORITY_ORDER[incoming]) continue;
      if (
        !candidate ||
        this.priorityScore(pending) < this.priorityScore(candidate) ||
        (this.priorityScore(pending) === this.priorityScore(candidate) &&
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

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

let globalAdmission: DerivedWorkAdmission | null = null;

/** The one application-wide gate used by default background schedulers. */
export function getDerivedWorkAdmission(): DerivedWorkAdmission {
  if (!globalAdmission) globalAdmission = new DerivedWorkAdmission();
  return globalAdmission;
}

/** Explicit profile selection; unknown hosts retain the conservative default. */
export function setDerivedWorkMemoryProfile(profile: DerivedWorkMemoryProfile): void {
  getDerivedWorkAdmission().setMemoryProfile(profile);
}

/** Test/host hook; production callers should use the singleton above. */
export function setDerivedWorkAdmissionForTest(admission: DerivedWorkAdmission | null): void {
  globalAdmission = admission;
}
