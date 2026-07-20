/**
 * Path-projection math for mapping a world-space point to the nearest position
 * along a sampled motion path, returning the corresponding time value. This is
 * the inverse of the time→position mapping used in the MotionPathOverlay.
 */

/** A point on the sampled path with its associated time. */
export interface PathSample {
  /** World-space x coordinate. */
  x: number;
  /** World-space y coordinate. */
  y: number;
  /** Time in milliseconds at this sample. */
  timeMs: number;
}

/** Result of projecting a point onto a polyline path. */
export interface PathProjectionResult {
  /** Interpolated time at the projected point. */
  timeMs: number;
  /** Normalized [0,1] position along the full path. */
  progress: number;
  /** The closest point on the path. */
  point: { x: number; y: number };
  /** Squared distance from the input point to the projected point. */
  dist: number;
  /** Which segment the projection fell on. */
  segmentIndex: number;
}

/** Result of projecting a point with keyframe snapping. */
export interface KeyframeProjectionResult extends PathProjectionResult {
  /** Whether a snap occurred and to what. */
  snapTarget?: 'keyframe' | 'frame' | 'none';
  /** The snapped time in ms, if snapping occurred. */
  snapTimeMs?: number;
}

/** A keyframe entry for snapping. */
export interface KeyframeEntry {
  /** Time in ms of the keyframe. */
  timeMs: number;
  /** Normalized [0,1] position along the path at this keyframe. */
  progress: number;
}

/**
 * Projects a world-space point onto a polyline path (series of PathSample
 * segments). Walks each segment, computes the closest point via perpendicular
 * projection, and returns the best match.
 *
 * @param samples - Ordered array of path samples (at least 2 for a projection).
 * @param worldPoint - The world-space point to project.
 * @returns The projection result with interpolated time, closest point, and distance.
 */
