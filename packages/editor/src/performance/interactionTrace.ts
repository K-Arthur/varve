/**
 * Interaction traces — bounded gesture-level telemetry connecting pointer
 * input to presented frames.
 *
 * Groups per-event spans and per-frame commit times into interactions keyed
 * by a monotonic correlation ID, so a slow drag is traceable end-to-end:
 * pointerdown → move events (each with handler duration) → frames presented
 * while the gesture is active → pointer-to-present latency → total gesture
 * time. Off by default; slow-capture mode keeps only gestures that exceed a
 * configurable threshold. Frame correlation is by time window (a frame
 * committed while the interaction is open belongs to it), so no id needs to
 * thread through the render path.
 */
export type InteractionKind = 'pointer-drag' | 'wheel' | 'pinch' | 'keyboard' | 'hover' | 'unknown';

export interface InteractionSpan {
  /** Stable span name, e.g. 'pointer.input', 'interaction.dispatch'. */
  name: string;
  startTimeMs: number;
  durationMs: number;
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Why a frame exists relative to the interaction it is recorded against.
 * Distinguishing these keeps "the gesture produced 12 frames" from silently
 * counting background decodes or superseded work as interaction latency.
 */
export type FrameDisposition =
  | 'caused' // produced by this interaction's invalidation
  | 'coalesced' // several interaction events merged into one frame
  | 'superseded' // a newer revision replaced this frame before presentation
  | 'cancelled' // the interaction ended before the frame committed
  | 'dropped' // admission/budget refused the frame
  | 'replaced' // presented, then immediately replaced by a newer frame
  | 'reused' // served from cache without new replay work
  | 'background'; // unrelated work (decode, font load, autosave) during the gesture

export interface InteractionFrameSample {
  committedAt: number;
  totalMs: number;
  disposition?: FrameDisposition;
  /** Pixel identity of the frame, when the render path reported one. */
  renderRevision?: number;
}

export interface InteractionTrace {
  schemaVersion: 2;
  /** Stable per-page-load identity; distinguishes traces across reloads. */
  sessionId: string;
  /** Monotonic correlation ID connecting input events to presented frames. */
  id: number;
  kind: InteractionKind;
  /** Monotonic per-interaction pointer sample counter (last assigned value). */
  pointerSequenceId: number;
  /** performance.now() of the first event. */
  startedAt: number;
  endedAt: number;
  eventCount: number;
  frameCount: number;
  /** Frame commit times (performance.now()) and durations during the gesture. */
  frames: InteractionFrameSample[];
  spans: InteractionSpan[];
  /** First presented frame after the gesture started (ms), or null. */
  pointerToPresentMs: number | null;
  totalMs: number;
  /** Sum of recorded span durations (work actually spent in the gesture). */
  busyMs: number;
  slow: boolean;
  /** Samples dropped after the per-interaction span cap was reached. */
  droppedSpanCount: number;
  /** Samples dropped after the per-interaction frame cap was reached. */
  droppedFrameCount: number;
}

const MAX_INTERACTION_TRACES = 50;
export const MAX_INTERACTION_SPANS = 512;
export const MAX_INTERACTION_FRAMES = 240;
const DEFAULT_SLOW_THRESHOLD_MS = 50;
const MAX_PRESENTATION_WAIT_MS = 250;
const MAX_PENDING_PRESENTATIONS = MAX_INTERACTION_TRACES;
const ring: InteractionTrace[] = [];
/**
 * Per-page-load identity. Derived from the load time and a random suffix
 * rather than crypto.randomUUID so the module stays usable in workers, jsdom,
 * and non-secure contexts where randomUUID is absent.
 */
const sessionId = `s${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffff).toString(36)}`;
let tracingEnabled = false;
let slowOnly = false;
let slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS;
let nextId = 1;
let current: InteractionTrace | null = null;
const pendingPresentations: InteractionTrace[] = [];
const NOOP_SPAN_END = () => undefined;

function refreshSlow(trace: InteractionTrace): void {
  trace.slow =
    Math.max(trace.totalMs, trace.busyMs, trace.pointerToPresentMs ?? 0) >= slowThresholdMs;
}

function retainTrace(trace: InteractionTrace): void {
  if (ring.includes(trace)) return;
  ring.push(trace);
  if (ring.length > MAX_INTERACTION_TRACES) ring.shift();
}

export function enableInteractionTraces(force?: boolean): void {
  tracingEnabled = force === true;
  if (!tracingEnabled) {
    current = null;
    pendingPresentations.length = 0;
    ring.length = 0;
  }
}

export function isInteractionTracingEnabled(): boolean {
  return tracingEnabled;
}

/** Capture only gestures exceeding the configured threshold. */
export function setSlowCaptureOnly(force: boolean): void {
  slowOnly = force;
}

export function setSlowInteractionThreshold(ms: number): void {
  slowThresholdMs = Math.max(0, ms);
}

export function beginInteraction(kind: InteractionKind): void {
  if (!tracingEnabled) return;
  if (current) endInteraction();
  current = {
    schemaVersion: 2,
    sessionId,
    id: nextId++,
    kind,
    pointerSequenceId: 0,
    startedAt: performance.now(),
    endedAt: 0,
    eventCount: 0,
    frameCount: 0,
    frames: [],
    spans: [],
    pointerToPresentMs: null,
    totalMs: 0,
    busyMs: 0,
    slow: false,
    droppedSpanCount: 0,
    droppedFrameCount: 0,
  };
}

/**
 * Identity of the interaction currently being traced, for propagation into the
 * render/worker path. Null when tracing is off or no gesture is open, so
 * callers can skip identity work entirely on the disabled path.
 */
export interface InteractionIdentity {
  sessionId: string;
  interactionId: number;
  pointerSequenceId: number;
  kind: InteractionKind;
}

export function getActiveInteractionIdentity(): InteractionIdentity | null {
  if (!tracingEnabled || !current) return null;
  return {
    sessionId: current.sessionId,
    interactionId: current.id,
    pointerSequenceId: current.pointerSequenceId,
    kind: current.kind,
  };
}

/**
 * Advance and return the pointer sample counter for the open interaction.
 * Coalesced samples share one dispatch, so this counts dispatched samples
 * rather than browser-delivered events.
 */
export function nextPointerSequenceId(): number {
  if (!tracingEnabled || !current) return 0;
  current.pointerSequenceId += 1;
  return current.pointerSequenceId;
}

function appendSpan(
  trace: InteractionTrace,
  name: string,
  startTimeMs: number,
  durationMs: number,
  attributes?: InteractionSpan['attributes'],
): void {
  if (name.endsWith('.input')) trace.eventCount++;
  trace.busyMs += durationMs;
  if (trace.endedAt > 0) {
    refreshSlow(trace);
    if (!slowOnly || trace.slow) retainTrace(trace);
  }
  if (trace.spans.length >= MAX_INTERACTION_SPANS) {
    trace.droppedSpanCount++;
    return;
  }
  trace.spans.push({ name, startTimeMs, durationMs, attributes });
}

/** Record a per-event span (e.g. the pointermove handler duration). */
export function recordInteractionSpan(
  name: string,
  durationMs: number,
  attributes?: InteractionSpan['attributes'],
): void {
  if (!tracingEnabled || !current || durationMs < 0) return;
  appendSpan(current, name, performance.now() - durationMs, durationMs, attributes);
}

/**
 * Record a span whose start time is already known in the main-thread domain.
 *
 * Unlike `recordInteractionSpan`, this does not assume the span ended "now" —
 * required for work whose timing was measured elsewhere (a worker's own clock,
 * translated through calibration) and reported after the fact.
 */
export function recordInteractionSpanAt(
  name: string,
  startTimeMs: number,
  durationMs: number,
  attributes?: InteractionSpan['attributes'],
): void {
  if (!tracingEnabled || !current || durationMs < 0) return;
  appendSpan(current, name, startTimeMs, durationMs, attributes);
}

/**
 * Start an async-safe phase span. The returned one-shot completion closure
 * retains the originating trace, so queue/worker work can finish after the
 * pointer gesture closes without being attributed to a newer gesture.
 */
export function beginInteractionSpan(
  name: string,
  attributes?: InteractionSpan['attributes'],
): (attributes?: InteractionSpan['attributes']) => void {
  if (!tracingEnabled || !current) return NOOP_SPAN_END;
  const trace = current;
  const startedAt = performance.now();
  let finished = false;
  return (endAttributes) => {
    if (finished) return;
    finished = true;
    const endedAt = performance.now();
    appendSpan(trace, name, startedAt, Math.max(0, endedAt - startedAt), {
      ...attributes,
      ...endAttributes,
    });
  };
}

function recordFrameOnTrace(
  trace: InteractionTrace,
  committedAt: number,
  totalMs: number,
  meta?: FrameCommitMeta,
): void {
  trace.frameCount++;
  if (trace.pointerToPresentMs === null) {
    trace.pointerToPresentMs = Math.max(0, committedAt - trace.startedAt);
  }
  if (trace.endedAt > 0) {
    refreshSlow(trace);
    if (!slowOnly || trace.slow) retainTrace(trace);
  }
  if (trace.frames.length >= MAX_INTERACTION_FRAMES) {
    trace.droppedFrameCount++;
    return;
  }
  trace.frames.push({
    committedAt,
    totalMs,
    ...(meta?.disposition ? { disposition: meta.disposition } : {}),
    ...(meta?.renderRevision !== undefined ? { renderRevision: meta.renderRevision } : {}),
  });
}

export interface FrameCommitMeta {
  disposition?: FrameDisposition;
  renderRevision?: number;
}

/** Called for every presented frame (see perfRuntime.recordFrame). */
export function notifyFrameCommit(
  committedAt: number,
  totalMs: number,
  meta?: FrameCommitMeta,
): void {
  if (!tracingEnabled) return;
  if (current) recordFrameOnTrace(current, committedAt, totalMs, meta);
  if (pendingPresentations.length === 0) return;
  let writeIndex = 0;
  for (const pending of pendingPresentations) {
    const waitMs = committedAt - pending.endedAt;
    if (waitMs < 0) {
      pendingPresentations[writeIndex++] = pending;
      continue;
    }
    if (waitMs <= MAX_PRESENTATION_WAIT_MS) {
      // One rendered frame can legitimately coalesce several rapid inputs.
      // Attribute it to every waiting gesture instead of letting the newest
      // keyup/pointerup overwrite the older gesture's pending evidence.
      recordFrameOnTrace(pending, committedAt, totalMs, meta);
    }
  }
  pendingPresentations.length = writeIndex;
}

/** Close the current interaction and retain it (unless slow-only discards it). */
export function endInteraction(): InteractionTrace | null {
  if (!tracingEnabled || !current) return null;
  current.endedAt = performance.now();
  current.totalMs = Math.max(0, current.endedAt - current.startedAt);
  // A gesture is "slow" if wall time, recorded work, or presentation latency
  // crosses the threshold. Presentation can arrive just after pointerup; that
  // path refreshes this flag and retains a slow-only trace in notifyFrameCommit.
  refreshSlow(current);
  const finished = current;
  current = null;
  if (!slowOnly || finished.slow) retainTrace(finished);
  if (finished.pointerToPresentMs === null) {
    pendingPresentations.push(finished);
    if (pendingPresentations.length > MAX_PENDING_PRESENTATIONS) pendingPresentations.shift();
  }
  return finished;
}

/**
 * Close the active interaction only when it still belongs to `kind`.
 *
 * Burst-idle timers can fire after a newer pointer gesture has started. A
 * kind-aware close prevents that stale timer from terminating the newer
 * authoritative trace.
 */
export function endInteractionIfKind(kind: InteractionKind): InteractionTrace | null {
  if (current?.kind !== kind) return null;
  return endInteraction();
}

export function getRecentInteractionTraces(n = 10): InteractionTrace[] {
  return ring.slice(-n);
}

export function getInteractionTraceCount(): number {
  return ring.length;
}

export function resetInteractionTraces(): void {
  ring.length = 0;
  current = null;
  pendingPresentations.length = 0;
}

export interface LatencyDistribution {
  count: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
}

function percentile(sorted: number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, rank)] ?? 0;
}

