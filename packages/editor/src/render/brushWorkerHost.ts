/**
 * Host side of the brush worker.
 *
 * Responsibilities, in order of importance:
 *
 * 1. **Never lose stroke content.** Input arrives faster than any worker can
 *    consume it. Backpressure here coalesces pending work by *merging* point
 *    batches, never by discarding them — a dropped batch would be a visible
 *    gap in the user's stroke. At most one message is ever in flight, so the
 *    queue is bounded at one merged batch regardless of input rate.
 * 2. **Never paint a stale stroke.** Every message carries `(strokeId,
 *    generation)`. Responses whose generation is no longer current are dropped
 *    on arrival, so a cancelled stroke's late results cannot reach the canvas.
 * 3. **Degrade, don't die.** A slow response falls back to the synchronous
 *    engine for that batch only. The worker is retired after repeated failures
 *    or a hard `onerror`, so one stall on a heavy brush does not cost the user
 *    worker acceleration for the rest of the session.
 *
 * The fallback path calls the same `@varve/scene` stroke engine the worker
 * runs, so switching between them mid-stroke is seamless and produces the same
 * dabs.
 */
import type { BrushDab, BrushPreset, StrokeEngineState, StrokePoint } from '@varve/scene';
import { appendStrokePoints, beginStroke } from '@varve/scene';
import type { BrushWorkerCommand, BrushWorkerResponse } from './brushWorker';
import { getPaintProfiler } from './paintProfiler';

export interface DabResult {
  dabs: BrushDab[];
  bounds: { x: number; y: number; w: number; h: number };
}

export interface StrokeBatchEvent extends DabResult {
  strokeId: string;
  generation: number;
  seq: number;
  final: boolean;
  /** Where the dabs were produced. */
  source: 'worker' | 'sync';
}

export interface BrushDispatchStats {
  batchesDispatched: number;
  batchesCoalesced: number;
  staleResponsesDropped: number;
  syncFallbacks: number;
  workerTimeouts: number;
  maxQueuedPoints: number;
  lastWorkerComputeMs: number;
  lastRoundTripMs: number;
}

/** Consecutive worker failures tolerated before the worker is retired. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Per-batch response budget. Exceeding it falls back for that batch only. */
const BATCH_TIMEOUT_MS = 1_500;
/**
 * Upper bound on retained replay points (~80s of continuous 240 Hz input).
 * Past this a mid-stroke fallback restarts spacing rather than growing without
 * limit; strokes that long are already far outside normal use.
 */
const REPLAY_POINT_CAP = 20_000;

interface ActiveStroke {
  strokeId: string;
  generation: number;
  preset: BrushPreset;
  jitterSeed: number;
  /** Points accepted but not yet dispatched (merged, never dropped). */
  queued: StrokePoint[];
  /** Points handed to the worker for the batch currently in flight. */
  inFlightPoints: StrokePoint[];
  /**
   * Points whose dabs have already been emitted. Kept so a mid-stroke fallback
   * can rebuild the synchronous engine at exactly the right spacing/jitter
   * position instead of restarting the stroke.
   */
  confirmedPoints: StrokePoint[];
  replayTruncated: boolean;
  /** Sequence number of the batch currently in flight, or null. */
  inFlightSeq: number | null;
  inFlightTimer: ReturnType<typeof setTimeout> | null;
  inFlightSentAt: number;
  nextSeq: number;
  /** Set once endStroke has been requested. */
  ending: boolean;
  /** Engine state for main-thread execution; created on demand. */
  syncState: StrokeEngineState | null;
  /** True once this stroke is running entirely on the main thread. */
  syncOnly: boolean;
  resolveEnd: (() => void) | null;
}

export class BrushWorkerHost {
  private worker: Worker | null = null;
  private fallback = false;
  private consecutiveFailures = 0;
  private strokes = new Map<string, ActiveStroke>();
  private stats: BrushDispatchStats = {
    batchesDispatched: 0,
    batchesCoalesced: 0,
    staleResponsesDropped: 0,
    syncFallbacks: 0,
    workerTimeouts: 0,
    maxQueuedPoints: 0,
    lastWorkerComputeMs: 0,
    lastRoundTripMs: 0,
  };

