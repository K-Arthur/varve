import { describe, expect, it } from 'vitest';
import { applyAffine, identity, rotateDeg, rotateRad, scale, translate } from './affine';
import {
  alignBBox,
  type BBox,
  bboxUnion,
  computeAlignmentTarget,
  computeDistribution,
  computeDistributionCenters,
  computeTidyLayout,
  distributeToPosition,
  obbAlignmentTarget,
  obbToAABB,
  orientedBBox,
} from './align';

const EPS = 1e-9;

// ─── bboxUnion ────────────────────────────────────────────────────────────

describe('bboxUnion', () => {
  it('returns null for empty array', () => {
    expect(bboxUnion([])).toBeNull();
  });

  it('single item — returns that item', () => {
    const b: BBox = { x: 10, y: 20, w: 30, h: 40 };
    const result = bboxUnion([b]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.x).toBe(10);
    expect(result.y).toBe(20);
    expect(result.w).toBe(30);
    expect(result.h).toBe(40);
  });

  it('two disjoint items', () => {
    const a: BBox = { x: 0, y: 0, w: 10, h: 10 };
    const b: BBox = { x: 20, y: 20, w: 10, h: 10 };
    const result = bboxUnion([a, b]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(30);
    expect(result.h).toBe(30);
  });

  it('three overlapping items', () => {
    const a: BBox = { x: 0, y: 0, w: 10, h: 10 };
    const b: BBox = { x: 5, y: 5, w: 10, h: 10 };
    const c: BBox = { x: -5, y: -5, w: 10, h: 10 };
    const result = bboxUnion([a, b, c]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.x).toBe(-5);
    expect(result.y).toBe(-5);
    expect(result.w).toBe(20);
    expect(result.h).toBe(20);
  });

  it('one inside the other', () => {
    const outer: BBox = { x: 0, y: 0, w: 100, h: 100 };
    const inner: BBox = { x: 25, y: 25, w: 50, h: 50 };
    const result = bboxUnion([outer, inner]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(100);
    expect(result.h).toBe(100);
  });
});

// ─── computeAlignmentTarget ───────────────────────────────────────────────

describe('computeAlignmentTarget', () => {
  it('returns null for <2 items', () => {
    expect(computeAlignmentTarget('left', [{ x: 0, y: 0, w: 10, h: 10 }])).toBeNull();
    expect(computeAlignmentTarget('left', [])).toBeNull();
  });

  it('2 items — union extremes are correct', () => {
    const a: BBox = { x: 0, y: 10, w: 20, h: 20 };
    const b: BBox = { x: 40, y: 50, w: 30, h: 10 };
    const result = computeAlignmentTarget('left', [a, b]);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.left).toBe(0);
    expect(result.right).toBe(70);
    expect(result.top).toBe(10);
    expect(result.bottom).toBe(60);
    expect(result.centerX).toBe(35);
    expect(result.centerY).toBe(35);
  });

  it('3 items — union covers all extremes', () => {
    const boxes: BBox[] = [
      { x: -10, y: -10, w: 5, h: 5 },
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 30, w: 10, h: 10 },
    ];
    const result = computeAlignmentTarget('left', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.left).toBe(-10);
    expect(result.right).toBe(30);
    expect(result.top).toBe(-10);
    expect(result.bottom).toBe(40);
    expect(Math.abs(result.centerX - 10)).toBeLessThan(EPS);
    expect(Math.abs(result.centerY - 15)).toBeLessThan(EPS);
  });
});

// ─── alignBBox ────────────────────────────────────────────────────────────

describe('alignBBox', () => {
  const target = { left: 0, right: 100, top: 0, bottom: 100, centerX: 50, centerY: 50 };
  const bbox: BBox = { x: 30, y: 40, w: 20, h: 10 };

  it('left', () => {
    const pos = alignBBox(bbox, 'left', target);
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(40);
  });

  it('centerH', () => {
    const pos = alignBBox(bbox, 'centerH', target);
    expect(pos.x).toBe(40); // 50 - 20/2
    expect(pos.y).toBe(40);
  });

  it('right', () => {
    const pos = alignBBox(bbox, 'right', target);
    expect(pos.x).toBe(80); // 100 - 20
    expect(pos.y).toBe(40);
  });

  it('top', () => {
    const pos = alignBBox(bbox, 'top', target);
    expect(pos.x).toBe(30);
    expect(pos.y).toBe(0);
  });

  it('centerV', () => {
    const pos = alignBBox(bbox, 'centerV', target);
    expect(pos.x).toBe(30);
    expect(pos.y).toBe(45); // 50 - 10/2
  });

  it('bottom', () => {
    const pos = alignBBox(bbox, 'bottom', target);
    expect(pos.x).toBe(30);
    expect(pos.y).toBe(90); // 100 - 10
  });
});

