/**
 * Centralized cubic Bezier path operations for editing.
 *
 * Provides geometry-preserving insertion (de Casteljau subdivision) and
 * deletion (exact recombination or best-fit) that the Pen and NodeEdit
 * tools share.
 *
 * All coordinates follow the engine PathPoint convention:
 *   anchors at (x, y), handles as relative offsets [hx, hy] or null.
 */

import type { CubicBezier, PathPoint } from './bezier';
import { cubicBezierDerivative, cubicBezierPoint, cubicBezierSplit } from './bezier';

// Re-export engine types for convenience
export type { CubicBezier, PathPoint } from './bezier';

const EPS = 1e-6;

// ─── PathPoint <-> CubicBezier conversion ────────────────────────────────

/**
 * Convert two consecutive PathPoints into the corresponding CubicBezier
 * segment. Missing handles are treated as linear (corner points).
 */
export function segmentToCubic(from: PathPoint, to: PathPoint): CubicBezier {
  const p0 = { x: from.x, y: from.y };
  const p3 = { x: to.x, y: to.y };
  const p1 = from.handleOut
    ? { x: from.x + from.handleOut[0], y: from.y + from.handleOut[1] }
    : { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
  const p2 = to.handleIn
    ? { x: to.x + to.handleIn[0], y: to.y + to.handleIn[1] }
    : { x: p0.x + (2 * (p3.x - p0.x)) / 3, y: p0.y + (2 * (p3.y - p0.y)) / 3 };
  return { p0, p1, p2, p3 };
}

/**
 * Convert a CubicBezier back to a PathPoint pair, producing the outgoing
 * handle on `from` and the incoming handle on `to`.
 */
export function cubicToSegments(cb: CubicBezier): { from: PathPoint; to: PathPoint } {
  const from: PathPoint = {
    x: cb.p0.x,
    y: cb.p0.y,
    handleIn: null,
    handleOut: [cb.p1.x - cb.p0.x, cb.p1.y - cb.p0.y],
  };
  const to: PathPoint = {
    x: cb.p3.x,
    y: cb.p3.y,
    handleIn: [cb.p2.x - cb.p3.x, cb.p2.y - cb.p3.y],
    handleOut: null,
  };
  return { from, to };
}

// ─── Geometry-preserving insertion (de Casteljau) ──────────────────────

/**
 * Insert a point at parameter t on the segment between points[i] and
 * points[i+1] using de Casteljau subdivision. The curve geometry is
 * preserved exactly (floating-point tolerance).
 *
 * @param points - the full path point array
 * @param segmentIndex - index of the first endpoint of the target segment
 * @param t - parameter on [0, 1] where to split
 * @returns a new array with the inserted point
 */
export function insertPointOnSegment(
  points: readonly PathPoint[],
  segmentIndex: number,
  t: number,
): PathPoint[] {
  const from = points[segmentIndex];
  const to = points[segmentIndex + 1];
  if (!from || !to) return [...points];

  const cb = segmentToCubic(from, to);
  const [left, right] = cubicBezierSplit(cb, t);

  // Build new point array: ...points[segmentIndex], newPoint, points[segmentIndex+1],...
  // left.p0 = from (keep original), left.p3 = S (new point), right.p3 = to (keep original)
  const newPt: PathPoint = {
    x: left.p3.x,
    y: left.p3.y,
    handleIn: [left.p2.x - left.p3.x, left.p2.y - left.p3.y],
    handleOut: [right.p1.x - right.p0.x, right.p1.y - right.p0.y],
  };

  // The new "from" point keeps its original anchor but gets left's outgoing handle
  const updatedFrom: PathPoint = {
    ...from,
    handleOut: [left.p1.x - left.p0.x, left.p1.y - left.p0.y],
  };

  // The new "to" point keeps its original anchor but gets right's incoming handle
  const updatedTo: PathPoint = {
    ...to,
    handleIn: [right.p2.x - right.p3.x, right.p2.y - right.p3.y],
  };

  const result = [...points];
  result[segmentIndex] = updatedFrom;
  result.splice(segmentIndex + 1, 0, newPt);
  // updatedTo goes at the position after the new point
  const toIdx = segmentIndex + 2;
  if (toIdx < result.length) {
    result[toIdx] = updatedTo;
  }
  return result;
}

// ─── Geometry-preserving deletion ──────────────────────────────────────

/**
 * Attempt to check whether two adjacent cubic segments can be exactly
 * recombined into one cubic (i.e., they are the result of a previous
 * subdivision of a single cubic).
 *
 * Two cubics C1 and C2 are recombinable if:
 *   C2.p0 ≈ C1.p3  (they share the split point)
 *   C1.p1 ≈ lerp(C1.p0, C2.p1, 0.5)
 *   C1.p2 ≈ lerp(C1.p3, C2.p2, 0.5)
 *   (This is the de Casteljau subdivision identity at t=0.5)
 *
 * We generalize to arbitrary t by checking if:
 *   C1.p1 = lerp(P0, P1_orig, t)
 *   C1.p2 = lerp(lerp(P0, P1_orig, t), lerp(P1_orig, P2_orig, t), t)
 * etc. Since we don't know the original cubic, we test the structural
 * constraint: the control polygon of the two sub-curves must be consistent
 * with a single cubic's control polygon at the same t.
 */
export function canRecombineCubics(
  left: CubicBezier,
  right: CubicBezier,
  tolerance = EPS,
): { ok: boolean; recombined: CubicBezier | null } {
  // The shared point must match
  if (
    Math.abs(left.p3.x - right.p0.x) > tolerance ||
    Math.abs(left.p3.y - right.p0.y) > tolerance
  ) {
    return { ok: false, recombined: null };
  }

  // Given de Casteljau split at parameter t of original {P0,P1,P2,P3}:
  //   left  = { P0, a, d, S } where a = lerp(P0,P1,t), d = lerp(a,b,t)
  //   right = { S, e, c, P3 } where c = lerp(P2,P3,t), e = lerp(b,c,t)
  //   and b = lerp(P1,P2,t), S = lerp(d,e,t)
  //
  // From the endpoints:
  //   P1 = (left.p1 - u*P0) / t   where u = 1-t
  //   P2 = (right.p2 - t*P3) / u
  //
  // Verify intermediate: d = lerp(a, b, t) and e = lerp(b, c, t)
  //   where a = left.p1, c = right.p2, b = lerp(P1,P2,t)

  const p0 = left.p0;
  const p3 = right.p3;

  // Solve for t: from d and e constraints.
  // d = (1-t)*a + t*b  and  e = (1-t)*b + t*c
  // S = (1-t)*d + t*e
  // Also d = left.p2, e = right.p1

  // Use the constraint that a, d, S must be consistent with de Casteljau:
  //   d = (1-t)*a + t*b  →  b = (d - (1-t)*a) / t
  //   e = (1-t)*b + t*c
  //   S = (1-t)*d + t*e
  //
  // From S = (1-t)*d + t*e:
  //   t = (S - d) / (e - d) per-component

  // S = (1-t)d + te → t = (S - d) / (e - d) per component
  const sx = left.p3.x - left.p2.x;
  const sy = left.p3.y - left.p2.y;
  const ex = right.p1.x - left.p2.x;
  const ey = right.p1.y - left.p2.y;

  const lenDE = Math.hypot(ex, ey);
  if (lenDE < tolerance) {
    return { ok: false, recombined: null };
  }

  let t: number;
  if (Math.abs(ex) > Math.abs(ey)) {
    t = sx / ex;
  } else {
    t = sy / ey;
  }

  if (t <= tolerance || t >= 1 - tolerance) {
    return { ok: false, recombined: null };
  }

  const u = 1 - t;

  // Recover P1 and P2
  const p1x = (left.p1.x - u * p0.x) / t;
  const p1y = (left.p1.y - u * p0.y) / t;
  const p2x = (right.p2.x - t * p3.x) / u;
  const p2y = (right.p2.y - t * p3.y) / u;

  // Verify intermediate points match de Casteljau at t
  const a = { x: (1 - t) * p0.x + t * p1x, y: (1 - t) * p0.y + t * p1y };
  const b = { x: (1 - t) * p1x + t * p2x, y: (1 - t) * p1y + t * p2y };
  const c = { x: (1 - t) * p2x + t * p3.x, y: (1 - t) * p2y + t * p3.y };

  const d = { x: (1 - t) * a.x + t * b.x, y: (1 - t) * a.y + t * b.y };
  const e = { x: (1 - t) * b.x + t * c.x, y: (1 - t) * b.y + t * c.y };

  const s = { x: (1 - t) * d.x + t * e.x, y: (1 - t) * d.y + t * e.y };

  const match =
    Math.abs(a.x - left.p1.x) < tolerance &&
    Math.abs(a.y - left.p1.y) < tolerance &&
    Math.abs(c.x - right.p2.x) < tolerance &&
    Math.abs(c.y - right.p2.y) < tolerance &&
    Math.abs(d.x - left.p2.x) < tolerance &&
    Math.abs(d.y - left.p2.y) < tolerance &&
    Math.abs(e.x - right.p1.x) < tolerance &&
    Math.abs(e.y - right.p1.y) < tolerance &&
    Math.abs(s.x - left.p3.x) < tolerance &&
    Math.abs(s.y - left.p3.y) < tolerance;

  if (match) {
    return {
      ok: true,
      recombined: { p0: left.p0, p1: { x: p1x, y: p1y }, p2: { x: p2x, y: p2y }, p3: right.p3 },
    };
  }

  return { ok: false, recombined: null };
}

/**
 * Delete an interior anchor from a path while preserving geometry as much
 * as possible. The two adjacent segments (before and after the deleted
 * anchor) are combined into one.
 *
 * For path deletion, we try exact recombination first (if the two cubics
 * came from a previous subdivision). If that fails, we fit a single cubic
 * that minimizes deviation at the join.
 *
 * @returns a new path with the anchor removed, or null if deletion would
 *          leave an invalid path (< 2 points for open, < 3 for closed).
 */
export function deleteAnchorPreservingGeometry(
  points: readonly PathPoint[],
  anchorIndex: number,
  closed: boolean,
): PathPoint[] | null {
  const n = points.length;
  if (n < 2) return null;

  if (closed) {
    if (n < 3) return null;
  } else {
    if (n < 3) return null; // need at least 3 to delete interior; endpoints handled separately
  }

  const i = anchorIndex;

  // Endpoint deletion for open paths
  if (!closed && (i === 0 || i === n - 1)) {
    // Remove the endpoint and its segment — all remaining segments unchanged
    const result = [...points];
    result.splice(i, 1);
    return result;
  }

  // Interior anchor deletion (or any anchor in a closed path)
  const prevIdx = closed ? (i - 1 + n) % n : i - 1;
  const nextIdx = closed ? (i + 1) % n : i + 1;

  const prevPt = points[prevIdx]!;
  const deletedPt = points[i]!;
  const nextPt = points[nextIdx]!;

  const segLeft = segmentToCubic(prevPt, deletedPt);
  const segRight = segmentToCubic(deletedPt, nextPt);

  // Try exact recombination
  const { ok, recombined } = canRecombineCubics(segLeft, segRight);

  let merged: PathPoint;
  if (ok && recombined) {
    // Exact recombination succeeded
    merged = {
      x: deletedPt.x,
      y: deletedPt.y,
      handleIn: [recombined.p2.x - nextPt.x, recombined.p2.y - nextPt.y],
      handleOut: [recombined.p1.x - prevPt.x, recombined.p1.y - prevPt.y],
    };
  } else {
    // Fallback: fit a single cubic that preserves endpoints and approximate
    // tangent directions at the join point.
    //
    // Strategy: use a constrained fit where:
    // - P0 = prevPt (anchor + its outgoing handle from the original left segment)
    // - P3 = nextPt (anchor + its incoming handle from the original right segment)
    // - P1 = extrapolate from left segment's tangent direction at start
    // - P2 = extrapolate from right segment's tangent direction at end
    //
    // For the outgoing handle of the merged segment at prevPt:
    //   Use the left segment's outgoing handle direction and scale it to
    //   approximately 2/3 of the total chord length (standard heuristic).
    const chordLen = Math.hypot(nextPt.x - prevPt.x, nextPt.y - prevPt.y);
    const scaleRatio = 2 / 3;

    // Left tangent direction at prevPt (from left segment's handleOut)
    const leftDirX = segLeft.p1.x - segLeft.p0.x;
    const leftDirY = segLeft.p1.y - segLeft.p0.y;
    const leftDirLen = Math.hypot(leftDirX, leftDirY) || 1;

    // Right tangent direction at nextPt (from right segment's handleIn, negated)
    const rightDirX = segRight.p3.x - segRight.p2.x;
    const rightDirY = segRight.p3.y - segRight.p2.y;
    const rightDirLen = Math.hypot(rightDirX, rightDirY) || 1;

    const mergedHandleOutLen = Math.min(chordLen * scaleRatio, leftDirLen);
    const mergedHandleInLen = Math.min(chordLen * scaleRatio, rightDirLen);

    merged = {
      x: deletedPt.x,
      y: deletedPt.y,
      handleIn:
        prevPt.handleOut || nextPt.handleIn
          ? [
              (rightDirX / rightDirLen) * -mergedHandleInLen,
              (rightDirY / rightDirLen) * -mergedHandleInLen,
            ]
          : null,
      handleOut:
        prevPt.handleOut || nextPt.handleIn
          ? [
              (leftDirX / leftDirLen) * mergedHandleOutLen,
              (leftDirY / leftDirLen) * mergedHandleOutLen,
            ]
          : null,
    };
  }

  // Build result array
  if (closed) {
    // For closed paths, we replace prevIdx..nextIdx with prevPt, merged, nextPt
    // But actually, we just remove the deleted anchor from the ring.
    // The segment between prevPt and nextPt is now represented by merged's handles.
    const result = [...points];
    // Replace the deleted point's position with the merged info
    // prevPt gets merged's outgoing handle, nextPt gets merged's incoming handle
    result[prevIdx] = {
      ...prevPt,
      handleOut: merged.handleOut,
    };
    result[nextIdx] = {
      ...nextPt,
      handleIn: merged.handleIn,
    };
    result.splice(i, 1);
    return result;
  } else {
    // Open path: remove the deleted point, update neighbors' handles
    const result = [...points];
    result[prevIdx] = {
      ...prevPt,
      handleOut: merged.handleOut,
    };
    result.splice(i, 1);
    // nextIdx shifted down by 1 after splice
    const newNextIdx = nextIdx - 1;
    result[newNextIdx] = {
      ...nextPt,
      handleIn: merged.handleIn,
    };
    return result;
  }
}

// ─── Nearest point on path ─────────────────────────────────────────────

/**
 * Find the closest point on a path (array of PathPoints with segments)
 * to a query point. Returns the segment index and parameter t.
 */
export function nearestPointOnPath(
  points: readonly PathPoint[],
  closed: boolean,
  query: { x: number; y: number },
  steps = 20,
): { segmentIndex: number; t: number; point: { x: number; y: number }; dist: number } | null {
  if (points.length < 2) return null;

  let bestSeg = 0;
  let bestT = 0;
  let bestPt = { x: 0, y: 0 };
  let bestDist = Infinity;

  const getSegments = (): Array<[number, number]> => {
    const segs: Array<[number, number]> = [];
    for (let i = 0; i < points.length - 1; i++) {
      segs.push([i, i + 1]);
    }
    if (closed && points.length > 2) {
      segs.push([points.length - 1, 0]);
    }
    return segs;
  };

  for (const [i, j] of getSegments()) {
    const cb = segmentToCubic(points[i]!, points[j]!);
    // Coarse search
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const pt = cubicBezierPoint(cb, t);
      const dx = pt.x - query.x;
      const dy = pt.y - query.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        bestT = t;
        bestPt = pt;
        bestSeg = i;
      }
    }

    // Newton refinement
    for (let iter = 0; iter < 8; iter++) {
      const pt = cubicBezierPoint(cb, bestT);
      const d = cubicBezierDerivative(cb, bestT);
      const dx = pt.x - query.x;
      const dy = pt.y - query.y;
      const f1 = 2 * (dx * d.x + dy * d.y);
      // Approximate f'' with dot product of derivative with itself
      const f2 = 2 * (d.x * d.x + d.y * d.y);
      if (Math.abs(f2) < EPS) break;
      const newT = bestT - f1 / f2;
      if (newT <= 0 || newT >= 1) break;
      bestT = newT;
    }

    const pt = cubicBezierPoint(cb, bestT);
    const dx = pt.x - query.x;
    const dy = pt.y - query.y;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      bestPt = pt;
      bestSeg = i;
    }
  }

  return { segmentIndex: bestSeg, t: bestT, point: bestPt, dist: bestDist };
}

