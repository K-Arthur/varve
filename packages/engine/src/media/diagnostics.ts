/**
 * Media diagnostics — dev counters, off by default.
 */

export interface MediaDiagnosticsSnapshot {
  activeSessions: number;
  frameChangesThisTick: number;
  decodedFrames: number;
  cacheFrames: number;
  cacheBytes: number;
  checkpoints: number;
  decodeP50Ms: number;
  decodeP95Ms: number;
  staleDiscarded: number;
  deduplicated: number;
}

interface DiagnosticsState {
  enabled: boolean;
  activeSessions: number;
  frameChangesThisTick: number;
  decodedFrames: number;
  decodeTimesMs: number[];
  staleDiscarded: number;
  deduplicated: number;
}

const state: DiagnosticsState = {
  enabled: false,
  activeSessions: 0,
  frameChangesThisTick: 0,
  decodedFrames: 0,
  decodeTimesMs: [],
  staleDiscarded: 0,
  deduplicated: 0,
};

const DECODE_SAMPLE_LIMIT = 256;

export function enableMediaDiagnostics(): void {
  state.enabled = true;
}

export function disableMediaDiagnostics(): void {
  state.enabled = false;
}

export function mediaDiagnosticsEnabled(): boolean {
  return state.enabled;
}

export function recordMediaDecode(durationMs: number): void {
  if (!state.enabled) return;
  state.decodedFrames++;
  state.decodeTimesMs.push(durationMs);
  if (state.decodeTimesMs.length > DECODE_SAMPLE_LIMIT) state.decodeTimesMs.shift();
}

export function recordFrameChange(): void {
  if (state.enabled) state.frameChangesThisTick++;
}

export function resetTickCounters(): void {
  if (state.enabled) state.frameChangesThisTick = 0;
}

export function recordStaleDiscard(): void {
  if (state.enabled) state.staleDiscarded++;
}

export function recordDedupe(): void {
  if (state.enabled) state.deduplicated++;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

export function snapshotMediaDiagnostics(
  extras: { cacheFrames?: number; cacheBytes?: number; checkpoints?: number } = {},
): MediaDiagnosticsSnapshot | null {
  if (!state.enabled) return null;
  const sorted = [...state.decodeTimesMs].sort((a, b) => a - b);
  return {
    activeSessions: state.activeSessions,
    frameChangesThisTick: state.frameChangesThisTick,
    decodedFrames: state.decodedFrames,
    cacheFrames: extras.cacheFrames ?? 0,
    cacheBytes: extras.cacheBytes ?? 0,
    checkpoints: extras.checkpoints ?? 0,
    decodeP50Ms: percentile(sorted, 50),
    decodeP95Ms: percentile(sorted, 95),
    staleDiscarded: state.staleDiscarded,
    deduplicated: state.deduplicated,
  };
}

export function trackSessionCount(delta: 1 | -1): void {
  if (!state.enabled) return;
  state.activeSessions = Math.max(0, state.activeSessions + delta);
}