// ─── computeDistribution ──────────────────────────────────────────────────

describe('computeDistribution', () => {
  it('returns null for <3 items', () => {
    expect(computeDistribution('horizontal', [{ x: 0, y: 0, w: 10, h: 10 }])).toBeNull();
    expect(
      computeDistribution('horizontal', [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 0, w: 10, h: 10 },
      ]),
    ).toBeNull();
  });

  it('3 items even gap horizontally', () => {
    // Items: 0-10, 20-30, 40-50 → total span = 50, total size = 30
    // gap = (50 - 30) / 2 = 10
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
      { x: 40, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(3);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(40);
  });

  it('4 items with uneven spacing get redistributed evenly', () => {
    // Items: x=0(w=10), x=30(w=10), x=50(w=10), x=60(w=10)
    // Sorted: 0→30→50→60
    // start=0, end=70, totalSize=40, gap=(70-40)/3=10
    // positions: 0, 10+10=20, 20+10=30, 30+10=40
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 50, y: 0, w: 10, h: 10 },
      { x: 60, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(4);
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(40);
    expect(result[3]).toBe(60);
  });

  it('3 items even gap vertically', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 20, w: 10, h: 10 },
      { x: 0, y: 40, w: 10, h: 10 },
    ];
    const result = computeDistribution('vertical', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(40);
  });

  it('with fixed gap', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 60, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes, 5);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(15); // 0 + 10 + 5
    expect(result[2]).toBe(30); // 15 + 10 + 5
  });

  it('with fixed gap sorts by position', () => {
    const boxes: BBox[] = [
      { x: 100, y: 0, w: 10, h: 10 },
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 50, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes, 5);
    expect(result).not.toBeNull();
    if (!result) return;
    // After sorting: [0, 50, 100] → positions: 0, 15, 30
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(15);
    expect(result[2]).toBe(30);
  });
});

// ─── computeDistributionCenters (equal center-to-center) ─────────────────

describe('computeDistributionCenters', () => {
  it('returns null for <3 items', () => {
    expect(computeDistributionCenters('horizontal', [{ x: 0, y: 0, w: 10, h: 10 }])).toBeNull();
    expect(
      computeDistributionCenters('horizontal', [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 0, w: 10, h: 10 },
      ]),
    ).toBeNull();
  });

  it('3 items equal center spacing horizontally', () => {
    // Items centers: 5, 25, 45 → total span = 40, step = 20
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
      { x: 40, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistributionCenters('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(3);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(25);
    expect(result[2]).toBe(45);
  });

  it('3 items equal center spacing vertically', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 0, y: 30, w: 10, h: 10 },
      { x: 0, y: 60, w: 10, h: 10 },
    ];
    const result = computeDistributionCenters('vertical', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.length).toBe(3);
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(35);
    expect(result[2]).toBe(65);
  });

  it('variable sized items — centers are evenly spaced', () => {
    // Centers: 5, 25 (items overlap slightly), 75
    // Span = 75 - 5 = 70, step = 35
    // Centers: 5, 40, 75
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 30, h: 10 },
      { x: 50, y: 0, w: 50, h: 10 },
    ];
    const result = computeDistributionCenters('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(40);
    expect(result[2]).toBe(75);
  });

  it('overlapping items — still computes valid centers', () => {
    // Centers: 5, 15, 25 → span = 20, step = 10
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
      { x: 20, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistributionCenters('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBe(5);
    expect(result[1]).toBe(15);
    expect(result[2]).toBe(25);
  });
});

// ─── computeDistribution with negative gaps ──────────────────────────────

