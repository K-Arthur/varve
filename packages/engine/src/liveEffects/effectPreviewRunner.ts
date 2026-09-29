import {
  type DerivedWorkAdmission,
  type DerivedWorkPriority,
  getDerivedWorkAdmission,
} from '@varve/platform';
import type { EffectDispatchRequest } from './dispatch';

export type EffectRevision = string | number;

/** Every input that can make a captured effect surface stale is explicit. */
export interface EffectPreviewIdentity {
  readonly ownerId: string;
  readonly documentId: string;
  readonly targetId: string;
  readonly sourceRevision: EffectRevision;
  readonly parameterRevision: EffectRevision;
  readonly maskRevision: EffectRevision;
  readonly timeRevision: EffectRevision;
  readonly generation: number;
}

export function sameEffectPreviewIdentity(
  left: EffectPreviewIdentity,
  right: EffectPreviewIdentity,
): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.documentId === right.documentId &&
    left.targetId === right.targetId &&
    left.sourceRevision === right.sourceRevision &&
    left.parameterRevision === right.parameterRevision &&
    left.maskRevision === right.maskRevision &&
    left.timeRevision === right.timeRevision &&
    left.generation === right.generation
  );
}

export interface EffectPreviewJobInput {
  readonly identity: EffectPreviewIdentity;
  readonly request: EffectDispatchRequest;
  /** Runs only after the shared admission gate has reserved the full job. */
  readonly captureSource: () => Uint8ClampedArray;
  readonly priority?: DerivedWorkPriority;
  readonly signal?: AbortSignal;
  /** Compare every supplied revision against the current document before delivery. */
  readonly isCurrent: (identity: EffectPreviewIdentity) => boolean;
}

export type EffectPreviewJobErrorCode =
  | 'cancelled'
  | 'superseded'
  | 'queue-full'
  | 'invalid-request'
  | 'worker-unavailable'
  | 'worker-failed';

export class EffectPreviewJobError extends Error {
  readonly code: EffectPreviewJobErrorCode;

  constructor(code: EffectPreviewJobErrorCode, message: string = code) {
    super(message);
    this.name = 'EffectPreviewJobError';
    this.code = code;
  }
}

export interface EffectPreviewExecutor {
  /** Creates/probes the worker before source capture can allocate RGBA. */
  prepare(): boolean;
  apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray>;
  dispose(): void;
}

export interface EffectPreviewWorkerRequest {
  readonly type: 'apply';
  readonly id: number;
  readonly request: EffectDispatchRequest;
  readonly rgba: ArrayBuffer;
}

export type EffectPreviewWorkerResponse =
  | { readonly type: 'result'; readonly id: number; readonly rgba: ArrayBuffer }
  | { readonly type: 'error'; readonly id: number; readonly message: string };

