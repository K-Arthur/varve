/**
 * Admission control for memory-heavy local inference.
 *
 * A lease represents one running model session. Keeping this below the
 * provider layer means generation, background removal, and the shared worker
 * host use the same FIFO queue instead of each inventing its own concurrency
 * policy. A waiting request can always be removed by aborting its signal;
 * releasing a lease synchronously admits the next request.
 */

export type InferenceAdmissionKind = 'generation' | 'background-removal' | 'worker' | 'other';

export interface InferenceAdmissionRequest {
  kind: InferenceAdmissionKind;
  /** Conservative bytes reserved while the request is running. */
  reservationBytes?: number;
  signal?: AbortSignal;
  label?: string;
}

export interface InferenceAdmissionOptions {
  /** Maximum number of simultaneously running heavy requests. */
  maxConcurrent?: number;
  /** Optional aggregate reservation ceiling. Infinity disables this gate. */
  maxReservedBytes?: number;
}

export interface InferenceAdmissionSnapshot {
  active: number;
  pending: number;
  reservedBytes: number;
  maxConcurrent: number;
  maxReservedBytes: number;
}

export interface InferenceLease {
  readonly id: number;
  readonly kind: InferenceAdmissionKind;
  readonly reservationBytes: number;
  release(): void;
}

export type InferenceAdmissionErrorCode = 'cancelled' | 'insufficient-memory';

export class InferenceAdmissionError extends Error {
  readonly code: InferenceAdmissionErrorCode;

  constructor(code: InferenceAdmissionErrorCode, message: string) {
    super(message);
    this.name = 'InferenceAdmissionError';
    this.code = code;
  }
}

interface QueueEntry {
  id: number;
  request: Required<Pick<InferenceAdmissionRequest, 'kind'>> &
    Omit<InferenceAdmissionRequest, 'kind'>;
  reservationBytes: number;
  resolve: (lease: InferenceLease) => void;
  reject: (error: InferenceAdmissionError) => void;
  onAbort?: () => void;
}

const DEFAULT_MAX_CONCURRENT = 1;

function normalizedReservation(bytes: number | undefined): number {
  if (bytes === undefined) return 0;
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new InferenceAdmissionError(
      'insufficient-memory',
      'Inference memory reservation must be a finite non-negative number.',
    );
  }
  return Math.ceil(bytes);
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Inference admission limits must be positive safe integers.');
  }
  return value;
}

function normalizedMemoryLimit(value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('Inference memory limit must be a positive finite number.');
  }
  return Math.floor(value);
}

function cancellationError(label?: string): InferenceAdmissionError {
  return new InferenceAdmissionError(
    'cancelled',
    label
      ? `Inference request '${label}' was cancelled while waiting.`
      : 'Inference request was cancelled while waiting.',
  );
}

/** FIFO admission controller. It owns no model or worker resources. */
export class InferenceAdmission {
  private readonly maxConcurrent: number;
  private readonly maxReservedBytes: number;
  private nextId = 0;
  private activeCount = 0;
  private reservedBytes = 0;
  private queue: QueueEntry[] = [];

  constructor(options: InferenceAdmissionOptions = {}) {
    this.maxConcurrent = normalizedLimit(options.maxConcurrent, DEFAULT_MAX_CONCURRENT);
    this.maxReservedBytes = normalizedMemoryLimit(options.maxReservedBytes);
  }

  acquire(request: InferenceAdmissionRequest): Promise<InferenceLease> {
    const reservationBytes = normalizedReservation(request.reservationBytes);
    this.assertFits(reservationBytes);
    if (request.signal?.aborted) return Promise.reject(cancellationError(request.label));

    return new Promise<InferenceLease>((resolve, reject) => {
      const entry: QueueEntry = {
        id: ++this.nextId,
        request: { ...request, kind: request.kind },
        reservationBytes,
        resolve,
        reject,
      };
      if (request.signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(entry);
          if (index < 0) return;
          this.queue.splice(index, 1);
          entry.onAbort = undefined;
          reject(cancellationError(request.label));
        };
        entry.onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
      }
      this.queue.push(entry);
      this.drain();
    });
  }

  /**
   * Acquire without queueing. This keeps synchronous worker construction
   * behaviour for callers that previously observed it, while preserving FIFO
   * ordering whenever another request is already waiting.
   */
  tryAcquire(request: InferenceAdmissionRequest): InferenceLease | null {
    const reservationBytes = normalizedReservation(request.reservationBytes);
    this.assertFits(reservationBytes);
    if (request.signal?.aborted) throw cancellationError(request.label);
    if (this.queue.length > 0 || !this.canStart(reservationBytes)) return null;
    return this.startLease({
      id: ++this.nextId,
      request: { ...request, kind: request.kind },
      reservationBytes,
      resolve: () => undefined,
      reject: () => undefined,
    });
  }

  getSnapshot(): InferenceAdmissionSnapshot {
    return {
      active: this.activeCount,
      pending: this.queue.length,
      reservedBytes: this.reservedBytes,
      maxConcurrent: this.maxConcurrent,
      maxReservedBytes: this.maxReservedBytes,
    };
  }

  private assertFits(reservationBytes: number): void {
    if (reservationBytes > this.maxReservedBytes) {
      throw new InferenceAdmissionError(
        'insufficient-memory',
        `Inference request reserves ${reservationBytes} bytes, above the configured ${this.maxReservedBytes}-byte limit.`,
      );
    }
  }

  private canStart(reservationBytes: number): boolean {
    return (
      this.activeCount < this.maxConcurrent &&
      this.reservedBytes + reservationBytes <= this.maxReservedBytes
    );
  }

  private startLease(entry: QueueEntry): InferenceLease {
    this.activeCount += 1;
    this.reservedBytes += entry.reservationBytes;
    let released = false;
    const lease: InferenceLease = {
      id: entry.id,
      kind: entry.request.kind,
      reservationBytes: entry.reservationBytes,
      release: () => {
        if (released) return;
        released = true;
        this.activeCount -= 1;
        this.reservedBytes -= entry.reservationBytes;
        this.drain();
      },
    };
    entry.request.signal?.removeEventListener('abort', entry.onAbort ?? (() => undefined));
    entry.onAbort = undefined;
    return lease;
  }

  private drain(): void {
    while (this.queue.length > 0) {
      const entry = this.queue[0];
      if (!entry || !this.canStart(entry.reservationBytes)) return;
      this.queue.shift();
      const lease = this.startLease(entry);
      entry.resolve(lease);
    }
  }
}

let sharedAdmission: InferenceAdmission | null = null;

export function getInferenceAdmission(): InferenceAdmission {
  if (!sharedAdmission) sharedAdmission = new InferenceAdmission();
  return sharedAdmission;
}

/** Test/lifecycle hook; it only drops the controller after all leases ended. */
export function resetInferenceAdmission(): void {
  if (sharedAdmission?.getSnapshot().active !== 0 || sharedAdmission?.getSnapshot().pending !== 0) {
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