describe('computeDistribution — negative gap handling', () => {
  it('overlapping items with no fixed gap — gap clamps to 0', () => {
    // Items that already overlap
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 20, h: 10 },
      { x: 5, y: 0, w: 20, h: 10 },
      { x: 10, y: 0, w: 20, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes);
    expect(result).not.toBeNull();
    if (!result) return;
    // start=0, end=30, totalSize=60, gap=0 (clamped)
    // positions: 0, 20, 40
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(20);
    expect(result[2]).toBe(40);
  });

  it('fixed negative gap — clamped to 0', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 10, h: 10 },
      { x: 60, y: 0, w: 10, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes, -10);
    expect(result).not.toBeNull();
    if (!result) return;
    // With gap=0: positions: 0, 10, 20
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(10);
    expect(result[2]).toBe(20);
  });

  it('zero-width items with fixed gap', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 0, h: 10 },
      { x: 10, y: 0, w: 0, h: 10 },
      { x: 20, y: 0, w: 0, h: 10 },
    ];
    const result = computeDistribution('horizontal', boxes, 5);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(5);
    expect(result[2]).toBe(10);
  });
});

// ─── Tidy Up determinism ─────────────────────────────────────────────────

describe('computeTidyLayout — determinism', () => {
  it('same input produces same output across repeated runs', () => {
    const boxes: BBox[] = [
      { x: 10, y: 10, w: 20, h: 20 },
      { x: 100, y: 100, w: 20, h: 20 },
      { x: 50, y: 10, w: 20, h: 20 },
      { x: 10, y: 100, w: 20, h: 20 },
    ];
    const result1 = computeTidyLayout(boxes, 4);
    const result2 = computeTidyLayout(boxes, 4);
    expect(result1.rows).toBe(result2.rows);
    expect(result1.cols).toBe(result2.cols);
    for (let i = 0; i < boxes.length; i++) {
      expect(result1.assignments[i]).toEqual(result2.assignments[i]);
    }
  });

  it('tie-break by X for items at same Y — leftmost gets col 0', () => {
    // Items at same Y with different X — should sort left→right after Y tie-break
    // Input order: [x=50, y=10], [x=10, y=10]
    // After tie-break sort (cy, then cx): [idx=1 (x=10), idx=0 (x=50)]
    const boxes: BBox[] = [
      { x: 50, y: 10, w: 20, h: 20 },
      { x: 10, y: 10, w: 20, h: 20 },
    ];
    const result = computeTidyLayout(boxes, 4);
    // idx=1 (x=10) gets col 0, idx=0 (x=50) gets col 1
    expect(result.assignments[1]).toEqual([0, 0]); // x=10 → row 0, col 0
    expect(result.assignments[0]).toEqual([0, 1]); // x=50 → row 0, col 1
  });
});

// ─── orientedBBox ─────────────────────────────────────────────────────────

