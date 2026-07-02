import { describe, expect, it } from 'vitest';
import {
  type CubicBezier,
  type PathPoint,
  type Point2D,
  cubicBezierPoint,
  cubicBezierDerivative,
  cubicBezierSplit,
  cubicBezierBBox,
  cubicBezierLength,
  cubicBezierClosestPoint,
  cubicBezierSegmentIntersection,
  pathSegmentIntersections,
  pointToPointDist,
  lineLineIntersection,
} from './bezier';

const EPS = 1e-9;
const EPS_LEN = 1e-6;

function approxPoint(a: Point2D, b: Point2D, tol = EPS): void {
  expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tol);
}

function approxNum(a: number, b: number, tol = EPS): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

describe('pointToPointDist', () => {
  it('zero distance for same point', () => {
    expect(pointToPointDist({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(0);
  });

  it('computes euclidean distance', () => {
    approxNum(pointToPointDist({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });
});

describe('lineLineIntersection', () => {
  it('intersects two crossing lines', () => {
    const p = lineLineIntersection(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 10 }, { x: 10, y: 0 },
    );
    expect(p).not.toBeNull();
    if (p) approxPoint(p, { x: 5, y: 5 });
  });

  it('returns null for parallel lines', () => {
    const p = lineLineIntersection(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 1 }, { x: 10, y: 11 },
    );
    expect(p).toBeNull();
  });

  it('returns null for collinear lines', () => {
    const p = lineLineIntersection(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 20, y: 20 }, { x: 30, y: 30 },
    );
    expect(p).toBeNull();
  });
});

describe('cubicBezierPoint', () => {
  it('at t=0 returns p0', () => {
    const cb: CubicBezier = {
      p0: { x: 1, y: 2 }, p1: { x: 3, y: 4 },
      p2: { x: 5, y: 6 }, p3: { x: 7, y: 8 },
    };
    approxPoint(cubicBezierPoint(cb, 0), { x: 1, y: 2 });
  });

  it('at t=1 returns p3', () => {
    const cb: CubicBezier = {
      p0: { x: 1, y: 2 }, p1: { x: 3, y: 4 },
      p2: { x: 5, y: 6 }, p3: { x: 7, y: 8 },
    };
    approxPoint(cubicBezierPoint(cb, 1), { x: 7, y: 8 });
  });

  it('linear bezier (collinear control points) midpoint is (p0+p3)/2', () => {
    // When p1 and p2 are at 1/3 and 2/3 respectively along p0→p3,
    // de Casteljau at t=0.5 yields the true midpoint (5, 5).
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 10 / 3, y: 10 / 3 },
      p2: { x: 20 / 3, y: 20 / 3 },
      p3: { x: 10, y: 10 },
    };
    const pt = cubicBezierPoint(cb, 0.5);
    approxPoint(pt, { x: 5, y: 5 }, 1e-6);
  });

  it('degenerate (all points same) returns same point', () => {
    const cb: CubicBezier = {
      p0: { x: 5, y: 5 }, p1: { x: 5, y: 5 },
      p2: { x: 5, y: 5 }, p3: { x: 5, y: 5 },
    };
    approxPoint(cubicBezierPoint(cb, 0.3), { x: 5, y: 5 });
  });

  it('clamps t to [0, 1]', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 },
    };
    approxPoint(cubicBezierPoint(cb, -0.5), cubicBezierPoint(cb, 0));
    approxPoint(cubicBezierPoint(cb, 1.5), cubicBezierPoint(cb, 1));
  });
});

describe('cubicBezierDerivative', () => {
  it('at t=0 is 3*(p1-p0)', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 3, y: 0 },
      p2: { x: 6, y: 0 }, p3: { x: 9, y: 0 },
    };
    const d = cubicBezierDerivative(cb, 0);
    approxPoint(d, { x: 9, y: 0 });
  });

  it('at t=1 is 3*(p3-p2)', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 3, y: 0 },
      p2: { x: 6, y: 0 }, p3: { x: 9, y: 0 },
    };
    const d = cubicBezierDerivative(cb, 1);
    approxPoint(d, { x: 9, y: 0 });
  });

  it('degenerate curve has zero derivative everywhere', () => {
    const cb: CubicBezier = {
      p0: { x: 5, y: 5 }, p1: { x: 5, y: 5 },
      p2: { x: 5, y: 5 }, p3: { x: 5, y: 5 },
    };
    approxPoint(cubicBezierDerivative(cb, 0), { x: 0, y: 0 });
    approxPoint(cubicBezierDerivative(cb, 0.5), { x: 0, y: 0 });
    approxPoint(cubicBezierDerivative(cb, 1), { x: 0, y: 0 });
  });
});

