/**
 * Cubic bezier math library for path editing, boolean ops, and hit-testing.
 * References: de Casteljau's algorithm, numerical integration, Newton-Raphson,
 * recursive subdivision intersection.
 */

/** Epsilon for near-zero comparisons. */
const EPS = 1e-10;

/** 2D point. */
export interface Point2D {
  x: number;
  y: number;
}

/** Cubic bezier segment (4 control points). */
export interface CubicBezier {
  p0: Point2D;
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
}

/**
 * PathPoint matching the scene model: a point with optional incoming and
 * outgoing bezier handles.
 */
export interface PathPoint {
  x: number;
  y: number;
  handleIn: [number, number] | null;
  handleOut: [number, number] | null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: Point2D, b: Point2D, t: number): Point2D {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function clampT(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Euclidean distance between two points. */
export function pointToPointDist(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Intersection of two infinite lines defined by (p1,q1) and (p2,q2).
 * Returns null if parallel or collinear (no unique intersection).
 */
export function lineLineIntersection(
  p1: Point2D,
  q1: Point2D,
  p2: Point2D,
  q2: Point2D,
): Point2D | null {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;

  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < EPS) return null;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2y - dy * d2x) / denom;

  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * Evaluate a cubic bezier at parameter t ∈ [0,1] using de Casteljau's
 * algorithm.
 */
export function cubicBezierPoint(cb: CubicBezier, t: number): Point2D {
  const s = clampT(t);

  // de Casteljau: 4 points → 3 → 2 → 1
  const a = lerpPoint(cb.p0, cb.p1, s);
  const b = lerpPoint(cb.p1, cb.p2, s);
  const c = lerpPoint(cb.p2, cb.p3, s);

  const d = lerpPoint(a, b, s);
  const e = lerpPoint(b, c, s);

  return lerpPoint(d, e, s);
}

/**
 * First derivative (tangent) of a cubic bezier at t ∈ [0,1].
 * B'(t) = 3(1-t)²(P1-P0) + 6(1-t)t(P2-P1) + 3t²(P3-P2)
 */
export function cubicBezierDerivative(cb: CubicBezier, t: number): Point2D {
  const s = clampT(t);
  const u = 1 - s;

  const c0 = 3 * u * u;
  const c1 = 6 * u * s;
  const c2 = 3 * s * s;

  return {
    x: c0 * (cb.p1.x - cb.p0.x) + c1 * (cb.p2.x - cb.p1.x) + c2 * (cb.p3.x - cb.p2.x),
    y: c0 * (cb.p1.y - cb.p0.y) + c1 * (cb.p2.y - cb.p1.y) + c2 * (cb.p3.y - cb.p2.y),
  };
}

/**
 * Subdivide a cubic bezier at parameter t using de Casteljau.
 * Returns [left, right] sub-curves.
 */
export function cubicBezierSplit(cb: CubicBezier, t: number): [CubicBezier, CubicBezier] {
  const s = clampT(t);

  // Level 1: points on edges
  const a = lerpPoint(cb.p0, cb.p1, s);
  const b = lerpPoint(cb.p1, cb.p2, s);
  const c = lerpPoint(cb.p2, cb.p3, s);

  // Level 2
  const d = lerpPoint(a, b, s);
  const e = lerpPoint(b, c, s);

  // Level 3
  const f = lerpPoint(d, e, s);

  const left: CubicBezier = { p0: cb.p0, p1: a, p2: d, p3: f };
  const right: CubicBezier = { p0: f, p1: e, p2: c, p3: cb.p3 };

  return [left, right];
}

/**
 * Axis-aligned bounding box of a cubic bezier curve.
 * Evaluates at endpoints and at roots of the derivative (where tangent
 * is parallel to each axis).
 */
export function cubicBezierBBox(cb: CubicBezier): { x: number; y: number; w: number; h: number } {
  // Start with the endpoints
  let minX = Math.min(cb.p0.x, cb.p3.x);
  let maxX = Math.max(cb.p0.x, cb.p3.x);
  let minY = Math.min(cb.p0.y, cb.p3.y);
  let maxY = Math.max(cb.p0.y, cb.p3.y);

  // Find extrema by solving dB/dt = 0 for each axis.
  // Coefficients: B'(t) = A·t² + B·t + C where:
  //   c0 = p1-p0, c1 = p2-p1, c2 = p3-p2
  //   A = 3(c0 - 2c1 + c2), B = 6(c1 - c0), C = 3c0
  function findRoots(p0: number, p1: number, p2: number, p3: number): number[] {
    // Expand B'(t) = 3(1-t)²(p1-p0) + 6(1-t)t(p2-p1) + 3t²(p3-p2)
    // = 3(p1-p0)(1 - 2t + t²) + 6(p2-p1)(t - t²) + 3(p3-p2)t²
    // = 3(p1-p0) - 6(p1-p0)t + 3(p1-p0)t² + 6(p2-p1)t - 6(p2-p1)t² + 3(p3-p2)t²
    // = 3(p1-p0) + (-6(p1-p0) + 6(p2-p1))t + (3(p1-p0) - 6(p2-p1) + 3(p3-p2))t²
    // = C + B*t + A*t²

    const c0 = p1 - p0; // P1 - P0
    const c1 = p2 - p1; // P2 - P1
    const c2 = p3 - p2; // P3 - P2

    const C = 3 * c0;
    const B = 6 * (c1 - c0);
    const A = 3 * (c0 - 2 * c1 + c2);

    const roots: number[] = [];

    if (Math.abs(A) < EPS) {
      // Linear: B*t + C = 0
      if (Math.abs(B) > EPS) {
        const r = -C / B;
        if (r > 0 && r < 1) roots.push(r);
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const r1 = (-B + sqrtDisc) / (2 * A);
        const r2 = (-B - sqrtDisc) / (2 * A);
        if (r1 > 0 && r1 < 1) roots.push(r1);
        if (r2 > 0 && r2 < 1) roots.push(r2);
      }
    }

    return roots;
  }

  const xRoots = findRoots(cb.p0.x, cb.p1.x, cb.p2.x, cb.p3.x);
  for (const r of xRoots) {
    const pt = cubicBezierPoint(cb, r);
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
  }

  const yRoots = findRoots(cb.p0.y, cb.p1.y, cb.p2.y, cb.p3.y);
  for (const r of yRoots) {
    const pt = cubicBezierPoint(cb, r);
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Arc length ───────────────────────────────────────────────────────

function evaluateSpeedSq(cb: CubicBezier, t: number): number {
  const d = cubicBezierDerivative(cb, t);
  return d.x * d.x + d.y * d.y;
}

/**
 * Approximate arc length via fixed-subdivision numerical integration
 * (Gaussian quadrature-inspired, using Simpson's composite rule).
 */
export function cubicBezierLength(cb: CubicBezier, segments = 10): number {
  if (segments < 1) segments = 1;

  // Use Simpson's rule for better accuracy with fewer segments
  const n = segments * 2; // must be even for Simpson
  const h = 1 / n;
  let sum = 0;

  for (let i = 0; i <= n; i++) {
    const t = i * h;
    const speed = Math.sqrt(evaluateSpeedSq(cb, t));
    const w = i === 0 || i === n ? 1 : i % 2 === 1 ? 4 : 2;
    sum += (w / 3) * speed;
  }

  return sum * h;
}

// ─── Closest point ───────────────────────────────────────────────────

/**
 * Find the closest point on a cubic bezier to point p.
 * Uses coarse-to-fine: sample at `steps` intervals, refine with Newton-Raphson.
 */
export function cubicBezierClosestPoint(
  cb: CubicBezier,
  p: Point2D,
  steps = 20,
): { t: number; point: Point2D; dist: number } {
  let bestT = 0;
  let bestDist = Infinity;

  // Coarse pass: sample uniformly
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pt = cubicBezierPoint(cb, t);
    const dx = pt.x - p.x;
    const dy = pt.y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }

  // Refine with Newton-Raphson:
  // Minimise f(t) = |B(t) - p|²
  // f'(t) = 2(B(t) - p) · B'(t)
  // f''(t) = 2(B'(t) · B'(t) + (B(t) - p) · B''(t))
  for (let iter = 0; iter < 10; iter++) {
    const pt = cubicBezierPoint(cb, bestT);
    const d = cubicBezierDerivative(cb, bestT);
    const dd = cubicBezierSecondDerivative(cb, bestT);

    const dx = pt.x - p.x;
    const dy = pt.y - p.y;

    // f' = 2(dx * d.x + dy * d.y)
    const f1 = 2 * (dx * d.x + dy * d.y);

    // f'' = 2(d.x² + d.y² + dx * dd.x + dy * dd.y)
    const f2 = 2 * (d.x * d.x + d.y * d.y + dx * dd.x + dy * dd.y);

    if (Math.abs(f2) < EPS) break;

    const newT = bestT - f1 / f2;
    if (newT <= 0 || newT >= 1) {
      // If we're at boundary, check the endpoints
      break;
    }
    bestT = newT;
  }

  bestT = clampT(bestT);
  const bestPoint = cubicBezierPoint(cb, bestT);
  const bestDistReal = pointToPointDist(bestPoint, p);

  // Check endpoints (Newton may have converged to local minimum away from true closest)
  const d0 = pointToPointDist(cb.p0, p);
  const d3 = pointToPointDist(cb.p3, p);

  if (d0 < bestDistReal) {
    return { t: 0, point: cb.p0, dist: d0 };
  }
  if (d3 < bestDistReal) {
    return { t: 1, point: cb.p3, dist: d3 };
  }

  return { t: bestT, point: bestPoint, dist: bestDistReal };
}

/**
 * Second derivative of cubic bezier.
 * B''(t) = 6(1-t)(P2 - 2*P1 + P0) + 6t(P3 - 2*P2 + P1)
 */
function cubicBezierSecondDerivative(cb: CubicBezier, t: number): Point2D {
  const s = clampT(t);
  const u = 1 - s;

  const ax = cb.p2.x - 2 * cb.p1.x + cb.p0.x;
  const ay = cb.p2.y - 2 * cb.p1.y + cb.p0.y;
  const bx = cb.p3.x - 2 * cb.p2.x + cb.p1.x;
  const by = cb.p3.y - 2 * cb.p2.y + cb.p1.y;

  return {
    x: 6 * (u * ax + s * bx),
    y: 6 * (u * ay + s * by),
  };
}

// ─── Intersection ────────────────────────────────────────────────────

function bboxOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return !(
    a.x + a.w < b.x - EPS ||
    b.x + b.w < a.x - EPS ||
    a.y + a.h < b.y - EPS ||
    b.y + b.h < a.y - EPS
  );
}

/**
 * Find intersection points between two cubic bezier curves.
 * Uses recursive subdivision with bounding box overlap test.
 */
export function cubicBezierSegmentIntersection(
  a: CubicBezier,
  b: CubicBezier,
  threshold = 0.5,
): Point2D[] {
  const results: Point2D[] = [];

  function recurse(ca: CubicBezier, cb: CubicBezier, depth: number, eps: number): void {
    const bba = cubicBezierBBox(ca);
    const bbb = cubicBezierBBox(cb);

    // Quick reject
    if (!bboxOverlap(bba, bbb)) return;

    // Get chord lengths for flatness test
    const chordA = pointToPointDist(ca.p0, ca.p3);
    const chordB = pointToPointDist(cb.p0, cb.p3);

    // If curve is flat enough (control points close to chord), approximate
    // and check line-line intersection
    const flatnessA = pointToPointDist(ca.p1, ca.p0) + pointToPointDist(ca.p2, ca.p3);
    const flatnessB = pointToPointDist(cb.p1, cb.p0) + pointToPointDist(cb.p2, cb.p3);

    if (depth >= 12 || (Math.abs(chordA) < eps && Math.abs(chordB) < eps)) {
      // Flat enough: check line-line intersection of endpoints
      const pt = lineLineIntersection(ca.p0, ca.p3, cb.p0, cb.p3);
      if (pt) {
        // Verify the intersection lies within both curve chords
        const tA = projectOnSegment(ca.p0, ca.p3, pt);
        const tB = projectOnSegment(cb.p0, cb.p3, pt);
        if (tA >= -EPS && tA <= 1 + EPS && tB >= -EPS && tB <= 1 + EPS) {
          // Deduplicate
          const isDup = results.some((r) => pointToPointDist(r, pt) < eps);
          if (!isDup) results.push(pt);
        }
      }
      return;
    }

    // Split the longer curve
    const lenA = chordA + flatnessA;
    const lenB = chordB + flatnessB;

    if (lenA >= lenB) {
      const [aL, aR] = cubicBezierSplit(ca, 0.5);
      recurse(aL, cb, depth + 1, eps);
      recurse(aR, cb, depth + 1, eps);
    } else {
      const [bL, bR] = cubicBezierSplit(cb, 0.5);
      recurse(ca, bL, depth + 1, eps);
      recurse(ca, bR, depth + 1, eps);
    }
  }

  recurse(a, b, 0, threshold);
  return results;
}

/**
 * Project point p onto segment (pA, pB). Returns parametric t ∈ [0, 1]
 * for the closest point on the segment, NOT clamped (can be used for
 * line-line intersection check).
 */
function projectOnSegment(pA: Point2D, pB: Point2D, p: Point2D): number {
  const dx = pB.x - pA.x;
  const dy = pB.y - pA.y;
  const denom = dx * dx + dy * dy;
  if (Math.abs(denom) < EPS) return 0;
  return ((p.x - pA.x) * dx + (p.y - pA.y) * dy) / denom;
}

/**
 * Build a cubic bezier from two path points and their handles.
 * If a handle is null, the point acts as a corner.
 * Returns the cubic bezier segment connecting `from` to `to`.
 */
export function pathPointToBezier(from: PathPoint, to: PathPoint): CubicBezier {
  const p0: Point2D = { x: from.x, y: from.y };
  const p3: Point2D = { x: to.x, y: to.y };

  // Control point 1: from.handleOut or the midpoint
  let p1: Point2D;
  if (from.handleOut) {
    p1 = { x: from.x + from.handleOut[0], y: from.y + from.handleOut[1] };
  } else {
    // If no handleOut, use a simple linear midpoint
    p1 = lerpPoint(p0, p3, 1 / 3);
  }

  // Control point 2: to.handleIn or the midpoint
  let p2: Point2D;
  if (to.handleIn) {
    p2 = { x: to.x + to.handleIn[0], y: to.y + to.handleIn[1] };
  } else {
    p2 = lerpPoint(p0, p3, 2 / 3);
  }

  return { p0, p1, p2, p3 };
}

/**
 * Find all intersections between two paths defined by PathPoint arrays.
 *
 * @param pointsA - Path A control points.
 * @param closedA - Whether Path A is closed.
 * @param pointsB - Path B control points.
 * @param closedB - Whether Path B is closed.
 * @returns Array of unique intersection points.
 */
export function pathSegmentIntersections(
  pointsA: PathPoint[],
  closedA: boolean,
  pointsB: PathPoint[],
  closedB: boolean,
): Point2D[] {
  if (pointsA.length < 2 || pointsB.length < 2) return [];

  const results: Point2D[] = [];
  const eps = 0.5;

  function addUnique(p: Point2D): void {
    const isDup = results.some((r) => pointToPointDist(r, p) < eps);
    if (!isDup) results.push(p);
  }

  // Build segments for a path
  function getSegments(pts: PathPoint[], closed: boolean): Array<[number, number]> {
    const segs: Array<[number, number]> = [];
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push([i, i + 1]);
    }
    if (closed && pts.length > 2) {
      segs.push([pts.length - 1, 0]);
    }
    return segs;
  }

  const segsA = getSegments(pointsA, closedA);
  const segsB = getSegments(pointsB, closedB);

  for (const [iA, jA] of segsA) {
    const fromA = pointsA[iA]!;
    const toA = pointsA[jA]!;
    const hasHandleA = fromA.handleOut !== null || toA.handleIn !== null;

    for (const [iB, jB] of segsB) {
      const fromB = pointsB[iB]!;
      const toB = pointsB[jB]!;
      const hasHandleB = fromB.handleOut !== null || toB.handleIn !== null;

      if (hasHandleA || hasHandleB) {
        // Bezier vs Bezier
        const bezA = pathPointToBezier(fromA, toA);
        const bezB = pathPointToBezier(fromB, toB);
        const pts = cubicBezierSegmentIntersection(bezA, bezB);
        for (const p of pts) addUnique(p);
      } else {
        // Straight segment vs straight segment
        const p1: Point2D = { x: fromA.x, y: fromA.y };
        const q1: Point2D = { x: toA.x, y: toA.y };
        const p2: Point2D = { x: fromB.x, y: fromB.y };
        const q2: Point2D = { x: toB.x, y: toB.y };

        const pt = lineLineIntersection(p1, q1, p2, q2);
        if (pt) {
          // Check that intersection lies within both segments
          const tA = projectOnSegment(p1, q1, pt);
          const tB = projectOnSegment(p2, q2, pt);
          if (tA >= -EPS && tA <= 1 + EPS && tB >= -EPS && tB <= 1 + EPS) {
            addUnique(pt);
          }
        }
      }
    }
  }

  return results;
}