describe('orientedBBox', () => {
  it('identity affine — correct corners', () => {
    const obb = orientedBBox(identity, 10, 20);
    expect(obb[0]).toEqual([0, 0]);
    expect(obb[1]).toEqual([10, 0]);
    expect(obb[2]).toEqual([10, 20]);
    expect(obb[3]).toEqual([0, 20]);
  });

  it('translation — offsets all corners', () => {
    const obb = orientedBBox(translate(5, 7), 10, 20);
    expect(obb[0]).toEqual([5, 7]);
    expect(obb[1]).toEqual([15, 7]);
    expect(obb[2]).toEqual([15, 27]);
    expect(obb[3]).toEqual([5, 27]);
  });

  it('90° rotation about origin — corners match Pythagorean expectation', () => {
    // 10×20 rect rotated 90°: (0,0)→(0,0), (10,0)→(0,10), (10,20)→(-20,10), (0,20)→(-20,0)
    const obb = orientedBBox(rotateDeg(90), 10, 20);
    expect(Math.abs(obb[0][0])).toBeLessThan(EPS);
    expect(Math.abs(obb[0][1])).toBeLessThan(EPS);
    expect(Math.abs(obb[1][0])).toBeLessThan(EPS);
    expect(Math.abs(obb[1][1] - 10)).toBeLessThan(EPS);
    expect(Math.abs(obb[2][0] + 20)).toBeLessThan(EPS);
    expect(Math.abs(obb[2][1] - 10)).toBeLessThan(EPS);
    expect(Math.abs(obb[3][0] + 20)).toBeLessThan(EPS);
    expect(Math.abs(obb[3][1])).toBeLessThan(EPS);
  });

  it('45° rotation — check corner positions via applyAffine', () => {
    const m = rotateRad(Math.PI / 4);
    const obb = orientedBBox(m, 10, 20);
    // Manually compute expected corners
    const expected = [
      applyAffine(m, [0, 0]),
      applyAffine(m, [10, 0]),
      applyAffine(m, [10, 20]),
      applyAffine(m, [0, 20]),
    ];
    for (let i = 0; i < 4; i++) {
      const obbP = obb[i]!;
      const expP = expected[i]!;
      expect(Math.abs(obbP[0] - expP[0])).toBeLessThan(EPS);
      expect(Math.abs(obbP[1] - expP[1])).toBeLessThan(EPS);
    }
  });

  it('scale moves corners outward', () => {
    const obb = orientedBBox(scale(2), 10, 20);
    expect(obb[0]).toEqual([0, 0]);
    expect(obb[1]).toEqual([20, 0]);
    expect(obb[2]).toEqual([20, 40]);
    expect(obb[3]).toEqual([0, 40]);
  });

  it('zero-size rect returns overlapping corners', () => {
    const obb = orientedBBox(identity, 0, 0);
    for (const p of obb) {
      expect(p[0]).toBe(0);
      expect(p[1]).toBe(0);
    }
  });
});

// ─── obbToAABB ────────────────────────────────────────────────────────────

describe('obbToAABB', () => {
  it('unrotated rect returns itself', () => {
    const obb = orientedBBox(identity, 10, 20);
    const aabb = obbToAABB(obb);
    expect(aabb.x).toBe(0);
    expect(aabb.y).toBe(0);
    expect(aabb.w).toBe(10);
    expect(aabb.h).toBe(20);
  });

  it('translated rect returns correct AABB', () => {
    const obb = orientedBBox(translate(5, 7), 10, 20);
    const aabb = obbToAABB(obb);
    expect(aabb.x).toBe(5);
    expect(aabb.y).toBe(7);
    expect(aabb.w).toBe(10);
    expect(aabb.h).toBe(20);
  });

  it('rotated rect — AABB encloses all corners', () => {
    const obb = orientedBBox(rotateDeg(45), 10, 10);
    const aabb = obbToAABB(obb);
    // 10×10 square rotated 45°: half-diagonal = 10/√2 * √2 = ... wait
    // Diagonal = 10*√2 ≈ 14.14, half = 7.07, AABB from (-7.07,0) to (0,7.07) to (7.07,0) to (0,-7.07)
    // Actually corners: (0,0), (10*cos45, 10*sin45) = (7.07, 7.07), (0, 14.14), (-7.07, 7.07)
    // So AABB: x = -7.07, y = 0, w = 14.14, h = 14.14
    expect(Math.abs(aabb.w - aabb.h)).toBeLessThan(EPS);
    expect(Math.abs(aabb.w - 10 * Math.SQRT2)).toBeLessThan(EPS);
  });
});

// ─── obbAlignmentTarget ───────────────────────────────────────────────────