describe('cubicBezierSplit', () => {
  it('split concatenation equals original at t=0.5', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 },
    };
    const [left, right] = cubicBezierSplit(cb, 0.5);

    // Evaluate left at t=1 and right at t=0 — should match original at t=0.5
    const mid = cubicBezierPoint(cb, 0.5);
    approxPoint(cubicBezierPoint(left, 1), mid);
    approxPoint(cubicBezierPoint(right, 0), mid);

    // Endpoints preserved
    approxPoint(cubicBezierPoint(left, 0), cb.p0);
    approxPoint(cubicBezierPoint(right, 1), cb.p3);
  });

  it('split at t=0 returns [degenerate, original]', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 3, y: 4 },
      p2: { x: 6, y: 8 }, p3: { x: 10, y: 10 },
    };
    const [left, right] = cubicBezierSplit(cb, 0);
    approxPoint(left.p0, cb.p0);
    approxPoint(left.p3, cb.p0);
    approxPoint(right.p0, cb.p0);
    approxPoint(right.p3, cb.p3);
  });

  it('split at t=1 returns [original, degenerate]', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 3, y: 4 },
      p2: { x: 6, y: 8 }, p3: { x: 10, y: 10 },
    };
    const [left, right] = cubicBezierSplit(cb, 1);
    approxPoint(left.p0, cb.p0);
    approxPoint(left.p3, cb.p3);
    approxPoint(right.p0, cb.p3);
    approxPoint(right.p3, cb.p3);
  });

  it('sub-curves, when sampled, reconstruct the original shape', () => {
    const cb: CubicBezier = {
      p0: { x: 10, y: 20 }, p1: { x: 40, y: 80 },
      p2: { x: 60, y: 30 }, p3: { x: 90, y: 70 },
    };
    const tSplit = 0.4;
    const [left, right] = cubicBezierSplit(cb, tSplit);

    // For any t in [0, 1], evaluating original at t * tSplit should
    // equal evaluating left at t.
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const origPt = cubicBezierPoint(cb, s * tSplit);
      const leftPt = cubicBezierPoint(left, s);
      approxPoint(origPt, leftPt, 1e-8);
    }

    // For any t in [0, 1], evaluating original at tSplit + t*(1-tSplit)
    // should equal evaluating right at t.
    for (let i = 0; i <= 10; i++) {
      const s = i / 10;
      const origPt = cubicBezierPoint(cb, tSplit + s * (1 - tSplit));
      const rightPt = cubicBezierPoint(right, s);
      approxPoint(origPt, rightPt, 1e-8);
    }
  });
});