  /** Called with every produced batch, in stroke order. */
  onBatch: ((batch: StrokeBatchEvent) => void) | null = null;

  constructor(worker?: Worker | null) {
    if (worker !== undefined) {
      this.worker = worker;
      this.fallback = worker === null;
      if (worker) this.attach(worker);
      return;
    }
    if (typeof Worker === 'undefined') {
      this.fallback = true;
      return;
    }
    try {
      const created = new Worker(new URL('./brushWorker.ts', import.meta.url), { type: 'module' });
      this.worker = created;
      this.attach(created);
    } catch {
      this.fallback = true;
    }
  }

  private attach(worker: Worker): void {
    worker.onmessage = (e: MessageEvent<BrushWorkerResponse>) => this.handleResponse(e.data);
    worker.onerror = () => this.retireWorker('brush worker error');
  }

  get isUsingWorker(): boolean {
    return !this.fallback && this.worker !== null;
  }

  getStats(): Readonly<BrushDispatchStats> {
    return { ...this.stats };
  }

  /** Number of strokes the host is currently tracking. Zero when idle. */
  get activeStrokeCount(): number {
    return this.strokes.size;
  }

  private key(strokeId: string, generation: number): string {
    return `${strokeId}#${generation}`;
  }

  // ── Stroke lifecycle ──────────────────────────────────────────────────────

  beginStroke(strokeId: string, generation: number, preset: BrushPreset, jitterSeed: number): void {
    const syncOnly = !this.isUsingWorker;
    const stroke: ActiveStroke = {
      strokeId,
      generation,
      preset,
      jitterSeed,
      queued: [],
      inFlightPoints: [],
      confirmedPoints: [],
      replayTruncated: false,
      inFlightSeq: null,
      inFlightTimer: null,
      inFlightSentAt: 0,
      nextSeq: 1,
      ending: false,
      syncState: null,
      syncOnly,
      resolveEnd: null,
    };
    this.strokes.set(this.key(strokeId, generation), stroke);
    getPaintProfiler().strokeStarted();
    if (!syncOnly) {
      this.post({ type: 'beginStroke', strokeId, generation, preset, jitterSeed });
    }
  }

  appendPoints(strokeId: string, generation: number, points: readonly StrokePoint[]): void {
    const stroke = this.strokes.get(this.key(strokeId, generation));
    if (!stroke || points.length === 0) return;
    if (stroke.queued.length > 0) this.stats.batchesCoalesced++;
    stroke.queued.push(...points);
    this.stats.maxQueuedPoints = Math.max(this.stats.maxQueuedPoints, stroke.queued.length);
    this.pump(stroke);
  }

  /**
   * Flush the stroke's remaining input; `onSettled` runs once every batch has
   * been emitted. When the stroke is already running on the main thread this
   * settles synchronously, so the caller can commit its history transaction in
   * the same turn as pointer-up rather than a microtask later.
   */
  endStroke(strokeId: string, generation: number, onSettled?: () => void): void {
    const stroke = this.strokes.get(this.key(strokeId, generation));
    if (!stroke) {
      onSettled?.();
      return;
    }
    stroke.ending = true;
    stroke.resolveEnd = onSettled ?? null;
    if (stroke.inFlightSeq === null) this.dispatchFinal(stroke);
  }

  cancelStroke(strokeId: string, generation: number): void {
    const key = this.key(strokeId, generation);
    const stroke = this.strokes.get(key);
    if (!stroke) return;
    if (stroke.inFlightTimer) clearTimeout(stroke.inFlightTimer);
    this.strokes.delete(key);
    getPaintProfiler().strokeCancelled();
    // Tell the worker to stop: rejecting a host promise reclaims no CPU.
    if (!stroke.syncOnly) this.post({ type: 'cancelStroke', strokeId, generation });
    const resolve = stroke.resolveEnd;
    stroke.resolveEnd = null;
    resolve?.();
  }