describe('obbAlignmentTarget', () => {
  it('returns null for empty array', () => {
    expect(obbAlignmentTarget('left', [])).toBeNull();
  });

  it('left — minimum X across all corners of 2 OBBs', () => {
    const obb1 = orientedBBox(identity, 10, 10);
    const obb2 = orientedBBox(translate(30, 0), 10, 10);
    expect(obbAlignmentTarget('left', [obb1, obb2])).toBe(0);
  });

  it('right — maximum X across all corners of 2 OBBs', () => {
    const obb1 = orientedBBox(identity, 10, 10);
    const obb2 = orientedBBox(translate(30, 0), 10, 10);
    expect(obbAlignmentTarget('right', [obb1, obb2])).toBe(40);
  });

  it('top — minimum Y across all corners', () => {
    const obb1 = orientedBBox(identity, 10, 10);
    const obb2 = orientedBBox(translate(0, 20), 10, 10);
    expect(obbAlignmentTarget('top', [obb1, obb2])).toBe(0);
  });

  it('bottom — maximum Y across all corners', () => {
    const obb1 = orientedBBox(identity, 10, 10);
    const obb2 = orientedBBox(translate(0, 20), 10, 10);
    expect(obbAlignmentTarget('bottom', [obb1, obb2])).toBe(30);
  });

  it('centerH — average of center X values', () => {
    const obb1 = orientedBBox(identity, 10, 10); // center X = 5
    const obb2 = orientedBBox(translate(30, 0), 10, 10); // center X = 35
    const result = obbAlignmentTarget('centerH', [obb1, obb2]);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(Math.abs(result - 20)).toBeLessThan(EPS);
  });

  it('centerV — average of center Y values', () => {
    const obb1 = orientedBBox(identity, 10, 10); // center Y = 5
    const obb2 = orientedBBox(translate(0, 30), 10, 10); // center Y = 35
    const result = obbAlignmentTarget('centerV', [obb1, obb2]);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(Math.abs(result - 20)).toBeLessThan(EPS);
  });
});

// ─── computeTidyLayout ────────────────────────────────────────────────────

describe('computeTidyLayout', () => {
  it('empty items — returns zeros', () => {
    const result = computeTidyLayout([], 4);
    expect(result.rows).toBe(0);
    expect(result.cols).toBe(0);
    expect(result.assignments).toEqual([]);
    expect(result.colWidth).toBe(0);
    expect(result.rowHeight).toBe(0);
  });

  it('single item — one row, one col', () => {
    const boxes: BBox[] = [{ x: 0, y: 0, w: 100, h: 50 }];
    const result = computeTidyLayout(boxes, 4);
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(1);
    expect(result.assignments).toEqual([[0, 0]]);
    expect(result.colWidth).toBe(100);
    expect(result.rowHeight).toBe(50);
  });

  it('items in a row — grouped by proximity', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 30, h: 20 },
      { x: 40, y: 0, w: 30, h: 20 },
      { x: 80, y: 0, w: 30, h: 20 },
    ];
    const result = computeTidyLayout(boxes, 4);
    // All on same row
    expect(result.rows).toBe(1);
    expect(result.cols).toBe(3);
    // Assignments should be in order: (0,0), (0,1), (0,2)
    expect(result.assignments[0]).toEqual([0, 0]);
    expect(result.assignments[1]).toEqual([0, 1]);
    expect(result.assignments[2]).toEqual([0, 2]);
    expect(result.colWidth).toBe(30);
    expect(result.rowHeight).toBe(20);
  });

  it('items in multiple rows — row and col detection', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 30, h: 20 },
      { x: 50, y: 0, w: 30, h: 20 },
      { x: 0, y: 50, w: 30, h: 20 },
      { x: 50, y: 50, w: 30, h: 20 },
    ];
    const result = computeTidyLayout(boxes, 4);
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);
    // Row 0 items (top row) indexed first
    const a0 = result.assignments[0]!;
    const a1 = result.assignments[1]!;
    const a2 = result.assignments[2]!;
    const a3 = result.assignments[3]!;
    expect(a0[0]).toBe(0);
    expect(a1[0]).toBe(0);
    expect(a2[0]).toBe(1);
    expect(a3[0]).toBe(1);
  });

  it('respects maxCols — wraps to next row', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 20, h: 20 },
      { x: 30, y: 0, w: 20, h: 20 },
      { x: 60, y: 0, w: 20, h: 20 },
      { x: 90, y: 0, w: 20, h: 20 },
    ];
    const result = computeTidyLayout(boxes, 2);
    expect(result.rows).toBe(2);
    expect(result.cols).toBe(2);
    // First two items row 0, last two row 1
    expect(result.assignments[0]![0]).toBe(0);
    expect(result.assignments[1]![0]).toBe(0);
    expect(result.assignments[2]![0]).toBe(1);
    expect(result.assignments[3]![0]).toBe(1);
  });

  it('scattered items — detects row groups by Y proximity', () => {
    const boxes: BBox[] = [
      { x: 10, y: 10, w: 30, h: 20 },
      { x: 10, y: 100, w: 30, h: 20 },
      { x: 10, y: 200, w: 30, h: 20 },
    ];
    const result = computeTidyLayout(boxes, 4);
    expect(result.rows).toBe(3);
    expect(result.cols).toBe(1);
    expect(result.assignments[0]).toEqual([0, 0]);
    expect(result.assignments[1]).toEqual([1, 0]);
    expect(result.assignments[2]).toEqual([2, 0]);
  });

  it('colWidth and rowHeight from max item', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 100, h: 20 },
      { x: 0, y: 0, w: 50, h: 50 },
    ];
    const result = computeTidyLayout(boxes, 4);
    // Both on same row (y = 0 for both)
    expect(result.colWidth).toBe(100);
    expect(result.rowHeight).toBe(50);
  });
});

