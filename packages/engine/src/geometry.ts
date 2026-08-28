/**
 * TS geometry helpers — mirror of strata-core's math so the stub backend can
 * hit-test and so the webview can do local picking without a round-trip.
 *
 * Re-exports affine primitives from @varve/shared (the single source of
 * truth for affine math). Shape-specific helpers (polygon/star/path geometry,
 * shapeContains, hitTest) remain here because they depend on engine types.
 *
 * Research basis: same inverse-transform hit pattern as strata-core (Rust);
 * affine inverse formula for a 2x3 matrix.
 */

import {
  applyAffine,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  transformRect,
  translate,
  tryInvertAffine,
} from '@varve/shared';

// Re-export for back-compat so @varve/engine consumers still see these.
export {
  applyAffine,
  identity,
  invertAffine,
  multiplyAffine,
  pointInEllipse,
  pointToSegmentDistSq,
  rectContains,
  rotateDeg,
  rotateRad,
  scale,
  scaleXY,
  transform,
  transformRect,
  translate,
  tryInvertAffine,
};

import type { Affine, Point } from '@varve/shared';
import type { PathPoint, SceneNode, Shape } from './types';

function polygonVertices(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
    verts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return verts;
}

function starVertices(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  points: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return verts;
}

function pointInPolygon(vertices: Point[], p: Point): boolean {
  let inside = false;
  const len = vertices.length;
  for (let i = 0; i < len; i++) {
    const vi = vertices[i];
    const vj = vertices[(i + len - 1) % len];
    if (!vi || !vj) continue;
    const xi = vi[0],
      yi = vi[1];
    const xj = vj[0],
      yj = vj[1];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pathSegmentDistSq(points: PathPoint[], p: Point): number {
  if (points.length < 2) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const fromPt = points[i];
    const toPt = points[i + 1];
    if (!fromPt || !toPt) continue;
    // Check if this is a bezier segment (either point has handles)
    const isBezier = fromPt.handleOut !== null || toPt.handleIn !== null;
    if (isBezier) {
      const dist = pointToBezierSegmentDistSq(fromPt, toPt, p);
      if (dist < minDist) minDist = dist;
    } else {
      const from: Point = [fromPt.x, fromPt.y];
      const to: Point = [toPt.x, toPt.y];
      const dist = pointToSegmentDistSq(from, to, p);
      if (dist < minDist) minDist = dist;
    }
  }
  return minDist;
}

/** Evaluate a cubic bezier at parameter t [0,1]. */
function cubicPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): [number, number] {
  const u = 1 - t;
  const uu = u * u;
  const uuu = uu * u;
  const tt = t * t;
  const ttt = tt * t;
  return [
    uuu * x0 + 3 * uu * t * x1 + 3 * u * tt * x2 + ttt * x3,
    uuu * y0 + 3 * uu * t * y1 + 3 * u * tt * y2 + ttt * y3,
  ];
}

/** Evaluate a path segment (straight or cubic) at parameter t [0,1]. */
function evaluatePathSegment(p0: PathPoint, p1: PathPoint, t: number): [number, number] {
  const cx1 = p0.handleOut ? p0.x + p0.handleOut[0] : p0.x;
  const cy1 = p0.handleOut ? p0.y + p0.handleOut[1] : p0.y;
  const cx2 = p1.handleIn ? p1.x + p1.handleIn[0] : p1.x;
  const cy2 = p1.handleIn ? p1.y + p1.handleIn[1] : p1.y;
  return cubicPoint(p0.x, p0.y, cx1, cy1, cx2, cy2, p1.x, p1.y, t);
}

/**
 * Compute the minimum squared distance from a point to a cubic bezier
 * segment defined by two PathPoints (using handleOut of p0 and handleIn of p1).
 *
 * Uses multi-stage sampling: coarse uniform scan + golden-section refinement
 * around the best candidate.
 */