describe('cubicBezierBBox', () => {
  it('contains both endpoints', () => {
    // Cubic bezier p0=(0,0) p1=(0,10) p2=(10,10) p3=(10,0)
    // Control points at y=10 pull the curve up; the y-max occurs at
    // t=0.5 with y=7.5, not at the control point y=10.
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 },
    };
    const bb = cubicBezierBBox(cb);
    expect(bb.x).toBeLessThanOrEqual(0);
    expect(bb.y).toBeLessThanOrEqual(0);
    expect(bb.x + bb.w).toBeGreaterThanOrEqual(10);
    // y peaks at 7.5 (not 10 — bezier doesn't pass through p1/p2)
    approxNum(bb.y + bb.h, 7.5, 1e-4);
  });

  it('expands beyond endpoints for an s-curve with inflection', () => {
    // An S-curve: starts at (0,0) heading right, then dips left then right.
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 10, y: 10 },
      p2: { x: -10, y: 10 }, p3: { x: 0, y: 20 },
    };
    const bb = cubicBezierBBox(cb);
    // The curve goes left of x=0, so bbox x should be negative
    expect(bb.x).toBeLessThan(0);
    // Contains endpoints
    expect(bb.x + bb.w).toBeGreaterThanOrEqual(0);
    expect(bb.y + bb.h).toBeGreaterThanOrEqual(20);
  });

  it('degenerate curve has zero-area bbox', () => {
    const cb: CubicBezier = {
      p0: { x: 5, y: 5 }, p1: { x: 5, y: 5 },
      p2: { x: 5, y: 5 }, p3: { x: 5, y: 5 },
    };
    const bb = cubicBezierBBox(cb);
    approxNum(bb.x, 5);
    approxNum(bb.y, 5);
    approxNum(bb.w, 0);
    approxNum(bb.h, 0);
  });

  it('straight line bbox matches endpoints', () => {
    const cb: CubicBezier = {
      p0: { x: 2, y: 3 }, p1: { x: 4, y: 5 },
      p2: { x: 6, y: 7 }, p3: { x: 8, y: 9 },
    };
    const bb = cubicBezierBBox(cb);
    expect(bb.x).toBeLessThanOrEqual(2);
    expect(bb.y).toBeLessThanOrEqual(3);
    expect(bb.x + bb.w).toBeGreaterThanOrEqual(8);
    expect(bb.y + bb.h).toBeGreaterThanOrEqual(9);
  });
});

describe('cubicBezierLength', () => {
  it('straight line length approximately equals distance(p0,p3)', () => {
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 },
      p2: { x: 2, y: 2 }, p3: { x: 3, y: 3 },
    };
    const expected = Math.sqrt(3 * 3 + 3 * 3); // ~4.2426
    approxNum(cubicBezierLength(cb), expected, 0.1);
  });

  it('non-straight curve is longer than straight-line distance', () => {
    // Control points bulge out, making arc longer than chord
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 20 },
      p2: { x: 10, y: 20 }, p3: { x: 10, y: 0 },
    };
    const chord = Math.sqrt(10 * 10 + 0 * 0);
    const len = cubicBezierLength(cb, 20);
    expect(len).toBeGreaterThan(chord - 0.01);
  });

  it('degenerate curve has zero length', () => {
    const cb: CubicBezier = {
      p0: { x: 5, y: 5 }, p1: { x: 5, y: 5 },
      p2: { x: 5, y: 5 }, p3: { x: 5, y: 5 },
    };
    approxNum(cubicBezierLength(cb), 0, EPS_LEN);
  });
});

describe('cubicBezierClosestPoint', () => {
  it('at p=p0 returns t≈0 with dist≈0', () => {
    const cb: CubicBezier = {
      p0: { x: 10, y: 20 }, p1: { x: 30, y: 50 },
      p2: { x: 60, y: 50 }, p3: { x: 80, y: 20 },
    };
    const result = cubicBezierClosestPoint(cb, { x: 10, y: 20 });
    approxNum(result.t, 0, 1e-4);
    approxNum(result.dist, 0, 1e-4);
  });

  it('at p=p3 returns t≈1 with dist≈0', () => {
    const cb: CubicBezier = {
      p0: { x: 10, y: 20 }, p1: { x: 30, y: 50 },
      p2: { x: 60, y: 50 }, p3: { x: 80, y: 20 },
    };
    const result = cubicBezierClosestPoint(cb, { x: 80, y: 20 });
    approxNum(result.t, 1, 1e-4);
    approxNum(result.dist, 0, 1e-4);
  });

  it('midpoint of a symmetric curve finds the correct t≈0.5', () => {
    // Symmetric cubic: p0=(0,0), p1=(0,10), p2=(10,10), p3=(10,0)
    // At t=0.5, point is (5, 7.5) approx. Let's check.
    const cb: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 10 },
      p2: { x: 10, y: 10 }, p3: { x: 10, y: 0 },
    };
    const mid = cubicBezierPoint(cb, 0.5);
    const result = cubicBezierClosestPoint(cb, mid);
    approxNum(result.t, 0.5, 0.1);
    approxNum(result.dist, 0, 1e-4);
  });
});