  destroy(): void {
    for (const stroke of [...this.strokes.values()]) {
      this.cancelStroke(stroke.strokeId, stroke.generation);
    }
    try {
      this.worker?.terminate();
    } catch {
      // A worker that is already gone must not break teardown.
    }
    this.worker = null;
    this.fallback = true;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  private pump(stroke: ActiveStroke): void {
    if (stroke.syncOnly || !this.isUsingWorker) {
      if (stroke.queued.length === 0 && !stroke.ending) return;
      this.runSync(stroke, stroke.queued.splice(0), stroke.ending);
      if (stroke.ending) this.finishStroke(stroke);
      return;
    }
    if (stroke.queued.length === 0) return;
    // One message in flight at a time. Everything arriving meanwhile merges
    // into the next batch, so the queue is bounded but lossless.
    if (stroke.inFlightSeq !== null) return;
    this.dispatchToWorker(stroke, stroke.queued.splice(0), false);
  }

  private dispatchFinal(stroke: ActiveStroke): void {
    const points = stroke.queued.splice(0);
    if (stroke.syncOnly || !this.isUsingWorker) {
      this.runSync(stroke, points, true);
      this.finishStroke(stroke);
      return;
    }
    this.dispatchToWorker(stroke, points, true);
  }

  private dispatchToWorker(stroke: ActiveStroke, points: StrokePoint[], final: boolean): void {
    const seq = stroke.nextSeq++;
    stroke.inFlightSeq = seq;
    stroke.inFlightPoints = points;
    stroke.inFlightSentAt = now();
    this.stats.batchesDispatched++;
    stroke.inFlightTimer = setTimeout(
      () => this.failBatch(stroke, seq, 'timeout'),
      BATCH_TIMEOUT_MS,
    );
    this.post({
      type: 'appendPoints',
      strokeId: stroke.strokeId,
      generation: stroke.generation,
      seq,
      points: [...points],
      final,
    });
  }

  /**
   * A dispatched batch did not come back usable. Finish it — and the rest of
   * the stroke — on the main thread. The worker's copy of the stroke is
   * cancelled so it stops spending CPU on results nobody will apply.
   */
  private failBatch(stroke: ActiveStroke, seq: number, reason: 'timeout' | 'error'): void {
    if (stroke.inFlightSeq !== seq) return;
    if (reason === 'timeout') this.stats.workerTimeouts++;
    this.consecutiveFailures++;
    if (stroke.inFlightTimer) clearTimeout(stroke.inFlightTimer);
    stroke.inFlightTimer = null;
    stroke.inFlightSeq = null;
    stroke.syncOnly = true;
    this.post({
      type: 'cancelStroke',
      strokeId: stroke.strokeId,
      generation: stroke.generation,
    });

    const pending = [...stroke.inFlightPoints, ...stroke.queued.splice(0)];
    stroke.inFlightPoints = [];
    this.runSync(stroke, pending, stroke.ending);
    if (stroke.ending) this.finishStroke(stroke);

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.retireWorker(`brush worker ${reason} threshold reached`);
    }
  }

  /**
   * Build (or reuse) the main-thread engine for this stroke and emit the dabs
   * for `points`. On first use the already-confirmed points are replayed
   * through a fresh engine and their dabs discarded, so spacing, arc length and
   * jitter continue exactly where the worker left off.
   */
  private runSync(stroke: ActiveStroke, points: StrokePoint[], final: boolean): void {
    if (!stroke.syncState) {
      const state = beginStroke(
        stroke.strokeId,
        stroke.generation,
        stroke.preset,
        stroke.jitterSeed,
      );
      if (stroke.confirmedPoints.length > 0) appendStrokePoints(state, stroke.confirmedPoints);
      stroke.syncState = state;
      this.stats.syncFallbacks++;
    }
    const batch = appendStrokePoints(stroke.syncState, points, { final });
    this.recordConfirmed(stroke, points);
    this.emit(stroke, batch.dabs, batch.bounds, stroke.nextSeq++, final, 'sync');
  }

