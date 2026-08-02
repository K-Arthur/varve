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
export type InteractionKind = 'pointer-drag' | 'wheel' | 'pinch' | 'keyboard' | 'unknown';

export interface InteractionSpan {
  /** Stable span name, e.g. 'pointer.input', 'interaction.dispatch'. */
  name: string;
  startTimeMs: number;
  durationMs: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface InteractionTrace {
  /** Monotonic correlation ID connecting input events to presented frames. */
  id: number;
  kind: InteractionKind;
  /** performance.now() of the first event. */
  startedAt: number;
  endedAt: number;
  eventCount: number;
  frameCount: number;
  /** Frame commit times (performance.now()) and durations during the gesture. */
  frames: Array<{ committedAt: number; totalMs: number }>;
  spans: InteractionSpan[];
  /** First presented frame after the gesture started (ms), or null. */
  pointerToPresentMs: number | null;
  totalMs: number;
  /** Sum of recorded span durations (work actually spent in the gesture). */
  busyMs: number;
  slow: boolean;
}

const MAX_INTERACTION_TRACES = 50;
const DEFAULT_SLOW_THRESHOLD_MS = 50;
const ring: InteractionTrace[] = [];
let tracingEnabled = false;
let slowOnly = false;
let slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS;
let nextId = 1;
let current: InteractionTrace | null = null;

export function enableInteractionTraces(force?: boolean): void {
  tracingEnabled = force === true;
  if (!tracingEnabled) {
    current = null;
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
    id: nextId++,
    kind,
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
  };
}

/** Record a per-event span (e.g. the pointermove handler duration). */
export function recordInteractionSpan(
  name: string,
  durationMs: number,
  attributes?: InteractionSpan['attributes'],
): void {
  if (!tracingEnabled || !current || durationMs < 0) return;
  current.eventCount++;
  current.busyMs += durationMs;
  current.spans.push({
    name,
    startTimeMs: performance.now() - durationMs,
    durationMs,
    attributes,
  });
}

/** Called for every presented frame (see perfRuntime.recordFrame). */
export function notifyFrameCommit(committedAt: number, totalMs: number): void {
  if (!tracingEnabled || !current) return;
  current.frames.push({ committedAt, totalMs });
  current.frameCount++;
}

/** Close the current interaction and retain it (unless slow-only discards it). */
export function endInteraction(): InteractionTrace | null {
  if (!tracingEnabled || !current) return null;
  current.endedAt = performance.now();
  current.totalMs = Math.max(0, current.endedAt - current.startedAt);
  const firstFrame = current.frames[0];
  if (firstFrame)
    current.pointerToPresentMs = Math.max(0, firstFrame.committedAt - current.startedAt);
  // A gesture is "slow" if it wall-clocked past the threshold OR spent that
  // much time in event handlers (a single heavy move can be slow while the
  // wall time between down and up is tiny).
  current.slow = Math.max(current.totalMs, current.busyMs) >= slowThresholdMs;
  const finished = current;
  current = null;
  if (slowOnly && !finished.slow) return finished;
  ring.push(finished);
  if (ring.length > MAX_INTERACTION_TRACES) ring.shift();
  return finished;
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
}

/** Roll up distribution of pointer-to-present + total interaction latency. */
export function summarizeInteractionTraces(samples: InteractionTrace[]): {
  count: number;
  slowCount: number;
  avgPointerToPresentMs: number;
  avgTotalMs: number;
  p95TotalMs: number;
  maxTotalMs: number;
} {
  const withPresent = samples.filter((t) => t.pointerToPresentMs !== null);
  const totals = samples.map((t) => t.totalMs).sort((a, b) => a - b);
  return {
    count: samples.length,
    slowCount: samples.filter((t) => t.slow).length,
    avgPointerToPresentMs:
      withPresent.length > 0
        ? withPresent.reduce((s, t) => s + (t.pointerToPresentMs ?? 0), 0) / withPresent.length
        : 0,
    avgTotalMs:
      samples.length > 0 ? samples.reduce((s, t) => s + t.totalMs, 0) / samples.length : 0,
    p95TotalMs: totals.length > 0 ? (totals[Math.floor(totals.length * 0.95)] ?? 0) : 0,
    maxTotalMs: totals.length > 0 ? (totals[totals.length - 1] ?? 0) : 0,
  };
}
