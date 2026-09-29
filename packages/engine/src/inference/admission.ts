/**
 * Compatibility facade for the process-wide platform admission gate.
 *
 * Inference keeps its existing API and error vocabulary, while reservations
 * now contend with thumbnails, effects, exports, and other local work through
 * the same byte ledger and priority queue.
 */

import {
  type DerivedResidentLease,
  type DerivedResidentOptions,
  DerivedWorkAdmission,
  DerivedWorkAdmissionError,
  type DerivedWorkAdmissionSnapshot,
  type DerivedWorkPriority,
  getDerivedWorkAdmission,
} from '@varve/platform';

export type InferenceAdmissionKind =
  | 'generation'
  | 'background-removal'
  | 'worker'
  | 'export'
  | 'other';

export interface InferenceAdmissionRequest {
  kind: InferenceAdmissionKind;
  /** Conservative bytes reserved before tensors, sessions, or transfer buffers are created. */
  reservationBytes?: number;
  /** Override the default foreground priority for previews or explicit exports. */
  priority?: DerivedWorkPriority;
  signal?: AbortSignal;
  label?: string;
}

export interface InferenceAdmissionOptions {
  /** Maximum number of simultaneously running heavy requests on this gate. */
  maxConcurrent?: number;
  /** Aggregate byte ceiling. Infinity disables only the byte ceiling. */
  maxReservedBytes?: number;
  /** Use a shared platform controller; otherwise limits create an isolated test/host gate. */
  admission?: DerivedWorkAdmission;
}

export interface InferenceAdmissionSnapshot {
  active: number;
  pending: number;
  activeBytes: number;
  pendingBytes: number;
  residentBytes: number;
  reservedBytes: number;
  maxConcurrent: number;
  maxReservedBytes: number;
}

export interface InferenceLease {
  readonly id: number;
  readonly kind: InferenceAdmissionKind;
  readonly reservationBytes: number;
  /** Transfer bytes already reserved by this request to a long-lived resident owner. */
  retainResident(bytes: number, options?: DerivedResidentOptions): DerivedResidentLease;
  release(): void;
}

export type InferenceAdmissionErrorCode =
  | 'cancelled'
  | 'insufficient-memory'
  | 'queue-full'
  | 'closed'
  | 'invalid-estimate';

export class InferenceAdmissionError extends Error {
  readonly code: InferenceAdmissionErrorCode;

  constructor(code: InferenceAdmissionErrorCode, message: string) {
    super(message);
    this.name = 'InferenceAdmissionError';
    this.code = code;
  }
}

function normalizeReservation(bytes: number | undefined): number {
  if (bytes === undefined) return 0;
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new InferenceAdmissionError(
      'invalid-estimate',
      'Inference memory reservation must be a non-negative safe integer.',
    );
  }
  return bytes;
}

function mapAdmissionError(error: unknown): InferenceAdmissionError {
  if (error instanceof InferenceAdmissionError) return error;
  if (error instanceof DerivedWorkAdmissionError) {
    const code: InferenceAdmissionErrorCode =
      error.code === 'cancelled'
        ? 'cancelled'
        : error.code === 'memory-limit'
          ? 'insufficient-memory'
          : error.code === 'queue-full'
            ? 'queue-full'
            : error.code === 'closed'
              ? 'closed'
              : 'invalid-estimate';
    return new InferenceAdmissionError(code, error.message);
  }
  return new InferenceAdmissionError('invalid-estimate', String(error));
}

function defaultPriority(kind: InferenceAdmissionKind): DerivedWorkPriority {
  if (kind === 'export') return 'explicit-export';
  if (kind === 'other') return 'current-document';
  return 'visible';
}

/** FIFO-compatible facade; the shared gate owns queue order and byte totals. */
export class InferenceAdmission {
  private readonly admission: DerivedWorkAdmission;
  private nextId = 0;

  constructor(options: InferenceAdmissionOptions = {}) {
    if (options.admission) {
      if (options.maxConcurrent !== undefined || options.maxReservedBytes !== undefined) {
        throw new TypeError('Pass either a shared admission gate or standalone limits, not both.');
      }
      this.admission = options.admission;
      return;
    }

    const hasLocalLimits =
      options.maxConcurrent !== undefined || options.maxReservedBytes !== undefined;
    this.admission = hasLocalLimits
      ? new DerivedWorkAdmission({
          ...(options.maxConcurrent !== undefined ? { maxConcurrent: options.maxConcurrent } : {}),
          ...(options.maxReservedBytes !== undefined
            ? { maxReservedBytes: options.maxReservedBytes }
            : {}),
        })
      : getDerivedWorkAdmission();
  }