export function projectPointOnPath(
  samples: PathSample[],
  worldPoint: { x: number; y: number },
): PathProjectionResult {
  if (samples.length === 0) {
    return {
      timeMs: 0,
      progress: 0,
      point: { x: worldPoint.x, y: worldPoint.y },
      dist: Infinity,
      segmentIndex: 0,
    };
  }

  if (samples.length === 1) {
    const s = samples[0]!;
    const dx = worldPoint.x - s.x;
    const dy = worldPoint.y - s.y;
    return {
      timeMs: s.timeMs,
      progress: 0,
      point: { x: s.x, y: s.y },
      dist: dx * dx + dy * dy,
      segmentIndex: 0,
    };
  }

  let bestDist = Infinity;
  let bestTimeMs = samples[0]!.timeMs;
  let bestProgress = 0;
  let bestPoint = { x: samples[0]!.x, y: samples[0]!.y };
  let bestSegIndex = 0;

  const totalPathLength = computePathLength(samples);

  for (let i = 0; i < samples.length - 1; i++) {
    const p1 = samples[i]!;
    const p2 = samples[i + 1]!;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lenSq = dx * dx + dy * dy;

    let t: number;
    if (lenSq < 1e-12) {
      t = 0;
    } else {
      t = ((worldPoint.x - p1.x) * dx + (worldPoint.y - p1.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;
    const dpx = worldPoint.x - projX;
    const dpy = worldPoint.y - projY;
    const distSq = dpx * dpx + dpy * dpy;

    if (distSq < bestDist) {
      bestDist = distSq;
      bestTimeMs = p1.timeMs + t * (p2.timeMs - p1.timeMs);
      const segProgress = totalPathLength > 0 ? (Math.sqrt(lenSq) * t) / totalPathLength : 0;
      bestProgress = computeProgressUpToSegment(samples, i, totalPathLength) + segProgress;
      bestPoint = { x: projX, y: projY };
      bestSegIndex = i;
    }
  }

  return {
    timeMs: bestTimeMs,
    progress: Math.max(0, Math.min(1, bestProgress)),
    point: bestPoint,
    dist: bestDist,
    segmentIndex: bestSegIndex,
  };
}

/**
 * Projects a point onto the path and snaps to the nearest keyframe if within
 * the threshold distance.
 *
 * @param samples - Ordered array of path samples.
 * @param worldPoint - The world-space point to project.
 * @param keyframeTimes - Keyframe entries for snapping.
 * @param threshold - Distance threshold for snapping (squared comparison). Defaults to 64 (8px).
 * @returns Projection result with optional snap information.
 */
export function projectPointOnPathWithKeyframes(
  samples: PathSample[],
  worldPoint: { x: number; y: number },
  keyframeTimes: KeyframeEntry[],
  threshold = 64,
): KeyframeProjectionResult {
  const base = projectPointOnPath(samples, worldPoint);

  const result: KeyframeProjectionResult = {
    ...base,
    snapTarget: 'none',
  };

  if (keyframeTimes.length === 0) {
    return result;
  }

  let nearestKf: KeyframeEntry | null = null;
  let nearestDist = Infinity;

  for (const kf of keyframeTimes) {
    const dp = base.progress - kf.progress;
    const progressDistSq = dp * dp;
    if (progressDistSq < nearestDist) {
      nearestDist = progressDistSq;
      nearestKf = kf;
    }
  }

  if (nearestKf && nearestDist <= threshold) {
    result.snapTarget = 'keyframe';
    result.snapTimeMs = nearestKf.timeMs;
    result.timeMs = nearestKf.timeMs;
    result.progress = nearestKf.progress;
  }

  return result;
}

/**
 * Snaps a time value to the nearest frame boundary.
 *
 * @param timeMs - Time in milliseconds to snap.
 * @param fps - Frames per second. Defaults to 60.
 * @returns The snapped time in ms.
 */
export function snapToFrame(timeMs: number, fps = 60): number {
  const frameDuration = 1000 / fps;
  return Math.round(timeMs / frameDuration) * frameDuration;
}

/**
 * Snaps to the nearest keyframe if within the given threshold.
 *
 * @param timeMs - Time in ms to snap.
 * @param keyframes - Array of keyframe times in ms.
 * @param threshold - Max time distance (ms) for snapping. Defaults to 30.
 * @returns Object with `snapped` flag and resulting time.
 */
export function snapToKeyframe(
  timeMs: number,
  keyframes: number[],
  threshold = 30,
): { snapped: boolean; timeMs: number } {
  if (keyframes.length === 0) {
    return { snapped: false, timeMs };
  }

  let nearestTime = keyframes[0]!;
  let nearestDist = Math.abs(timeMs - nearestTime);

  for (let i = 1; i < keyframes.length; i++) {
    const d = Math.abs(timeMs - keyframes[i]!);
    if (d < nearestDist) {
      nearestDist = d;
      nearestTime = keyframes[i]!;
    }
  }

  if (nearestDist <= threshold) {
    return { snapped: true, timeMs: nearestTime };
  }

  return { snapped: false, timeMs };
}

/**
 * Finds the index of the keyframe whose timeMs is closest to the given time.
 *
 * @param samples - Path samples containing keyframe times.
 * @param timeMs - The time to match.
 * @returns Index of the nearest keyframe sample, or 0 if empty.
 */
export function findNearestKeyframeIndex(samples: PathSample[], timeMs: number): number {
  if (samples.length === 0) return 0;

  let bestIndex = 0;
  let bestDist = Math.abs(samples[0]!.timeMs - timeMs);

  for (let i = 1; i < samples.length; i++) {
    const d = Math.abs(samples[i]!.timeMs - timeMs);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }

  return bestIndex;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function computePathLength(samples: PathSample[]): number {
  let len = 0;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

function computeProgressUpToSegment(
  samples: PathSample[],
  segIndex: number,
  totalLength: number,
): number {
  if (totalLength <= 0) return 0;
  let len = 0;
  for (let i = 0; i < segIndex; i++) {
    const a = samples[i]!;
    const b = samples[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len / totalLength;
}
