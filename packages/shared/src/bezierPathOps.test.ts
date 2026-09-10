// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { CubicBezier, PathPoint } from './bezier';
import { cubicBezierPoint, cubicBezierSplit } from './bezier';
import {
  canRecombineCubics,
  deleteAnchorPreservingGeometry,
  inferPointType,
  insertPointOnSegment,
  nearestPointOnPath,
  segmentToCubic,
} from './bezierPathOps';

const CLOSE_PRECISION = 6;

function pt(
  x: number,
  y: number,
  hIn?: [number, number] | null,
  hOut?: [number, number] | null,
): PathPoint {
  return { x, y, handleIn: hIn ?? null, handleOut: hOut ?? null };
}

describe('segmentToCubic', () => {
  it('converts two corner points to a linear cubic', () => {
    const cb = segmentToCubic(pt(0, 0), pt(100, 0));
    expect(cb.p0).toEqual({ x: 0, y: 0 });
    expect(cb.p3).toEqual({ x: 100, y: 0 });
    expect(cb.p1.x).toBeCloseTo(100 / 3);
  });

  it('converts handles to control points', () => {
    const cb = segmentToCubic(pt(0, 0, null, [30, 40]), pt(100, 100, [-20, -30], null));
    expect(cb.p1).toEqual({ x: 30, y: 40 });
    expect(cb.p2).toEqual({ x: 80, y: 70 });
  });
});

describe('cubic evaluation consistency', () => {
  it('B(0) = P0, B(1) = P3', () => {
    const cb = segmentToCubic(pt(10, 20, null, [30, 0]), pt(100, 80, [-20, 0], null));
    const b0 = cubicBezierPoint(cb, 0);
    const b1 = cubicBezierPoint(cb, 1);
    expect(b0.x).toBeCloseTo(10, CLOSE_PRECISION);
    expect(b1.x).toBeCloseTo(100, CLOSE_PRECISION);
  });
});

// ─── de Casteljau insertion ────────────────────────────────────────────

describe('insertPointOnSegment', () => {
  it('inserts at t=0.5 and preserves the first segment geometry', () => {
    const from = pt(0, 0, null, [30, 0]);
    const to = pt(100, 100, [-20, 0], null);
    const originalCb = segmentToCubic(from, to);

    // Insert into a 2-point path (simplest case)
    const inserted = insertPointOnSegment([from, to], 0, 0.5);
    expect(inserted).toHaveLength(3);

    // The two sub-segments should together reproduce the original exactly
    const seg1 = segmentToCubic(inserted[0]!, inserted[1]!);
    const seg2 = segmentToCubic(inserted[1]!, inserted[2]!);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      let sample: { x: number; y: number };
      if (t <= 0.5) {
        sample = cubicBezierPoint(seg1, t * 2);
      } else {
        sample = cubicBezierPoint(seg2, (t - 0.5) * 2);
      }
      expect(sample.x).toBeCloseTo(cubicBezierPoint(originalCb, t).x, 4);
      expect(sample.y).toBeCloseTo(cubicBezierPoint(originalCb, t).y, 4);
    }
  });

  it('inserts at t=0.25 and preserves geometry', () => {
    const from = pt(0, 0, null, [40, 20]);
    const to = pt(80, 60, [-30, 10], null);
    const originalCb = segmentToCubic(from, to);

    const inserted = insertPointOnSegment([from, to], 0, 0.25);
    expect(inserted).toHaveLength(3);

    // First sub-segment covers original [0, 0.25]
    const seg1 = segmentToCubic(inserted[0]!, inserted[1]!);
    const seg2 = segmentToCubic(inserted[1]!, inserted[2]!);
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      let sample: { x: number; y: number };
      if (t <= 0.25) {
        sample = cubicBezierPoint(seg1, t / 0.25);
      } else {
        sample = cubicBezierPoint(seg2, (t - 0.25) / 0.75);
      }
      expect(sample.x).toBeCloseTo(cubicBezierPoint(originalCb, t).x, 3);
      expect(sample.y).toBeCloseTo(cubicBezierPoint(originalCb, t).y, 3);
    }
  });
});

// ─── geometry-preserving deletion ──────────────────────────────────────

describe('deleteAnchorPreservingGeometry', () => {
  it('deletes interior anchor from open path', () => {
    const result = deleteAnchorPreservingGeometry([pt(0, 0), pt(50, 50), pt(100, 0)], 1, false);
    expect(result).toHaveLength(2);
    expect(result![0]!.x).toBe(0);
    expect(result![1]!.x).toBe(100);
  });

  it('deletes endpoint from open path', () => {
    const result = deleteAnchorPreservingGeometry([pt(0, 0), pt(50, 50), pt(100, 0)], 0, false);
    expect(result).toHaveLength(2);
  });

  it('returns null for 2-point open path', () => {
    expect(deleteAnchorPreservingGeometry([pt(0, 0), pt(100, 0)], 0, false)).toBeNull();
  });

  it('returns null for closed path with fewer than 3 points', () => {
    expect(deleteAnchorPreservingGeometry([pt(0, 0), pt(100, 0)], 0, true)).toBeNull();
  });

  it('preserves non-adjacent geometry', () => {
    const points = [
      pt(0, 0, null, [10, 0]),
      pt(30, 50, [5, -10], [5, 10]),
      pt(60, 20, [-5, 5], [-5, -5]),
      pt(100, 0, [-10, 0], null),
    ];
    const result = deleteAnchorPreservingGeometry(points, 1, false);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(3);
    expect(result![0]!.x).toBe(0);
    expect(result![2]!.x).toBe(100);
  });
});