function pointToBezierSegmentDistSq(p0: PathPoint, p1: PathPoint, p: Point): number {
  // Coarse scan: 16 uniform samples
  const samples = 16;
  let bestT = 0;
  let bestDist = Infinity;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pt = evaluatePathSegment(p0, p1, t);
    const dx = pt[0] - p[0];
    const dy = pt[1] - p[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestT = t;
    }
  }

  // Refine around bestT using golden-section search
  const phi = (1 + Math.sqrt(5)) / 2;
  let a = Math.max(0, bestT - 1 / samples);
  let b = Math.min(1, bestT + 1 / series);

  // JS golden section
  let t1 = b - (b - a) / phi;
  let t2 = a + (b - a) / phi;
  const iter = 12;
  for (let i = 0; i < iter; i++) {
    const pt1 = evaluatePathSegment(p0, p1, t1);
    const pt2 = evaluatePathSegment(p0, p1, t2);
    const d1 = (pt1[0] - p[0]) ** 2 + (pt1[1] - p[1]) ** 2;
    const d2 = (pt2[0] - p[0]) ** 2 + (pt2[1] - p[1]) ** 2;
    if (d1 < d2) {
      b = t2;
      bestDist = d1;
    } else {
      a = t1;
      bestDist = d2;
    }
    t1 = b - (b - a) / phi;
    t2 = a + (b - a) / phi;
  }

  return bestDist;
}

/**
 * De Casteljau subdivision: split a cubic bezier at parameter t,
 * returning [left: [P0, C1, C2, P3], right: [P0, C1, C2, P3]].
 */
function splitCubic(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): [
  [number, number, number, number, number, number, number, number],
  [number, number, number, number, number, number, number, number],
] {
  const u = 1 - t;
  // Level 1
  const x01 = u * x0 + t * x1;
  const y01 = u * y0 + t * y1;
  const x12 = u * x1 + t * x2;
  const y12 = u * y1 + t * y2;
  const x23 = u * x2 + t * x3;
  const y23 = u * y2 + t * y3;
  // Level 2
  const x012 = u * x01 + t * x12;
  const y012 = u * y01 + t * y12;
  const x123 = u * x12 + t * x23;
  const y123 = u * y12 + t * y23;
  // Level 3
  const x0123 = u * x012 + t * x123;
  const y0123 = u * y012 + t * y123;
  return [
    [x0, y0, x01, y01, x012, y012, x0123, y0123],
    [x0123, y0123, x123, y123, x23, y23, x3, y3],
  ];
}

/**
 * Flatness test: maximum deviation from chord.
 * Uses the convex hull property: the furthest point on the curve from the
 * chord is bounded by the furthest control point from the chord.
 */
function isFlatEnough(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tolerance: number,
): boolean {
  // Vector from P0 to P3
  const dx = x3 - x0;
  const dy = y3 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return true; // Degenerate: all points coincident

  // Distance from P1 to chord P0-P3
  const t1 = ((x1 - x0) * dx + (y1 - y0) * dy) / lenSq;
  const projX1 = x0 + t1 * dx;
  const projY1 = y0 + t1 * dy;
  const d1 = (x1 - projX1) ** 2 + (y1 - projY1) ** 2;

  // Distance from P2 to chord P0-P3
  const t2 = ((x2 - x0) * dx + (y2 - y0) * dy) / lenSq;
  const projX2 = x0 + t2 * dx;
  const projY2 = y0 + t2 * dy;
  const d2 = (x2 - projX2) ** 2 + (y2 - projY2) ** 2;

  return d1 < tolerance * tolerance && d2 < tolerance * tolerance;
}

/**
 * Recursively subdivide a cubic bezier segment, calling `addEdge(xi, yi, xj, yj)`
 * for each flat sub-segment in order.
 */
function flattenBezier(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  tolerance: number,
  addEdge: (xi: number, yi: number, xj: number, yj: number) => void,
): void {
  if (isFlatEnough(x0, y0, x1, y1, x2, y2, x3, y3, tolerance)) {
    addEdge(x0, y0, x3, y3);
    return;
  }
  const [left, right] = splitCubic(x0, y0, x1, y1, x2, y2, x3, y3, 0.5);
  flattenBezier(
    left[0],
    left[1],
    left[2],
    left[3],
    left[4],
    left[5],
    left[6],
    left[7],
    tolerance,
    addEdge,
  );
  flattenBezier(
    right[0],
    right[1],
    right[2],
    right[3],
    right[4],
    right[5],
    right[6],
    right[7],
    tolerance,
    addEdge,
  );
}

/**
 * Ray-crossing / winding accumulation for a closed bezier ring.
 * Returns [crossings, winding] for evenodd vs nonzero fill rules.
 */
