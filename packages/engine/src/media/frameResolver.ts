/**
 * Deterministic time → frame resolution over variable frame durations.
 *
 * A cumulative timing table maps media time to source frames in O(log n).
 * Boundary semantics: `t == cum[i]!` resolves to frame `i` (the frame that
 * *starts* there); `t >= durationMs` resolves to the last frame. Frames with
 * zero duration collapse: they are never "current" at any time (they are
 * still composited — they change canvas state — but a viewer at time t sees
 * their successor).
 */

export interface FrameTiming {
  /** `cum[i]!` = start time (ms) of frame i; `cum[n]!` = total duration. */
  cum: Float64Array;
  frameCount: number;
  totalMs: number;
}

/** Build the cumulative timing table from per-frame durations. */
export function buildFrameTiming(durationsMs: ArrayLike<number>): FrameTiming {
  const n = durationsMs.length;
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const d = durationsMs[i]!;
    if (!Number.isFinite(d) || d < 0) {
      throw new Error(`invalid frame duration ${d} at index ${i}`);
    }
    cum[i + 1]! = cum[i]! + d;
  }
  return { cum, frameCount: n, totalMs: cum[n]! };
}

/**
 * Frame index visible at media time `t` (ms). Upper-bound binary search on
 * the cumulative table: the first frame whose start time is > t, minus one.
 */
export function frameIndexForTime(timing: FrameTiming, tMs: number): number {
  const { cum, frameCount } = timing;
  if (frameCount === 0) return 0;
  if (tMs <= cum[0]!) return 0;
  if (tMs >= cum[frameCount]!) return frameCount - 1;
  // binary search: largest i with cum[i]! <= tMs
  let lo = 0;
  let hi = frameCount;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid]! <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Start/end times of a frame in the source timeline (ms). */
export function timeForFrame(
  timing: FrameTiming,
  frameIndex: number,
): {
  startMs: number;
  endMs: number;
} {
  const clamped = Math.max(0, Math.min(timing.frameCount - 1, frameIndex));
  return { startMs: timing.cum[clamped]!, endMs: timing.cum[clamped + 1]! };
}

/** Total playable duration, collapsing the trailing zero-duration run. */
export function visibleDurationMs(timing: FrameTiming): number {
  let end = timing.frameCount;
  while (end > 0 && timing.cum[end]! === timing.cum[end - 1]) end--;
  return timing.cum[end]!;
}
