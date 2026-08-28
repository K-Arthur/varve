// Scale-aware precision policy for boolean geometry.
//
// Instead of scattering absolute epsilons (1e-10, 1e-8, 0.5, 1e-5)
// throughout the algorithm, every tolerance is derived from the
// geometric scale of the operands.  This ensures consistent behaviour
// whether the artwork is at 0.001 or 1,000,000 world units.

import type { Point2D } from './region';
import { cross } from './region';

// ── Geometry helpers ────────────────────────────────────────────────────────

/** Axis-aligned bounding box. */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Compute the AABB of a polygon. */
export function computeAABB(pts: Point2D[]): AABB {
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/** Merge two AABBs. */
export function mergeAABB(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Diagonal length of an AABB — our primary scale metric. */
export function aabbDiagonal(a: AABB): number {
  const dx = a.maxX - a.minX;
  const dy = a.maxY - a.minY;
  return Math.sqrt(dx * dx + dy * dy);
}

// ── Scale-aware tolerance ───────────────────────────────────────────────────

/** Default relative tolerance: 1e-10 of the working scale. */
const DEFAULT_REL_TOL = 1e-10;

/** Minimum absolute tolerance to prevent degenerate comparisons at tiny scales. */
const MIN_ABS_TOL = 1e-12;

/** Maximum absolute tolerance to prevent merging at huge scales. */
const MAX_ABS_TOL = 0.01;

/**
 * Derive an absolute tolerance from the geometric scale of the operands.
 *
 * @param scale    The diagonal of the combined bounding box of all operands.
 * @param relative Fraction of scale to use as tolerance (default 1e-10).
 */
export function toleranceForScale(scale: number, relative = DEFAULT_REL_TOL): number {
  const raw = scale * relative;
  // Clamp to sane bounds
  return Math.max(MIN_ABS_TOL, Math.min(MAX_ABS_TOL, raw));
}

/**
 * Compute the working tolerance for a set of polygon operands.
 * Takes the bounding box of all input polygons combined.
 */
export function workingTolerance(polygons: Point2D[][]): number {
  let combined: AABB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const poly of polygons) {
    combined = mergeAABB(combined, computeAABB(poly));
  }
  return toleranceForScale(aabbDiagonal(combined));
}

// ── Working origin normalization ────────────────────────────────────────────

/**
 * Translate polygon coordinates so the combined bounding-box origin is at
 * (0,0).  This dramatically improves floating-point precision for large
 * world coordinates (e.g. objects at x=10,000,000).
 *
 * Returns the polygons in normalized space and the offset to add back
 * when converting results to world space.
 */
export function normalizeToOrigin(polygons: Point2D[][]): {
  normalized: Point2D[][];
  offset: Point2D;
} {
  let combined = computeAABB(polygons[0] ?? []);
  for (let i = 1; i < polygons.length; i++) {
    combined = mergeAABB(combined, computeAABB(polygons[i]!));
  }
  const offset: Point2D = { x: combined.minX, y: combined.minY };
  const normalized = polygons.map((poly) =>
    poly.map((p) => ({ x: p.x - offset.x, y: p.y - offset.y })),
  );
  return { normalized, offset };
}

/** Apply an offset to a polygon (translate back from normalized space). */
export function translatePolygon(pts: Point2D[], offset: Point2D): Point2D[] {
  return pts.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
}

// ── Robust orientation predicates ───────────────────────────────────────────

/**
 * Exact sign of the 2D cross product (a→b) × (a→c).
 * Returns -1, 0, or +1.
 *
 * Uses adaptive precision: if the geometric magnitude is above the
 * tolerance threshold the raw cross product sign is returned; otherwise
 * a more careful test is used.
 */
export function orient2d(a: Point2D, b: Point2D, c: Point2D, tol: number): -1 | 0 | 1 {
  const det = cross(a, b, c);
  if (Math.abs(det) > tol) return det > 0 ? 1 : -1;

  // Near-degenerate: classify based on dot products to distinguish
  // parallel/collinear from genuinely zero.
  // If the vectors a→b and a→c are nearly parallel, the points are collinear.
  const abx = b.x - a.x,
    aby = b.y - a.y;
  const acx = c.x - a.x,
    acy = c.y - a.y;
  const dot = abx * acx + aby * acy;
  const magAB = Math.sqrt(abx * abx + aby * aby);
  const magAC = Math.sqrt(acx * acx + acy * acy);

  if (magAB < tol && magAC < tol) return 0; // a ≈ b ≈ c
  if (magAB < tol || magAC < tol) {
    // One vector is essentially zero-length but the other isn't.
    // The cross product is the dominant signal.
    return det > 0 ? 1 : det < 0 ? -1 : 0;
  }

  const cosAngle = dot / (magAB * magAC);
  if (Math.abs(cosAngle) > 1 - tol / (magAB * magAC)) {
    // Nearly parallel — treat as collinear
    return 0;
  }
  return det > 0 ? 1 : det < 0 ? -1 : 0;
}

/**
 * Robust collinearity test: are a, b, c within `tol` of being collinear?
 */
export function isCollinear(a: Point2D, b: Point2D, c: Point2D, tol: number): boolean {
  return orient2d(a, b, c, tol) === 0;
}

/**
 * Two points are considered coincident if within `tol` Euclidean distance.
 */
export function pointsEqual(a: Point2D, b: Point2D, tol: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= tol * tol;
}

/**
 * Segment-segment intersection with robust parallel/collinear detection.
 *
 * Returns:
 * - null: no intersection or parallel/collinear
 * - { type: 'cross', point, t1, t2 }: true crossing at parametric positions
 * - { type: 'touch', point, t1, t2 }: touching at endpoints (t1 or t2 ≈ 0 or 1)
 * - { type: 'collinear-overlap', ... }: collinear overlapping segments
 */
export type SegmentIntersection =
  | { type: 'cross'; point: Point2D; t1: number; t2: number }
  | { type: 'touch'; point: Point2D; t1: number; t2: number }
  | { type: 'collinear-overlap'; start: Point2D; end: Point2D };

export function segmentIntersectionRobust(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  tol: number,
): SegmentIntersection | null {
  const denom = (b2.y - b1.y) * (a2.x - a1.x) - (b2.x - b1.x) * (a2.y - a1.y);

  // Check for near-parallel
  if (Math.abs(denom) < tol * tol) {
    // Collinear check
    if (!isCollinear(a1, a2, b1, tol)) return null;
    // Collinear: find overlap interval
    return collinearOverlap(a1, a2, b1, b2, tol);
  }

  const ua = ((b2.x - b1.x) * (a1.y - b1.y) - (b2.y - b1.y) * (a1.x - b1.x)) / denom;
  const ub = ((a2.x - a1.x) * (a1.y - b1.y) - (a2.y - a1.y) * (a1.x - b1.x)) / denom;

  const point: Point2D = {
    x: a1.x + ua * (a2.x - a1.x),
    y: a1.y + ua * (a2.y - a1.y),
  };

  // Check if intersection is within both segments (including endpoints).
  // For polygon clipping, endpoint intersections are valid topology events.
  // We classify as 'cross' for any intersection strictly within or at endpoints
  // of both segments, as long as it's not degenerate (both at same endpoint).
  if (ua >= -tol && ua <= 1 + tol && ub >= -tol && ub <= 1 + tol) {
    // Reject degenerate cases: both parameters at the same extreme endpoint
    // (meaning the segments share an endpoint but don't cross)
    const atStart = ua <= tol && ub <= tol;
    const atEnd = ua >= 1 - tol && ub >= 1 - tol;
    if (atStart || atEnd) {
      return null; // Shared endpoint, not a crossing
    }
    return {
      type: 'cross',
      point,
      t1: Math.max(0, Math.min(1, ua)),
      t2: Math.max(0, Math.min(1, ub)),
    };
  }

  return null;
}

function collinearOverlap(
  a1: Point2D,
  a2: Point2D,
  b1: Point2D,
  b2: Point2D,
  tol: number,
): SegmentIntersection | null {
  // Project onto the longer segment's axis for parameter comparison
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const lenA = Math.sqrt(dx * dx + dy * dy);
  if (lenA < tol) return null; // Degenerate segment

  const proj = (p: Point2D): number => ((p.x - a1.x) * dx + (p.y - a1.y) * dy) / lenA;
  const t0 = 0;
  const t1 = lenA;
  const tb0 = proj(b1);
  const tb1 = proj(b2);

  const overlapStart = Math.max(t0, Math.min(tb0, tb1));
  const overlapEnd = Math.min(t1, Math.max(tb0, tb1));

  if (overlapEnd - overlapStart < tol) return null;

  const start: Point2D = {
    x: a1.x + (overlapStart / lenA) * dx,
    y: a1.y + (overlapStart / lenA) * dy,
  };
  const end: Point2D = {
    x: a1.x + (overlapEnd / lenA) * dx,
    y: a1.y + (overlapEnd / lenA) * dy,
  };

  return { type: 'collinear-overlap', start, end };
}

// ── Intersection clustering ─────────────────────────────────────────────────

/**
 * Cluster nearly-coincident intersection points so that topological
 * duplicates resolve to a single event.
 *
 * Two intersections in the same cluster if their points are within `tol`
 * AND they reference the same edge pair.
 */
export interface IntersectionEvent {
  point: Point2D;
  subEdge: number;
  clipEdge: number;
  subAlpha: number;
  clipAlpha: number;
}

export function clusterIntersections(xs: IntersectionEvent[], tol: number): IntersectionEvent[] {
  if (xs.length <= 1) return xs;

  const clusters: IntersectionEvent[] = [];
  const used = new Set<number>();

  for (let i = 0; i < xs.length; i++) {
    if (used.has(i)) continue;
    const cluster: IntersectionEvent[] = [xs[i]!];
    used.add(i);

    for (let j = i + 1; j < xs.length; j++) {
      if (used.has(j)) continue;
      const a = xs[i]!;
      const b = xs[j]!;
      // Same edge pair
      if (a.subEdge === b.subEdge && a.clipEdge === b.clipEdge) {
        const dx = a.point.x - b.point.x;
        const dy = a.point.y - b.point.y;
        if (dx * dx + dy * dy < tol * tol) {
          cluster.push(xs[j]!);
          used.add(j);
        }
      }
    }

    // Use the average point of the cluster (weighted by alpha for position accuracy)
    if (cluster.length === 1) {
      clusters.push(cluster[0]!);
    } else {
      // Average the positions
      let sx = 0,
        sy = 0,
        st1 = 0,
        st2 = 0;
      for (const c of cluster) {
        sx += c.point.x;
        sy += c.point.y;
        st1 += c.subAlpha;
        st2 += c.clipAlpha;
      }
      const n = cluster.length;
      clusters.push({
        point: { x: sx / n, y: sy / n },
        subEdge: cluster[0]!.subEdge,
        clipEdge: cluster[0]!.clipEdge,
        subAlpha: st1 / n,
        clipAlpha: st2 / n,
      });
    }
  }

  return clusters;
}