// ─── insert/delete roundtrip ───────────────────────────────────────────

describe('insert/delete roundtrip', () => {
  it('inserting then deleting restores original segment geometry', () => {
    const from = pt(0, 0, null, [30, 0]);
    const to = pt(50, 100, [-20, 0], [20, 0]);
    const originalCb = segmentToCubic(from, to);

    const inserted = insertPointOnSegment([from, to], 0, 0.5);
    expect(inserted.length).toBe(3);

    // Delete the inserted point (index 1) → should restore 2 points
    const deleted = deleteAnchorPreservingGeometry(inserted, 1, false);
    expect(deleted).not.toBeNull();
    expect(deleted!.length).toBe(2);

    // Verify the restored segment matches original
    const restoredCb = segmentToCubic(deleted![0]!, deleted![1]!);
    for (let i = 0; i <= 20; i++) {
      const sample = cubicBezierPoint(restoredCb, i / 20);
      expect(sample.x).toBeCloseTo(cubicBezierPoint(originalCb, i / 20).x, 3);
      expect(sample.y).toBeCloseTo(cubicBezierPoint(originalCb, i / 20).y, 3);
    }
  });
});

// ─── canRecombineCubics ───────────────────────────────────────────────

describe('canRecombineCubics', () => {
  it('detects exact recombination of de Casteljau subdivision', () => {
    const original: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 30, y: 50 },
      p2: { x: 70, y: 50 },
      p3: { x: 100, y: 0 },
    };
    const [left, right] = cubicBezierSplit(original, 0.5);
    const { ok } = canRecombineCubics(left, right, 1e-4);
    expect(ok).toBe(true);
  });

  it('rejects cubics that are not from the same original', () => {
    const left: CubicBezier = {
      p0: { x: 0, y: 0 },
      p1: { x: 10, y: 10 },
      p2: { x: 20, y: 20 },
      p3: { x: 30, y: 30 },
    };
    const right: CubicBezier = {
      p0: { x: 50, y: 50 },
      p1: { x: 60, y: 60 },
      p2: { x: 70, y: 70 },
      p3: { x: 100, y: 0 },
    };
    const { ok } = canRecombineCubics(left, right);
    expect(ok).toBe(false);
  });
});

// ─── nearestPointOnPath ───────────────────────────────────────────────

describe('nearestPointOnPath', () => {
  it('finds closest point on a straight segment', () => {
    const result = nearestPointOnPath([pt(0, 0), pt(100, 0)], false, { x: 50, y: 10 });
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(50, 1);
  });

  it('returns null for single-point path', () => {
    expect(nearestPointOnPath([pt(0, 0)], false, { x: 50, y: 10 })).toBeNull();
  });
});

// ─── inferPointType ───────────────────────────────────────────────────

describe('inferPointType', () => {
  it('corner: no handles', () => expect(inferPointType(pt(0, 0), null, null)).toBe('corner'));
  it('corner: one-sided handle', () =>
    expect(inferPointType(pt(0, 0, null, [10, 0]), null, null)).toBe('corner'));
  it('smooth: collinear handles, different lengths', () =>
    expect(inferPointType(pt(0, 0, [-10, 0], [20, 0]), null, null)).toBe('smooth'));
  it('symmetric: collinear handles, equal length', () =>
    expect(inferPointType(pt(0, 0, [-15, 0], [15, 0]), null, null)).toBe('symmetric'));
  it('corner: non-collinear handles', () =>
    expect(inferPointType(pt(0, 0, [10, 0], [0, 10]), null, null)).toBe('corner'));
});

// ─── edge cases ────────────────────────────────────────────────────────

describe('degenerate geometry', () => {
  it('insertion on coincident anchors does not crash', () => {
    expect(() =>
      insertPointOnSegment([pt(50, 50), pt(50, 50), pt(100, 100)], 0, 0.5),
    ).not.toThrow();
  });

  it('zero-length handle does not crash', () => {
    expect(() => segmentToCubic(pt(0, 0, null, [0, 0]), pt(100, 100))).not.toThrow();
  });

  it('large coordinates do not produce NaN', () => {
    const cb = segmentToCubic(
      pt(1e8, 1e8, null, [1e6, 1e6]),
      pt(1e8 + 100, 1e8 + 200, [-1e6, -1e6], null),
    );
    expect(Number.isFinite(cb.p1.x)).toBe(true);
  });
});