// ─── distributeToPosition ─────────────────────────────────────────────────

describe('distributeToPosition', () => {
  it('horizontal — returns position as x, preserves y', () => {
    const sorted: BBox[] = [
      { x: 0, y: 10, w: 20, h: 30 },
      { x: 30, y: 10, w: 20, h: 30 },
      { x: 60, y: 10, w: 20, h: 30 },
    ];
    const result = distributeToPosition(15, 1, sorted[1]!, 'horizontal', sorted);
    expect(result.x).toBe(15);
    expect(result.y).toBe(10);
  });

  it('vertical — returns position as y, preserves x', () => {
    const sorted: BBox[] = [
      { x: 5, y: 0, w: 20, h: 30 },
      { x: 5, y: 40, w: 20, h: 30 },
      { x: 5, y: 80, w: 20, h: 30 },
    ];
    const result = distributeToPosition(50, 1, sorted[1]!, 'vertical', sorted);
    expect(result.x).toBe(5);
    expect(result.y).toBe(50);
  });
});

// ─── Integration: full alignment pipeline ─────────────────────────────────

describe('integration — alignment pipeline', () => {
  it('align 3 boxes to left edge', () => {
    const boxes: BBox[] = [
      { x: 10, y: 0, w: 20, h: 10 },
      { x: 50, y: 20, w: 30, h: 15 },
      { x: 0, y: 40, w: 10, h: 20 },
    ];
    const target = computeAlignmentTarget('left', boxes);
    expect(target).not.toBeNull();
    if (!target) return;
    expect(target.left).toBe(0);
    for (const b of boxes) {
      const pos = alignBBox(b, 'left', target);
      expect(pos.x).toBe(0);
    }
  });

  it('align 3 boxes to center horizontally', () => {
    const boxes: BBox[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 20, h: 10 },
      { x: 100, y: 0, w: 10, h: 10 },
    ];
    const target = computeAlignmentTarget('centerH', boxes);
    expect(target).not.toBeNull();
    if (!target) return;
    // Union: x=0, right=110 → centerX=55
    expect(Math.abs(target.centerX - 55)).toBeLessThan(EPS);
    for (const b of boxes) {
      const pos = alignBBox(b, 'centerH', target);
      expect(pos.x).toBe(target.centerX - b.w / 2);
    }
  });

  it('distribute 4 boxes evenly then align horizontally, check positions', () => {
    const boxes: BBox[] = [
      { x: 0, y: 10, w: 20, h: 20 },
      { x: 40, y: 30, w: 20, h: 20 },
      { x: 80, y: 50, w: 20, h: 20 },
      { x: 120, y: 0, w: 20, h: 20 },
    ];
    // First align to top
    const target = computeAlignmentTarget('top', boxes);
    expect(target).not.toBeNull();
    if (!target) return;
    const aligned = boxes.map((b) => {
      const pos = alignBBox(b, 'top', target);
      return { ...b, x: pos.x, y: pos.y };
    });
    for (const b of aligned) {
      expect(b.y).toBe(0);
    }
    // Then distribute horizontally
    const dist = computeDistribution('horizontal', aligned);
    expect(dist).not.toBeNull();
    if (!dist) return;
    expect(dist.length).toBe(4);
    // After alignment and distribution, all on same Y
    const finalPositions = aligned.map((b, i) => {
      const pos = distributeToPosition(dist[i]!, i, b, 'horizontal', aligned);
      return pos;
    });
    for (const p of finalPositions) {
      expect(p.y).toBe(0);
    }
  });
});