  private recordConfirmed(stroke: ActiveStroke, points: readonly StrokePoint[]): void {
    if (stroke.replayTruncated) return;
    if (stroke.confirmedPoints.length + points.length > REPLAY_POINT_CAP) {
      stroke.replayTruncated = true;
      return;
    }
    stroke.confirmedPoints.push(...points);
  }

  private handleResponse(msg: BrushWorkerResponse): void {
    const stroke = this.strokes.get(this.key(msg.strokeId, msg.generation));
    if (!stroke || stroke.inFlightSeq !== msg.seq) {
      // Superseded, cancelled, or already handled by the sync fallback.
      this.stats.staleResponsesDropped++;
      getPaintProfiler().staleDropped();
      return;
    }
    if (stroke.inFlightTimer) clearTimeout(stroke.inFlightTimer);
    stroke.inFlightTimer = null;
    this.stats.lastRoundTripMs = now() - stroke.inFlightSentAt;

    if (msg.type === 'strokeError') {
      this.failBatch(stroke, msg.seq, 'error');
      return;
    }

    stroke.inFlightSeq = null;
    this.consecutiveFailures = 0;
    this.stats.lastWorkerComputeMs = msg.computeMs;
    this.recordConfirmed(stroke, stroke.inFlightPoints);
    stroke.inFlightPoints = [];
    this.emit(stroke, msg.dabs, msg.bounds, msg.seq, msg.final, 'worker');

    if (msg.final) {
      this.finishStroke(stroke);
      return;
    }
    if (stroke.ending) {
      this.dispatchFinal(stroke);
      return;
    }
    this.pump(stroke);
  }

  private emit(
    stroke: ActiveStroke,
    dabs: BrushDab[],
    bounds: DabResult['bounds'],
    seq: number,
    final: boolean,
    source: 'worker' | 'sync',
  ): void {
    if (dabs.length === 0 && !final) return;
    const profiler = getPaintProfiler();
    if (profiler.enabled) {
      profiler.batchProduced({
        dabs: dabs.length,
        source,
        computeMs: source === 'worker' ? this.stats.lastWorkerComputeMs : undefined,
        queueDelayMs: source === 'worker' ? this.stats.lastRoundTripMs : undefined,
      });
    }
    this.onBatch?.({
      strokeId: stroke.strokeId,
      generation: stroke.generation,
      seq,
      dabs,
      bounds,
      final,
      source,
    });
  }

  private finishStroke(stroke: ActiveStroke): void {
    if (stroke.inFlightTimer) clearTimeout(stroke.inFlightTimer);
    stroke.inFlightTimer = null;
    this.strokes.delete(this.key(stroke.strokeId, stroke.generation));
    const resolve = stroke.resolveEnd;
    stroke.resolveEnd = null;
    resolve?.();
  }

  private retireWorker(reason: string): void {
    if (this.fallback) return;
    this.fallback = true;
    try {
      this.worker?.terminate();
    } catch {
      // Terminating an already-dead worker must not take the document with it.
    }
    this.worker = null;
    // Any stroke still open finishes on the main thread rather than stalling.
    for (const stroke of [...this.strokes.values()]) {
      if (stroke.syncOnly) continue;
      stroke.syncOnly = true;
      if (stroke.inFlightTimer) clearTimeout(stroke.inFlightTimer);
      stroke.inFlightTimer = null;
      stroke.inFlightSeq = null;
      const pending = [...stroke.inFlightPoints, ...stroke.queued.splice(0)];
      stroke.inFlightPoints = [];
      this.runSync(stroke, pending, stroke.ending);
      if (stroke.ending) this.finishStroke(stroke);
    }
    if (typeof console !== 'undefined') console.warn(`[paint] ${reason}; using main thread`);
  }

  private post(cmd: BrushWorkerCommand): void {
    if (!this.worker) return;
    try {
      this.worker.postMessage(cmd);
    } catch {
      this.retireWorker('brush worker postMessage failed');
    }
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