export interface EffectPreviewWorkerPort {
  onmessage: ((event: MessageEvent<EffectPreviewWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: EffectPreviewWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

interface WorkerWaiter {
  readonly resolve: (rgba: Uint8ClampedArray) => void;
  readonly reject: (error: unknown) => void;
  readonly expectedBytes: number;
  readonly timeout: ReturnType<typeof setTimeout>;
}

/** Single-flight transferable adapter for the canonical effect worker. */
export class ModuleEffectPreviewExecutor implements EffectPreviewExecutor {
  private worker: EffectPreviewWorkerPort | null = null;
  private nextId = 0;
  private readonly waiters = new Map<number, WorkerWaiter>();
  private readonly createWorker: () => EffectPreviewWorkerPort;
  private readonly responseTimeoutMs: number;

  constructor(createWorker?: () => EffectPreviewWorkerPort, responseTimeoutMs = 5_000) {
    if (!Number.isSafeInteger(responseTimeoutMs) || responseTimeoutMs < 1) {
      throw new RangeError('responseTimeoutMs must be a positive safe integer.');
    }
    this.responseTimeoutMs = responseTimeoutMs;
    this.createWorker =
      createWorker ??
      (() =>
        new Worker(new URL('./effectPreviewWorker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as EffectPreviewWorkerPort);
  }

  prepare(): boolean {
    if (this.worker) return true;
    try {
      this.worker = this.createWorker();
      this.worker.onmessage = (event) => this.onMessage(event.data);
      this.worker.onerror = (event) => {
        event.preventDefault();
        this.retire(
          new EffectPreviewJobError('worker-failed', event.message || 'Effect worker failed'),
        );
      };
      return true;
    } catch {
      this.worker = null;
      return false;
    }
  }

  apply(request: EffectDispatchRequest, rgba: Uint8ClampedArray): Promise<Uint8ClampedArray> {
    if (!this.worker) return Promise.reject(new EffectPreviewJobError('worker-unavailable'));
    const buffer = rgba.buffer;
    if (
      !(buffer instanceof ArrayBuffer) ||
      rgba.byteOffset !== 0 ||
      rgba.byteLength !== buffer.byteLength
    ) {
      return Promise.reject(
        new EffectPreviewJobError(
          'invalid-request',
          'Effect worker input must be a full transferable RGBA buffer.',
        ),
      );
    }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.waiters.has(id)) return;
        this.retire(
          new EffectPreviewJobError(
            'worker-failed',
            `Effect worker timed out after ${this.responseTimeoutMs} ms.`,
          ),
        );
      }, this.responseTimeoutMs);
      this.waiters.set(id, { resolve, reject, expectedBytes: rgba.byteLength, timeout });
      try {
        this.worker!.postMessage({ type: 'apply', id, request, rgba: buffer }, [buffer]);
      } catch (error) {
        this.retire(
          new EffectPreviewJobError(
            'worker-failed',
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    });
  }

  dispose(): void {
    this.retire(new EffectPreviewJobError('cancelled', 'Effect worker was disposed'));
  }

  private onMessage(message: EffectPreviewWorkerResponse): void {
    const waiter = this.waiters.get(message.id);
    if (!waiter) return;
    this.waiters.delete(message.id);
    clearTimeout(waiter.timeout);
    if (message.type === 'error') {
      waiter.reject(new EffectPreviewJobError('worker-failed', message.message));
      return;
    }
    if (message.rgba.byteLength !== waiter.expectedBytes) {
      waiter.reject(
        new EffectPreviewJobError(
          'worker-failed',
          `Effect worker returned ${message.rgba.byteLength} bytes; expected ${waiter.expectedBytes}.`,
        ),
      );
      return;
    }
    waiter.resolve(new Uint8ClampedArray(message.rgba));
  }

  private retire(reason: unknown): void {
    const worker = this.worker;
    this.worker = null;
    worker?.terminate();
    for (const waiter of this.waiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(reason);
    }
    this.waiters.clear();
  }
}

interface JobRecord {
  readonly input: EffectPreviewJobInput;
  readonly identity: EffectPreviewIdentity;
  readonly request: EffectDispatchRequest;
  readonly estimatedBytes: number;
  readonly sequence: number;
  readonly resolve: (rgba: Uint8ClampedArray) => void;
  readonly reject: (reason: unknown) => void;
  readonly workController: AbortController;
  removeSignalListener?: () => void;
  valid: boolean;
  executionStarted: boolean;
}

export interface EffectPreviewRunnerSnapshot {
  readonly activeOwnerId: string | null;
  readonly pendingOwners: number;
  readonly submitted: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly superseded: number;
  readonly failed: number;
}

const DEFAULT_MAX_PENDING_PREVIEWS = 64;

/**
 * One worker request at a time; each owner retains one replaceable pending
 * request. Admission precedes source capture, transfer, and worker surfaces.
 */
export class EffectPreviewRunner {
  private readonly admission: DerivedWorkAdmission;
  private readonly executor: EffectPreviewExecutor;
  private readonly maxPending: number;
  private readonly pending: JobRecord[] = [];
  private readonly currentByOwner = new Map<string, JobRecord>();
  private active: JobRecord | null = null;
  private sequence = 0;
  private submitted = 0;
  private completed = 0;
  private cancelled = 0;
  private superseded = 0;
  private failed = 0;
  private disposed = false;

  constructor(
    options: {
      admission?: DerivedWorkAdmission;
      executor?: EffectPreviewExecutor;
      maxPending?: number;
    } = {},
  ) {
    this.admission = options.admission ?? getDerivedWorkAdmission();
    this.executor = options.executor ?? new ModuleEffectPreviewExecutor();
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING_PREVIEWS;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) {
      throw new RangeError('maxPending must be a positive safe integer.');
    }
  }

  submit(input: EffectPreviewJobInput): Promise<Uint8ClampedArray> {
    if (this.disposed)
      return Promise.reject(new EffectPreviewJobError('cancelled', 'Runner disposed'));
    if (input.signal?.aborted) {
      this.cancelled++;
      return Promise.reject(new EffectPreviewJobError('cancelled'));
    }
    let expectedBytes: number;
    try {
      expectedBytes = validateJob(input);
    } catch (error) {
      this.failed++;
      return Promise.reject(
        error instanceof EffectPreviewJobError
          ? error
          : new EffectPreviewJobError('invalid-request', String(error)),
      );
    }

    const prior = this.currentByOwner.get(input.identity.ownerId);
    const replacesPending = prior !== undefined && this.pending.includes(prior);
    if (this.pending.length >= this.maxPending && !replacesPending) {
      this.failed++;
      return Promise.reject(new EffectPreviewJobError('queue-full', 'Preview queue is full.'));
    }
    if (prior) this.invalidate(prior, 'superseded');

    const identity = Object.freeze({ ...input.identity });
    let request: EffectDispatchRequest;
    try {
      request = Object.freeze(structuredClone(input.request));
    } catch (error) {
      this.failed++;
      return Promise.reject(
        new EffectPreviewJobError(
          'invalid-request',
          `Effect request parameters must be structured-cloneable: ${String(error)}`,
        ),
      );
    }
    this.submitted++;
    let job!: JobRecord;
    const promise = new Promise<Uint8ClampedArray>((resolve, reject) => {
      const workController = new AbortController();
      const removeSignalListener = input.signal
        ? () => {
            const abort = (): void => this.invalidate(job, 'cancelled');
            input.signal!.addEventListener('abort', abort, { once: true });
            return () => input.signal!.removeEventListener('abort', abort);
          }
        : undefined;
      job = {
        input,
        identity,
        request,
        estimatedBytes: expectedBytes * 3,
        sequence: ++this.sequence,
        resolve,
        reject,
        workController,
        ...(removeSignalListener ? { removeSignalListener } : {}),
        valid: true,
        executionStarted: false,
      };
      this.currentByOwner.set(identity.ownerId, job);
      this.pending.push(job);
      this.pump();
    });
    // Replaced jobs reject by design; mark the returned rejection observed even
    // when a UI owner only retains the current job's promise.
    void promise.catch(() => undefined);
    return promise;
  }

  /** Hide, delete, or switch away from a preview owner. */
  cancelOwner(ownerId: string): void {
    const job = this.currentByOwner.get(ownerId);
    if (job) this.invalidate(job, 'cancelled');
  }

  getSnapshot(): EffectPreviewRunnerSnapshot {
    return {
      activeOwnerId: this.active?.identity.ownerId ?? null,
      pendingOwners: this.pending.length,
      submitted: this.submitted,
      completed: this.completed,
      cancelled: this.cancelled,
      superseded: this.superseded,
      failed: this.failed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const job of [...this.currentByOwner.values()]) this.invalidate(job, 'cancelled');
    this.executor.dispose();
  }

  private invalidate(job: JobRecord, reason: 'cancelled' | 'superseded'): void {
    if (!job.valid) return;
    job.valid = false;
    job.workController.abort();
    job.removeSignalListener?.();
    if (this.currentByOwner.get(job.identity.ownerId) === job) {
      this.currentByOwner.delete(job.identity.ownerId);
    }
    const pendingIndex = this.pending.indexOf(job);
    if (pendingIndex >= 0) this.pending.splice(pendingIndex, 1);
    if (reason === 'superseded') this.superseded++;
    else this.cancelled++;
    job.reject(new EffectPreviewJobError(reason));
    if (!this.active) this.pump();
  }

  private pump(): void {
    if (this.disposed || this.active || this.pending.length === 0) return;
    this.pending.sort(
      (a, b) =>
        priorityScore(b.input.priority) - priorityScore(a.input.priority) ||
        a.sequence - b.sequence,
    );
    const job = this.pending.shift()!;
    this.active = job;
    void this.execute(job);
  }

  private async execute(job: JobRecord): Promise<void> {
    let lease: Awaited<ReturnType<DerivedWorkAdmission['acquire']>> | undefined;
    try {
      lease = await this.admission.acquire({
        id: `live-effect-preview-${job.sequence}`,
        kind: 'effect',
        priority: job.input.priority ?? 'visible',
        estimatedBytes: job.estimatedBytes,
        signal: job.workController.signal,
        label: `preview:${job.identity.ownerId}:${job.request.effect}`,
      });
      if (!job.valid || this.currentByOwner.get(job.identity.ownerId) !== job) return;
      if (!job.input.isCurrent(job.identity)) {
        this.invalidate(job, 'cancelled');
        return;
      }
      if (!this.executor.prepare()) {
        throw new EffectPreviewJobError(
          'worker-unavailable',
          'No module worker is available for this effect preview; keep the canonical replay path active.',
        );
      }
      const rgba = job.input.captureSource();
      const expectedLength = job.estimatedBytes / 3;
      const backing = rgba.buffer;
      if (
        rgba.length !== expectedLength ||
        rgba.byteOffset !== 0 ||
        !(backing instanceof ArrayBuffer) ||
        backing.byteLength !== rgba.byteLength
      ) {
        throw new EffectPreviewJobError(
          'invalid-request',
          'Capture must return one exact-size, transferable RGBA buffer matching the request dimensions.',
        );
      }
      job.executionStarted = true;
      const result = await this.executor.apply(job.request, rgba);
      if (result.byteLength !== expectedLength) {
        throw new EffectPreviewJobError(
          'worker-failed',
          'Effect worker returned the wrong RGBA length.',
        );
      }
      if (
        job.valid &&
        this.currentByOwner.get(job.identity.ownerId) === job &&
        job.input.isCurrent(job.identity)
      ) {
        this.completed++;
        job.resolve(result);
      } else if (job.valid) {
        this.invalidate(job, 'cancelled');
      }
    } catch (error) {
      if (job.valid) {
        this.failed++;
        job.reject(error);
      }
    } finally {
      // Cancellation only rejects the UI caller. This release remains after
      // worker completion (or confirmed executor termination in dispose()).
      lease?.release();
      job.removeSignalListener?.();
      if (this.currentByOwner.get(job.identity.ownerId) === job) {
        this.currentByOwner.delete(job.identity.ownerId);
      }
      if (this.active === job) this.active = null;
      this.pump();
    }
  }
}

function priorityScore(priority: DerivedWorkPriority | undefined): number {
  switch (priority ?? 'visible') {
    case 'foreground':
      return 5;
    case 'explicit-export':
      return 4;
    case 'visible':
      return 3;
    case 'current-document':
      return 2;
    case 'background':
      return 1;
    case 'idle':
      return 0;
  }
}

function validateJob(input: EffectPreviewJobInput): number {
  const { identity, request } = input;
  if (
    !identity.ownerId ||
    !identity.documentId ||
    !identity.targetId ||
    !Number.isSafeInteger(identity.generation) ||
    identity.generation < 0
  ) {
    throw new EffectPreviewJobError('invalid-request', 'Preview identity is incomplete.');
  }
  for (const revision of [
    identity.sourceRevision,
    identity.parameterRevision,
    identity.maskRevision,
  ]) {
    if (
      typeof revision !== 'string' &&
      (!Number.isSafeInteger(revision) || !Number.isFinite(revision))
    ) {
      throw new EffectPreviewJobError(
        'invalid-request',
        'Preview revisions must be strings or safe integers.',
      );
    }
  }
  if (typeof identity.timeRevision !== 'string' && !Number.isFinite(identity.timeRevision)) {
    throw new EffectPreviewJobError('invalid-request', 'Preview time revision must be finite.');
  }
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1
  ) {
    throw new EffectPreviewJobError(
      'invalid-request',
      'Effect dimensions must be positive safe integers.',
    );
  }
  const bytes = request.width * request.height * 4;
  if (!Number.isSafeInteger(bytes) || bytes < 4 || bytes > Number.MAX_SAFE_INTEGER / 3) {
    throw new EffectPreviewJobError(
      'invalid-request',
      'Effect RGBA dimensions overflow safe accounting.',
    );
  }
  if (typeof input.captureSource !== 'function') {
    throw new EffectPreviewJobError(
      'invalid-request',
      'An authoritative source capture callback is required.',
    );
  }
  if (typeof input.isCurrent !== 'function') {
    throw new EffectPreviewJobError('invalid-request', 'A current-identity check is required.');
  }
  return bytes;
}

let sharedRunner: EffectPreviewRunner | undefined;

/** Shared per-renderer owner queue backed by the process-wide memory gate. */
export function getEffectPreviewRunner(): EffectPreviewRunner {
  sharedRunner ??= new EffectPreviewRunner();
  return sharedRunner;
}