  acquire(request: InferenceAdmissionRequest): Promise<InferenceLease> {
    const reservationBytes = normalizeReservation(request.reservationBytes);
    const id = ++this.nextId;
    return this.admission
      .acquire({
        id: `inference_${id}`,
        kind: 'inference',
        priority: request.priority ?? defaultPriority(request.kind),
        estimatedBytes: reservationBytes,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.label ? { label: request.label } : {}),
      })
      .then((lease) => this.wrapLease(lease, id, request.kind, reservationBytes))
      .catch((error: unknown) => {
        throw mapAdmissionError(error);
      });
  }

  /** Preserve the old synchronous admission behavior for callers that rely on it. */
  tryAcquire(request: InferenceAdmissionRequest): InferenceLease | null {
    const reservationBytes = normalizeReservation(request.reservationBytes);
    const id = ++this.nextId;
    try {
      const lease = this.admission.tryAcquire({
        id: `inference_${id}`,
        kind: 'inference',
        priority: request.priority ?? defaultPriority(request.kind),
        estimatedBytes: reservationBytes,
        ...(request.signal ? { signal: request.signal } : {}),
        ...(request.label ? { label: request.label } : {}),
      });
      return lease ? this.wrapLease(lease, id, request.kind, reservationBytes) : null;
    } catch (error) {
      throw mapAdmissionError(error);
    }
  }

  subscribe(listener: () => void): () => void {
    return this.admission.subscribe(listener);
  }

  getSnapshot(): InferenceAdmissionSnapshot {
    const snapshot = this.admission.snapshotForKind('inference');
    return toInferenceSnapshot(snapshot);
  }

  private wrapLease(
    lease: Awaited<ReturnType<DerivedWorkAdmission['acquire']>>,
    id: number,
    kind: InferenceAdmissionKind,
    reservationBytes: number,
  ): InferenceLease {
    return {
      id,
      kind,
      reservationBytes,
      retainResident: (bytes, options) => lease.retainResident(bytes, options),
      release: () => lease.release(),
    };
  }
}

function toInferenceSnapshot(snapshot: DerivedWorkAdmissionSnapshot): InferenceAdmissionSnapshot {
  return {
    active: snapshot.active,
    pending: snapshot.pending,
    activeBytes: snapshot.activeBytes,
    pendingBytes: snapshot.pendingBytes,
    residentBytes: snapshot.residentBytes,
    reservedBytes: snapshot.reservedBytes,
    maxConcurrent: snapshot.maxConcurrent,
    maxReservedBytes: snapshot.maxReservedBytes,
  };
}

let sharedAdmission: InferenceAdmission | null = null;

export function getInferenceAdmission(): InferenceAdmission {
  if (!sharedAdmission) sharedAdmission = new InferenceAdmission();
  return sharedAdmission;
}

/** Test/lifecycle hook; it only drops this facade after inference jobs end. */
export function resetInferenceAdmission(): void {
  if (!sharedAdmission) return;
  const snapshot = sharedAdmission.getSnapshot();
  if (snapshot.active !== 0 || snapshot.pending !== 0) {
    throw new Error('Cannot reset inference admission while requests are active or pending.');
  }
  sharedAdmission = null;
}

/** Conservative RGBA working-set estimate for a bounded image operation. */
export function estimateInferenceReservation(options: {
  width: number;
  height: number;
  outputWidth?: number;
  outputHeight?: number;
  additionalBytes?: number;
  modelBytes?: number;
  workingSetMultiplier?: number;
}): number {
  const dimensions = [
    options.width,
    options.height,
    options.outputWidth ?? options.width,
    options.outputHeight ?? options.height,
  ];
  if (dimensions.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError('Inference reservation dimensions must be positive safe integers.');
  }
  const multiplier = options.workingSetMultiplier ?? 4;
  if (!Number.isFinite(multiplier) || multiplier < 1) {
    throw new RangeError('Inference working-set multiplier must be at least one.');
  }
  const additionalBytes = options.additionalBytes ?? 0;
  const modelBytes = options.modelBytes ?? 0;
  if (
    !Number.isFinite(additionalBytes) ||
    additionalBytes < 0 ||
    !Number.isFinite(modelBytes) ||
    modelBytes < 0
  ) {
    throw new RangeError('Inference reservation additions must be finite and non-negative.');
  }
  const largestFrameBytes =
    Math.max(
      options.width * options.height,
      (options.outputWidth ?? options.width) * (options.outputHeight ?? options.height),
    ) * 4;
  return Math.ceil(largestFrameBytes * multiplier + additionalBytes + modelBytes);
}