describe('cubicBezierSegmentIntersection', () => {
  it('finds the intersection of two crossing beziers', () => {
    // A horizontal-ish curve and a vertical-ish curve that cross
    const a: CubicBezier = {
      p0: { x: 0, y: 5 }, p1: { x: 3, y: 5 },
      p2: { x: 7, y: 5 }, p3: { x: 10, y: 5 },
    };
    const b: CubicBezier = {
      p0: { x: 5, y: 0 }, p1: { x: 5, y: 3 },
      p2: { x: 5, y: 7 }, p3: { x: 5, y: 10 },
    };
    const pts = cubicBezierSegmentIntersection(a, b);
    expect(pts.length).toBeGreaterThan(0);
    // Expect intersection near (5, 5)
    const found = pts.some(
      (p) => Math.abs(p.x - 5) < 0.5 && Math.abs(p.y - 5) < 0.5,
    );
    expect(found).toBe(true);
  });

  it('returns empty for non-overlapping beziers', () => {
    const a: CubicBezier = {
      p0: { x: 0, y: 0 }, p1: { x: 0, y: 5 },
      p2: { x: 0, y: 5 }, p3: { x: 0, y: 10 },
    };
    const b: CubicBezier = {
      p0: { x: 10, y: 0 }, p1: { x: 10, y: 5 },
      p2: { x: 10, y: 5 }, p3: { x: 10, y: 10 },
    };
    const pts = cubicBezierSegmentIntersection(a, b);
    expect(pts.length).toBe(0);
  });
});

describe('pathSegmentIntersections', () => {
  it('two paths with a known overlap find intersection', () => {
    // Path A: horizontal line from (0,5) to (10,5) — no handles
    // Path B: vertical line from (5,0) to (5,10) — no handles
    const pathA: PathPoint[] = [
      { x: 0, y: 5, handleIn: null, handleOut: null },
      { x: 10, y: 5, handleIn: null, handleOut: null },
    ];
    const pathB: PathPoint[] = [
      { x: 5, y: 0, handleIn: null, handleOut: null },
      { x: 5, y: 10, handleIn: null, handleOut: null },
    ];

    const pts = pathSegmentIntersections(pathA, false, pathB, false);
    expect(pts.length).toBeGreaterThan(0);
    const found = pts.some(
      (p) => Math.abs(p.x - 5) < 1 && Math.abs(p.y - 5) < 1,
    );
    expect(found).toBe(true);
  });

  it('non-overlapping paths return empty', () => {
    const pathA: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 10, y: 0, handleIn: null, handleOut: null },
    ];
    const pathB: PathPoint[] = [
      { x: 0, y: 20, handleIn: null, handleOut: null },
      { x: 10, y: 20, handleIn: null, handleOut: null },
    ];

    const pts = pathSegmentIntersections(pathA, false, pathB, false);
    expect(pts.length).toBe(0);
  });

  it('handles closed paths correctly', () => {
    // A closed triangle and a line crossing one of its edges
    const triangle: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 10, y: 0, handleIn: null, handleOut: null },
      { x: 5, y: 10, handleIn: null, handleOut: null },
    ];
    const line: PathPoint[] = [
      { x: 5, y: -5, handleIn: null, handleOut: null },
      { x: 5, y: 15, handleIn: null, handleOut: null },
    ];

    const pts = pathSegmentIntersections(triangle, true, line, false);
    // Should intersect triangle edges at (5,0) and (5,10)
    expect(pts.length).toBeGreaterThanOrEqual(2);
  });

  it('bezier segment with handles finds intersection with line', () => {
    // A curved bezier path and a line that crosses it
    const curved: PathPoint[] = [
      { x: 0, y: 5, handleIn: null, handleOut: [3, 0] },
      { x: 10, y: 5, handleIn: [-3, 0], handleOut: null },
    ];
    const line: PathPoint[] = [
      { x: 5, y: 0, handleIn: null, handleOut: null },
      { x: 5, y: 10, handleIn: null, handleOut: null },
    ];

    const pts = pathSegmentIntersections(curved, false, line, false);
    expect(pts.length).toBeGreaterThan(0);
  });
});