function distribution(values: number[]): LatencyDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Roll up distribution of pointer-to-present + total interaction latency. */
export function summarizeInteractionTraces(samples: InteractionTrace[]): {
  count: number;
  slowCount: number;
  avgPointerToPresentMs: number;
  avgTotalMs: number;
  p95TotalMs: number;
  maxTotalMs: number;
  pointerToPresent: LatencyDistribution;
  total: LatencyDistribution;
} {
  const withPresent = samples.filter((t) => t.pointerToPresentMs !== null);
  const pointerToPresentValues = withPresent.map((trace) => trace.pointerToPresentMs ?? 0);
  const totals = samples.map((t) => t.totalMs);
  const totalDistribution = distribution(totals);
  return {
    count: samples.length,
    slowCount: samples.filter((t) => t.slow).length,
    avgPointerToPresentMs:
      withPresent.length > 0
        ? withPresent.reduce((s, t) => s + (t.pointerToPresentMs ?? 0), 0) / withPresent.length
        : 0,
    avgTotalMs:
      samples.length > 0 ? samples.reduce((s, t) => s + t.totalMs, 0) / samples.length : 0,
    p95TotalMs: totalDistribution.p95,
    maxTotalMs: totalDistribution.max,
    pointerToPresent: distribution(pointerToPresentValues),
    total: totalDistribution,
  };
}
