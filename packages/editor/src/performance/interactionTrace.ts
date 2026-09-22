/**
 * Interaction traces — bounded gesture-level telemetry connecting pointer
 * input to presented frames.
 *
 * Groups per-event spans and per-frame commit times into interactions keyed
 * by a monotonic correlation ID. Trace v4 keeps handler/commit evidence
 * separate from browser next-paint feedback and accepts an explicit causal
 * frame ID from the redraw pipeline. Off by default; slow-capture mode keeps
 * only gestures that exceed a configurable threshold.
 */
import { eventQueueDelayMs } from './clockDomain';

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
  /** Renderer decision, independent from interaction causality. */
  frameDecision?: 'content' | 'present' | 'skip';
  /** Why this frame belongs to the interaction, when the renderer supplied it. */
  causalRelation?: FrameDisposition;
  /** @deprecated Use causalRelation. */
  disposition?: FrameDisposition;
  /** Pixel identity of the frame, when the render path reported one. */
  renderRevision?: number;
}

export interface InteractionTrace {
  schemaVersion: 4;
  /** Stable per-page-load identity; distinguishes traces across reloads. */
  sessionId: string;
  /** Monotonic correlation ID connecting input events to presented frames. */
  id: number;
  kind: InteractionKind;
  /** Monotonic per-interaction pointer sample counter (last assigned value). */
  pointerSequenceId: number;
  /** Timestamp of the first event in the main performance clock domain. */
  startedAt: number;
  /** Whether startedAt came from a trusted DOM timestamp or handler entry. */
  timestampSource: 'dom.event.timeStamp' | 'handler.performance.now';
  /** Delay between the first DOM event timestamp and handler entry, if trusted. */
  initialQueueDelayMs: number | null;
  /** Largest trusted event-to-handler delay observed in this interaction. */
  maxQueueDelayMs: number | null;
  /** Invalid/untrusted timestamps observed while tracing this interaction. */
  untrustedQueueDelayCount: number;
  endedAt: number;
  eventCount: number;
  frameCount: number;
  /** Frame commit times (performance.now()) and durations during the gesture. */
  frames: InteractionFrameSample[];
  spans: InteractionSpan[];
  /** First canvas commit after the gesture started (ms), or null. */
  inputToCommitMs: number | null;
  /** Input → browser next paint, only when Event Timing/native evidence exists. */
  inputToNextPaintMs: number | null;
  presentationEvidence: {
    source: 'event-timing' | 'native-profiler' | 'raf-lower-bound' | 'unavailable';
    clockTrust: 'trusted' | 'handler-origin' | 'unavailable';
    uncertaintyMs: number | null;
    missingReason?: 'unsupported' | 'not-observed' | 'correlation-failed' | 'timeout';
  };
  /** @deprecated Migration-only alias; never use for summaries or gates. */
  deprecated: {
    pointerToPresentMs: number | null;
  };
  /** True once a document/camera/overlay mutation requires a replacement frame. */
  presentationExpected: boolean;
  /** Missing frame/evidence is an instrumentation failure, never zero latency. */
  instrumentationErrors: string[];
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
const pendingPresentationTimers = new Map<number, ReturnType<typeof setTimeout>>();
const NOOP_SPAN_END = () => undefined;

function refreshSlow(trace: InteractionTrace): void {
  trace.slow =
    Math.max(
      trace.totalMs,
      trace.busyMs,
      trace.inputToCommitMs ?? 0,
      trace.inputToNextPaintMs ?? 0,
      trace.maxQueueDelayMs ?? 0,
    ) >= slowThresholdMs;
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

export function beginInteraction(kind: InteractionKind, eventTimeStamp?: number): void {
  if (!tracingEnabled) return;
  if (current) endInteraction();
  const handlerStartedAt = performance.now();
  const initialQueueDelayMs =
    typeof eventTimeStamp === 'number' ? eventQueueDelayMs(eventTimeStamp, handlerStartedAt) : null;
  current = {
    schemaVersion: 4,
    sessionId,
    id: nextId++,
    kind,
    pointerSequenceId: 0,
    startedAt:
      initialQueueDelayMs === null ? handlerStartedAt : handlerStartedAt - initialQueueDelayMs,
    timestampSource:
      initialQueueDelayMs === null ? 'handler.performance.now' : 'dom.event.timeStamp',
    initialQueueDelayMs,
    maxQueueDelayMs: initialQueueDelayMs,
    untrustedQueueDelayCount:
      typeof eventTimeStamp === 'number' && initialQueueDelayMs === null ? 1 : 0,
    endedAt: 0,
    eventCount: 0,
    frameCount: 0,
    frames: [],
    spans: [],
    inputToCommitMs: null,
    inputToNextPaintMs: null,
    presentationEvidence: {
      source: 'unavailable',
      clockTrust: initialQueueDelayMs === null ? 'handler-origin' : 'trusted',
      uncertaintyMs: null,
    },
    deprecated: { pointerToPresentMs: null },
    presentationExpected: false,
    instrumentationErrors: [],
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

/** Mark the active trace as requiring a frame for a canvas-changing action. */
export function markInteractionCanvasChanged(): InteractionIdentity | null {
  if (!tracingEnabled || !current) return null;
  current.presentationExpected = true;
  return getActiveInteractionIdentity();
}

/** IDs that the redraw pipeline must carry into its next committed frame. */
export function getPresentationCauseIds(): number[] {
  const ids: number[] = [];
  if (current?.presentationExpected) ids.push(current.id);
  for (const trace of pendingPresentations) {
    if (trace.presentationExpected && !ids.includes(trace.id)) ids.push(trace.id);
  }
  return ids;
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
  if (name.endsWith('.input') || attributes?.eventSequenceId !== undefined) {
    trace.eventCount++;
  }
  const queueDelayMs = attributes?.queueDelayMs;
  if (typeof queueDelayMs === 'number' && Number.isFinite(queueDelayMs)) {
    trace.maxQueueDelayMs = Math.max(trace.maxQueueDelayMs ?? 0, queueDelayMs);
  }
  if (attributes?.queueDelayClock === 'untrusted') trace.untrustedQueueDelayCount++;
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

/** Record one browser input sample without folding it into handler duration. */
export function recordInteractionEventSample(
  source: string,
  eventTimeStamp: number | undefined,
  eventSequenceId: string | undefined,
  timestampTrusted = true,
): void {
  if (!tracingEnabled || !current) return;
  const now = performance.now();
  const queueDelayMs =
    timestampTrusted && typeof eventTimeStamp === 'number'
      ? eventQueueDelayMs(eventTimeStamp, now)
      : null;
  appendSpan(current, `${source}.sample`, now, 0, {
    ...(eventSequenceId ? { eventSequenceId } : {}),
    ...(timestampTrusted && typeof eventTimeStamp === 'number' && Number.isFinite(eventTimeStamp)
      ? { eventTimeStamp }
      : {}),
    ...(queueDelayMs === null
      ? { queueDelayClock: 'untrusted' }
      : { queueDelayMs, queueDelayClock: 'dom.event.timeStamp' }),
  });
}

/** Attach a late diagnostic span to its originating trace without changing
 * next-paint evidence or whichever interaction happens to be active now. */
export function recordInteractionDiagnosticAt(
  name: string,
  startTimeMs: number,
  durationMs: number,
  attributes?: InteractionSpan['attributes'],
): boolean {
  if (!tracingEnabled || durationMs < 0) return false;
  const candidates = [...(current ? [current] : []), ...pendingPresentations, ...ring];
  const trace = candidates.find((candidate) => {
    const end = candidate.endedAt > 0 ? candidate.endedAt : performance.now();
    return startTimeMs >= candidate.startedAt - 1 && startTimeMs <= end + 1;
  });
  if (!trace) return false;
  appendSpan(trace, name, startTimeMs, durationMs, attributes);
  return true;
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
  if (trace.inputToCommitMs === null) {
    trace.inputToCommitMs = Math.max(0, committedAt - trace.startedAt);
    trace.deprecated.pointerToPresentMs = trace.inputToCommitMs;
  }
  if (trace.endedAt > 0) {
    refreshSlow(trace);
    if (!slowOnly || trace.slow) retainTrace(trace);
  }
  if (trace.frames.length >= MAX_INTERACTION_FRAMES) {
    trace.droppedFrameCount++;
    return;
  }
  const causalRelation =
    meta?.causalRelation ??
    (meta?.causeIds?.includes(trace.id)
      ? meta.causeIds.length > 1
        ? 'coalesced'
        : 'caused'
      : undefined);
  trace.frames.push({
    committedAt,
    totalMs,
    ...(meta?.frameDecision ? { frameDecision: meta.frameDecision } : {}),
    ...(causalRelation ? { causalRelation } : {}),
    ...(meta?.disposition ? { disposition: meta.disposition } : {}),
    ...(meta?.renderRevision !== undefined ? { renderRevision: meta.renderRevision } : {}),
  });
}

export interface FrameCommitMeta {
  frameDecision?: 'content' | 'present' | 'skip';
  causalRelation?: FrameDisposition;
  /** Explicit interaction IDs whose state this frame replaces. */
  causeIds?: readonly number[];
  /** @deprecated Use causalRelation. */
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
  if (current && (matchesFrameCause(current, meta) || !current.presentationExpected)) {
    recordFrameOnTrace(current, committedAt, totalMs, meta);
  }
  if (pendingPresentations.length === 0) return;
  let writeIndex = 0;
  for (const pending of pendingPresentations) {
    const waitMs = committedAt - pending.endedAt;
    if (waitMs < 0) {
      pendingPresentations[writeIndex++] = pending;
      continue;
    }
    if (waitMs <= MAX_PRESENTATION_WAIT_MS && matchesFrameCause(pending, meta)) {
      // One rendered frame can legitimately coalesce several rapid inputs.
      // Attribute it to every waiting gesture instead of letting the newest
      // keyup/pointerup overwrite the older gesture's pending evidence.
      recordFrameOnTrace(pending, committedAt, totalMs, meta);
      // Keep the trace pending after commit until Event Timing/native evidence
      // arrives, otherwise a late next-paint entry would have to rediscover a
      // trace from the ring and could be evicted before it is observed.
      if (!pending.presentationExpected || pending.inputToNextPaintMs !== null) {
        clearPendingPresentation(pending.id);
      } else {
        pendingPresentations[writeIndex++] = pending;
      }
    } else if (waitMs <= MAX_PRESENTATION_WAIT_MS) {
      pendingPresentations[writeIndex++] = pending;
    } else {
      clearPendingPresentation(pending.id);
      markPresentationTimeout(pending);
    }
  }
  pendingPresentations.length = writeIndex;
}

function matchesFrameCause(trace: InteractionTrace, meta?: FrameCommitMeta): boolean {
  if (!trace.presentationExpected) return true;
  return meta?.causeIds?.includes(trace.id) === true;
}

function clearPendingPresentation(id: number): void {
  const timer = pendingPresentationTimers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  pendingPresentationTimers.delete(id);
}

function markPresentationTimeout(trace: InteractionTrace): void {
  if (trace.inputToCommitMs === null && trace.presentationExpected) {
    trace.instrumentationErrors.push('missing-caused-frame');
  }
  if (trace.inputToNextPaintMs === null && trace.presentationEvidence.source === 'unavailable') {
    trace.presentationEvidence = {
      source: 'unavailable',
      clockTrust: 'unavailable',
      uncertaintyMs: null,
      missingReason: 'timeout',
    };
  }
  refreshSlow(trace);
  if (!slowOnly || trace.slow) retainTrace(trace);
}

export interface NextPaintEvidence {
  /** Event Timing startTime in the main performance clock domain. */
  startTimeMs: number;
  durationMs: number;
  source: 'event-timing' | 'native-profiler';
  clockTrust: 'trusted' | 'handler-origin';
  uncertaintyMs: number | null;
  eventName?: string;
}

/**
 * Attach asynchronous next-paint evidence to the originating trace. Event
 * Timing callbacks arrive after React and the active trace have already
 * closed, so this never writes to whichever interaction happens to be open.
 * A caller that has a native correlation ID may pass it through `traceId`;
 * browser-only evidence must match the timestamp recorded on the originating
 * input span; a broad trace time-window match would attribute a late paint to
 * the wrong interaction when gestures overlap.
 */
export function recordNextPaintEvidence(evidence: NextPaintEvidence, traceId?: number): boolean {
  if (!tracingEnabled || !Number.isFinite(evidence.durationMs)) return false;
  const candidates = [...(current ? [current] : []), ...pendingPresentations, ...ring];
  const trace = candidates.find((candidate) => {
    if (traceId !== undefined && candidate.id !== traceId) return false;
    if (candidate.inputToNextPaintMs !== null) return false;
    if (traceId !== undefined) return true;
    return candidate.spans.some((span) => {
      const eventTimeStamp = span.attributes?.eventTimeStamp;
      return (
        typeof eventTimeStamp === 'number' && Math.abs(eventTimeStamp - evidence.startTimeMs) <= 0.5
      );
    });
  });
  if (!trace) return false;
  trace.inputToNextPaintMs = Math.max(0, evidence.durationMs);
  trace.presentationEvidence = {
    source: evidence.source,
    clockTrust: evidence.clockTrust,
    uncertaintyMs: evidence.uncertaintyMs,
  };
  appendSpan(trace, 'present.feedback', evidence.startTimeMs, evidence.durationMs, {
    evidence: evidence.source,
    ...(evidence.eventName ? { eventName: evidence.eventName } : {}),
    ...(evidence.uncertaintyMs === null ? {} : { uncertaintyMs: evidence.uncertaintyMs }),
  });
  refreshSlow(trace);
  if (!slowOnly || trace.slow) retainTrace(trace);
  clearPendingPresentation(trace.id);
  const pendingIndex = pendingPresentations.indexOf(trace);
  if (pendingIndex >= 0) pendingPresentations.splice(pendingIndex, 1);
  return true;
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
  if (finished.inputToCommitMs === null || finished.inputToNextPaintMs === null) {
    pendingPresentations.push(finished);
    if (pendingPresentations.length > MAX_PENDING_PRESENTATIONS) pendingPresentations.shift();
    const timer = setTimeout(() => {
      const index = pendingPresentations.indexOf(finished);
      if (index >= 0) pendingPresentations.splice(index, 1);
      clearPendingPresentation(finished.id);
      markPresentationTimeout(finished);
    }, MAX_PRESENTATION_WAIT_MS);
    pendingPresentationTimers.set(finished.id, timer);
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
  for (const timer of pendingPresentationTimers.values()) clearTimeout(timer);
  pendingPresentationTimers.clear();
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

/** Roll up commit, next-paint, queue, and total interaction latency. */
export function summarizeInteractionTraces(samples: InteractionTrace[]): {
  count: number;
  slowCount: number;
  avgTotalMs: number;
  p95TotalMs: number;
  maxTotalMs: number;
  inputToCommit: LatencyDistribution;
  inputToNextPaint: LatencyDistribution;
  total: LatencyDistribution;
  queueDelay: LatencyDistribution;
  untrustedQueueDelayCount: number;
  timestampSources: Record<InteractionTrace['timestampSource'], number>;
  presentationEvidence: Record<InteractionTrace['presentationEvidence']['source'], number>;
} {
  const withPresent = samples.filter((t) => t.inputToCommitMs !== null);
  const inputToCommitValues = withPresent.map((trace) => trace.inputToCommitMs ?? 0);
  const nextPaintValues = samples
    .map((trace) => trace.inputToNextPaintMs)
    .filter((value): value is number => value !== null);
  const totals = samples.map((t) => t.totalMs);
  const queueDelays = samples.flatMap((trace) => {
    const seenEventIds = new Set<string>();
    const values: number[] = [];
    if (trace.initialQueueDelayMs !== null) {
      values.push(trace.initialQueueDelayMs);
      seenEventIds.add('initial');
    }
    for (const span of trace.spans) {
      const delay = span.attributes?.queueDelayMs;
      if (typeof delay !== 'number' || !Number.isFinite(delay)) continue;
      const eventId = span.attributes?.eventSequenceId;
      if (typeof eventId === 'string') {
        if (seenEventIds.has(eventId)) continue;
        seenEventIds.add(eventId);
      } else if (seenEventIds.has('initial') && values.length === 1 && delay === values[0]) {
        // v3 spans had no event ID and duplicated the initial sample. Keep
        // the first canonical event once while retaining every later span.
        seenEventIds.delete('initial');
        continue;
      }
      values.push(delay);
    }
    return values;
  });
  const totalDistribution = distribution(totals);
  return {
    count: samples.length,
    slowCount: samples.filter((t) => t.slow).length,
    avgTotalMs:
      samples.length > 0 ? samples.reduce((s, t) => s + t.totalMs, 0) / samples.length : 0,
    p95TotalMs: totalDistribution.p95,
    maxTotalMs: totalDistribution.max,
    inputToCommit: distribution(inputToCommitValues),
    inputToNextPaint: distribution(nextPaintValues),
    total: totalDistribution,
    queueDelay: distribution(queueDelays),
    untrustedQueueDelayCount: samples.reduce(
      (count, trace) => count + trace.untrustedQueueDelayCount,
      0,
    ),
    timestampSources: samples.reduce(
      (sources, trace) => {
        sources[trace.timestampSource]++;
        return sources;
      },
      {
        'dom.event.timeStamp': 0,
        'handler.performance.now': 0,
      } as Record<InteractionTrace['timestampSource'], number>,
    ),
    presentationEvidence: samples.reduce(
      (sources, trace) => {
        sources[trace.presentationEvidence.source]++;
        return sources;
      },
      {
        'event-timing': 0,
        'native-profiler': 0,
        'raf-lower-bound': 0,
        unavailable: 0,
      } as Record<InteractionTrace['presentationEvidence']['source'], number>,
    ),
  };
}