function accumulateBezierRing(
  points: PathPoint[],
  p: Point,
): { crossings: number; winding: number } {
  if (points.length < 3) return { crossings: 0, winding: 0 };
  let winding = 0;
  let crossings = 0;

  const accumulateSegment = (yi: number, yj: number, xi: number, xj: number) => {
    if (yi > p[1] !== yj > p[1]) {
      const xIntersect = xi + ((p[1] - yi) * (xj - xi)) / (yj - yi);
      if (xIntersect > p[0]) {
        crossings += 1;
        winding += yi > p[1] ? 1 : -1;
      }
    }
  };

  for (let i = 0; i < points.length; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % points.length];
    if (!p0 || !p1) continue;

    const isBezier = p0.handleOut !== null || p1.handleIn !== null;
    if (!isBezier) {
      accumulateSegment(p0.y, p1.y, p0.x, p1.x);
    } else {
      const cx1 = p0.handleOut ? p0.x + p0.handleOut[0] : p0.x;
      const cy1 = p0.handleOut ? p0.y + p0.handleOut[1] : p0.y;
      const cx2 = p1.handleIn ? p1.x + p1.handleIn[0] : p1.x;
      const cy2 = p1.handleIn ? p1.y + p1.handleIn[1] : p1.y;

      flattenBezier(p0.x, p0.y, cx1, cy1, cx2, cy2, p1.x, p1.y, 0.5, (xi, yi, xj, yj) => {
        accumulateSegment(yi, yj, xi, xj);
      });
    }
  }

  return { crossings, winding };
}

function pointInBezierPath(
  points: PathPoint[],
  p: Point,
  fillRule: 'nonzero' | 'evenodd' = 'nonzero',
  holes?: PathPoint[][],
): boolean {
  const outer = accumulateBezierRing(points, p);
  let crossings = outer.crossings;
  let winding = outer.winding;
  for (const hole of holes ?? []) {
    const holeHit = accumulateBezierRing(hole, p);
    crossings += holeHit.crossings;
    winding += holeHit.winding;
  }
  if (fillRule === 'evenodd') return crossings % 2 === 1;
  return winding !== 0;
}

/** Sum of series used for golden-section refinement range. */
const series = 16;

export function shapeContains(shape: Shape, p: Point): boolean {
  switch (shape.kind) {
    case 'rect':
      return rectContains({ x: shape.x, y: shape.y, w: shape.w, h: shape.h }, p);
    case 'ellipse':
      return pointInEllipse(shape.cx, shape.cy, shape.rx, shape.ry, p);
    case 'circle': {
      const dx = p[0] - shape.cx;
      const dy = p[1] - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case 'line':
      return pointToSegmentDistSq(shape.from, shape.to, p) <= shape.tolerance * shape.tolerance;
    case 'polygon':
      return pointInPolygon(
        polygonVertices(shape.cx, shape.cy, shape.radius, shape.sides, shape.rotation),
        p,
      );
    case 'star':
      return pointInPolygon(
        starVertices(
          shape.cx,
          shape.cy,
          shape.innerRadius,
          shape.outerRadius,
          shape.points,
          shape.rotation,
        ),
        p,
      );
    case 'arrow':
      return pointToSegmentDistSq(shape.from, shape.to, p) <= shape.tolerance * shape.tolerance;
    case 'table':
      return rectContains({ x: shape.x, y: shape.y, w: shape.w, h: shape.h }, p);
    case 'path':
      if (shape.closed) {
        const fillRule =
          shape.fillRule ??
          (shape.contours && shape.contours.length > 1
            ? 'evenodd'
            : shape.holes && shape.holes.length > 0
              ? 'evenodd'
              : 'nonzero');
        const holes = shape.contours?.length ? shape.contours.slice(1) : shape.holes;
        return pointInBezierPath(shape.points, p, fillRule, holes);
      }
      return pathSegmentDistSq(shape.points, p) <= shape.tolerance * shape.tolerance;
  }
}

/** Topmost node (highest index) whose shape contains `world`; null if none. */
export function hitTest(nodes: SceneNode[], world: Point): number | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (!n?.shape) continue;
    const local = applyAffine(invertAffine(n.transform as Affine), world);
    if (shapeContains(n.shape, local)) return i;
  }
  return null;
}