// ─── Multi-anchor delete ───────────────────────────────────────────────

/**
 * Delete multiple anchors from a path while preserving geometry.
 * Plans all topology changes first, then applies them in a single pass
 * to avoid index-shift bugs.
 */
export function deleteMultipleAnchors(
  points: readonly PathPoint[],
  anchorsToDelete: ReadonlySet<number>,
  closed: boolean,
): PathPoint[] | null {
  if (anchorsToDelete.size === 0) return [...points];

  const n = points.length;
  if (closed && n - anchorsToDelete.size < 3) return null;
  if (!closed && n - anchorsToDelete.size < 2) return null;

  // Sort indices in descending order for safe removal
  const sortedIndices = [...anchorsToDelete].sort((a, b) => b - a);

  let result = [...points];

  for (const idx of sortedIndices) {
    const deleted = deleteAnchorPreservingGeometry(result, idx, closed);
    if (!deleted) return null;
    result = deleted;
  }

  return result;
}

// ─── Point type inference ──────────────────────────────────────────────

export type PointType = 'corner' | 'smooth' | 'symmetric';

/**
 * Infer the semantic type of an anchor from its handles.
 */
export function inferPointType(
  pt: PathPoint,
  _prevPt: PathPoint | null,
  _nextPt: PathPoint | null,
): PointType {
  if (!pt.handleIn && !pt.handleOut) return 'corner';
  if (pt.handleIn && pt.handleOut) {
    // Check collinearity: cross product should be near zero
    const cross = pt.handleIn[0] * pt.handleOut[1] - pt.handleIn[1] * pt.handleOut[0];
    const lenIn = Math.hypot(pt.handleIn[0], pt.handleIn[1]);
    const lenOut = Math.hypot(pt.handleOut[0], pt.handleOut[1]);
    const minLen = Math.min(lenIn, lenOut);
    if (minLen < EPS) return 'corner';
    if (Math.abs(cross) / (minLen * minLen) < EPS) {
      // Collinear — check if equal length (symmetric)
      if (Math.abs(lenIn - lenOut) / Math.max(lenIn, lenOut) < EPS) {
        return 'symmetric';
      }
      return 'smooth';
    }
    return 'corner';
  }
  // One handle present, one null → corner (one-sided)
  return 'corner';
}
