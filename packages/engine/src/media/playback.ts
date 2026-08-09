/**
 * Per-usage media playback resolution: global editor time + usage settings +
 * asset timing → source frame index.
 *
 * Deterministic: the same inputs always produce the same frame, in canvas,
 * export, video, and tests. Reverse playback is `rate < 0` through the same
 * resolver. Loop modes:
 *   - `source`: honors the container loop count (`'infinite'` loops; a
 *     finite count plays that many iterations then holds the last frame)
 *   - `once`: plays the trimmed window once, then holds the last frame
 *   - `loop`: infinite loop over the trimmed window
 *   - `pingpong`: infinite alternate over the trimmed window
 */

import { buildFrameTiming, type FrameTiming, frameIndexForTime } from './frameResolver';
import type { MediaFillSettings, ResolvedMediaFrame } from './types';

export interface MediaUsageInput {
  settings: MediaFillSettings;
  /** Container loop count from the asset metadata. */
  sourceLoopCount: number | 'infinite';
  /** Source timing table (untrimmed). */
  timing: FrameTiming;
}

function mod(a: number, b: number): number {
  const r = a % b;
  return r < 0 ? r + b : r;
}

/**
 * Resolve the source frame index visible at `globalTimeMs` for one usage.
 * `outPointMs === 0` on the settings means "asset end".
 */
export function resolveUsageFrame(
  input: MediaUsageInput,
  globalTimeMs: number,
): ResolvedMediaFrame {
  const { settings, sourceLoopCount, timing } = input;
  const outPoint = settings.outPointMs > 0 ? settings.outPointMs : timing.totalMs;
  const inPoint = Math.min(settings.inPointMs, outPoint);
  const span = outPoint - inPoint;

  const raw = (globalTimeMs - settings.startOffsetMs) * settings.rate;
  const direction: 1 | -1 = settings.rate >= 0 ? 1 : -1;

  let iterations = Infinity;
  if (settings.loopMode === 'once') iterations = 1;
  else if (settings.loopMode === 'source' && sourceLoopCount !== 'infinite') {
    iterations = Math.max(1, sourceLoopCount);
  }

  let t: number;
  let iteration = 0;
  let atEnd = false;

  if (span <= 0) {
    t = inPoint;
  } else if (iterations === Infinity) {
    if (settings.loopMode === 'pingpong') {
      const period = 2 * span;
      const p = mod(raw - inPoint, period);
      iteration = Math.floor((raw - inPoint) / period);
      t = p <= span ? inPoint + p : inPoint + (2 * span - p);
    } else {
      const p = mod(raw - inPoint, span);
      iteration = Math.floor((raw - inPoint) / span);
      t = inPoint + p;
    }
  } else {
    // finite iterations: after the last iteration, hold the end frame
    const elapsed = raw - inPoint;
    if (direction > 0 && elapsed >= iterations * span) {
      t = outPoint;
      iteration = iterations - 1;
      atEnd = true;
    } else if (direction < 0 && elapsed <= -(iterations * span)) {
      t = inPoint;
      iteration = iterations - 1;
      atEnd = true;
    } else {
      const p = mod(elapsed, span);
      iteration = Math.floor(elapsed / span);
      t = inPoint + p;
    }
  }

  const frameIndex = frameIndexForTime(timing, t);
  return {
    frameIndex,
    iteration: Math.max(0, iteration),
    direction,
    atEnd,
    windowMs: t - inPoint,
  };
}

/** Convenience wrapper for callers holding `AnimatedImageMetadata`. */
export function usageTiming(frames: ArrayLike<{ durationMs: number }>): FrameTiming {
  const durations: number[] = [];
  for (let i = 0; i < frames.length; i++) durations.push(frames[i]!.durationMs);
  return buildFrameTiming(durations);
}
