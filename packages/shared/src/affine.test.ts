import { describe, expect, it } from 'vitest';
import {
  type Affine,
  applyAffine,
  decomposeAffine,
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
  translate,
  transformRect,
  tryInvertAffine,
} from './affine';

// Tolerance for floating-point comparisons (single-precision-ish slack).
const EPS = 1e-9;

function approxEqual(a: Affine, b: Affine, tol = EPS): void {
  expect(Math.abs(a[0] - b[0])).toBeLessThanOrEqual(tol);
  expect(Math.abs(a[1] - b[1])).toBeLessThanOrEqual(tol);
  expect(Math.abs(a[2] - b[2])).toBeLessThanOrEqual(tol);
  expect(Math.abs(a[3] - b[3])).toBeLessThanOrEqual(tol);
  expect(Math.abs(a[4] - b[4])).toBeLessThanOrEqual(tol);
  expect(Math.abs(a[5] - b[5])).toBeLessThanOrEqual(tol);
}

describe('affine constructors', () => {
  it('identity is the canonical 6-tuple', () => {
    expect(identity).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('translate places translation in [4],[5]', () => {
    expect(translate(3, 5)).toEqual([1, 0, 0, 1, 3, 5]);
  });

  it('scale is uniform across both axes', () => {
    expect(scale(2)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('scaleXY is independent per axis', () => {
    expect(scaleXY(2, 3)).toEqual([2, 0, 0, 3, 0, 0]);
  });

  it('rotateDeg(90) maps (1,0) to (0,1) within tolerance', () => {
    const m = rotateDeg(90);
    const p = applyAffine(m, [1, 0]);
    expect(Math.abs(p[0])).toBeLessThan(EPS);
    expect(Math.abs(p[1] - 1)).toBeLessThan(EPS);
  });

  it('rotateRad rotates by radians, not degrees', () => {
    const m = rotateRad(Math.PI / 2);
    const p = applyAffine(m, [1, 0]);
    expect(Math.abs(p[0])).toBeLessThan(EPS);
    expect(Math.abs(p[1] - 1)).toBeLessThan(EPS);
  });

  it('rotateDeg(180) maps (1,0) to (-1,0) within tolerance', () => {
    const p = applyAffine(rotateDeg(180), [1, 0]);
    expect(Math.abs(p[0] + 1)).toBeLessThan(EPS);
    expect(Math.abs(p[1])).toBeLessThan(EPS);
  });
});

describe('applyAffine', () => {
  it('identity leaves the point unchanged', () => {
    expect(applyAffine(identity, [3, 7])).toEqual([3, 7]);
  });

  it('translate moves the point by (e, f)', () => {
    expect(applyAffine(translate(10, 20), [1, 1])).toEqual([11, 21]);
  });

  it('scale multiplies both axes', () => {
    expect(applyAffine(scale(2), [3, 5])).toEqual([6, 10]);
  });

  it('composes with hand-checked rotate+translate example', () => {
    // translate(5,5) ∘ rotate(90°) applied to (1,0): rotate first → (0,1),
    // then translate → (5,6).
    const m = multiplyAffine(translate(5, 5), rotateDeg(90));
    const p = applyAffine(m, [1, 0]);
    expect(Math.abs(p[0] - 5)).toBeLessThan(EPS);
    expect(Math.abs(p[1] - 6)).toBeLessThan(EPS);
  });
});

describe('multiplyAffine', () => {
  it('is associative: (a·b)·c == a·(b·c)', () => {
    const a = translate(1, 2);
    const b = rotateDeg(45);
    const c = scale(3);
    const left = multiplyAffine(multiplyAffine(a, b), c);
    const right = multiplyAffine(a, multiplyAffine(b, c));
    approxEqual(left, right);
  });

  it('has identity as both left and right identity', () => {
    const m = transform(5, 7, 0.3, 2);
    approxEqual(multiplyAffine(identity, m), m);
    approxEqual(multiplyAffine(m, identity), m);
  });

  it('compose two translates to a sum', () => {
    const m = multiplyAffine(translate(3, 4), translate(1, 2));
    expect(m).toEqual([1, 0, 0, 1, 4, 6]);
  });

  it('compose scale then translate matches transform helper', () => {
    const composed = multiplyAffine(translate(5, 5), scale(2));
    const viaHelper = transform(5, 5, 0, 2);
    approxEqual(composed, viaHelper);
  });

  it('applies child first then parent (scene-graph convention)', () => {
    // Parent at world (100, 100), child local translate (50, 0).
    // Child world = parent · child => point (0,0) in child local space
    // should land at world (150, 100).
    const parentWorld = translate(100, 100);
    const childLocal = translate(50, 0);
    const childWorld = multiplyAffine(parentWorld, childLocal);
    const worldPoint = applyAffine(childWorld, [0, 0]);
    expect(worldPoint).toEqual([150, 100]);
  });

  it('composes rotation through parents correctly', () => {
    // Parent rotates 90°, child is a unit square at (1,0)-(2,0) in local.
    // After parent rotation, the point (1, 0) lands at (0, 1) in world.
    const parent = rotateDeg(90);
    const child = identity;
    const world = multiplyAffine(parent, child);
    const p = applyAffine(world, [1, 0]);
    expect(Math.abs(p[0])).toBeLessThan(EPS);
    expect(Math.abs(p[1] - 1)).toBeLessThan(EPS);
  });
});

describe('invertAffine and tryInvertAffine', () => {
  it('round-trips a point through invert for a translate', () => {
    const m = translate(10, 20);
    const p = applyAffine(invertAffine(m), applyAffine(m, [3, 4]));
    expect(p).toEqual([3, 4]);
  });

  it('round-trips through invert for rotation+scale', () => {
    const m = transform(5, 7, 0.7, 2.5);
    const original: [number, number] = [3.1, -4.2];
    const roundTrip = applyAffine(invertAffine(m), applyAffine(m, original));
    expect(Math.abs(roundTrip[0] - original[0])).toBeLessThan(EPS);
    expect(Math.abs(roundTrip[1] - original[1])).toBeLessThan(EPS);
  });

  it('invertAffine returns identity for a singular matrix', () => {
    // 2x scaling on x, 0 on y, plus shear => det = 0.
    const singular: Affine = [1, 0, 1, 0, 0, 0];
    expect(invertAffine(singular)).toEqual(identity);
  });

  it('tryInvertAffine returns null for singular matrices', () => {
    const singular: Affine = [1, 0, 1, 0, 0, 0];
    expect(tryInvertAffine(singular)).toBeNull();
  });

  it('tryInvertAffine returns a usable inverse when non-singular', () => {
    const m = transform(2, 3, 0.4, 1.5);
    const inv = tryInvertAffine(m);
    expect(inv).not.toBeNull();
    if (!inv) return;
    const original: [number, number] = [1.7, 2.9];
    const roundTrip = applyAffine(inv, applyAffine(m, original));
    expect(Math.abs(roundTrip[0] - original[0])).toBeLessThan(EPS);
    expect(Math.abs(roundTrip[1] - original[1])).toBeLessThan(EPS);
  });

  it('invert is self-inverse for an orthonormal rotation', () => {
    const r = rotateDeg(30);
    approxEqual(invertAffine(invertAffine(r)), r);
  });
});

describe('geometry helpers', () => {
  it('rectContains is closed (boundary is inside)', () => {
    const r = { x: 0, y: 0, w: 10, h: 5 };
    expect(rectContains(r, [0, 0])).toBe(true);
    expect(rectContains(r, [10, 5])).toBe(true);
    expect(rectContains(r, [10.01, 0])).toBe(false);
    expect(rectContains(r, [5, -0.01])).toBe(false);
    expect(rectContains(r, [3, 3])).toBe(true);
  });

  it('pointToSegmentDistSq is zero on the segment', () => {
    const d = pointToSegmentDistSq([0, 0], [10, 0], [5, 0]);
    expect(d).toBe(0);
  });

  it('pointToSegmentDistSq clamps to endpoints', () => {
    // Point is past the (10,0) endpoint; distance should be to (10,0).
    const d = pointToSegmentDistSq([0, 0], [10, 0], [13, 4]);
    expect(d).toBe(25); // 3² + 4²
  });

  it('pointToSegmentDistSq handles degenerate (zero-length) segment', () => {
    const d = pointToSegmentDistSq([5, 5], [5, 5], [5, 9]);
    expect(d).toBe(16); // 4²
  });

  it('pointInEllipse normalises by radii', () => {
    expect(pointInEllipse(0, 0, 10, 5, [9, 0])).toBe(true);
    expect(pointInEllipse(0, 0, 10, 5, [0, 4.5])).toBe(true);
    expect(pointInEllipse(0, 0, 10, 5, [0, 5.01])).toBe(false);
    expect(pointInEllipse(0, 0, 0, 5, [0, 0])).toBe(false);
  });
});

describe('transformRect', () => {
  it('returns the same rect under identity', () => {
    const r = { x: 1, y: 2, w: 3, h: 4 };
    expect(transformRect(identity, r)).toEqual(r);
  });

  it('translates the rect', () => {
    const r = { x: 0, y: 0, w: 10, h: 5 };
    expect(transformRect(translate(3, 7), r)).toEqual({ x: 3, y: 7, w: 10, h: 5 });
  });

  it('scales the rect', () => {
    const r = { x: 0, y: 0, w: 10, h: 5 };
    expect(transformRect(scale(2), r)).toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });

  it('produces an axis-aligned bbox for a 90° rotation', () => {
    // 10×5 rect rotated 90° about origin => 5 wide × 10 tall, anchored at (-5,0).
    const r = { x: 0, y: 0, w: 10, h: 5 };
    const out = transformRect(rotateDeg(90), r);
    expect(Math.abs(out.w - 5)).toBeLessThan(EPS);
    expect(Math.abs(out.h - 10)).toBeLessThan(EPS);
  });

  it('handles negative-width input (defensive)', () => {
    const r = { x: 5, y: 0, w: -5, h: 4 };
    const out = transformRect(identity, r);
    expect(out.x).toBeLessThanOrEqual(0);
    expect(out.w).toBeGreaterThanOrEqual(5);
  });
});

describe('decomposeAffine', () => {
  it('returns null for a singular matrix', () => {
    expect(decomposeAffine([0, 0, 0, 0, 1, 2])).toBeNull();
  });

  it('returns null for a skewed matrix', () => {
    const skew: Affine = [1, 0, 1, 1, 0, 0];
    expect(decomposeAffine(skew)).toBeNull();
  });

  it('recovers translation, rotation, and uniform scale', () => {
    const tx = 5;
    const ty = 7;
    const rot = 0.4;
    const s = 2;
    const m = transform(tx, ty, rot, s);
    const d = decomposeAffine(m);
    expect(d).not.toBeNull();
    if (!d) return;
    expect(Math.abs(d.translateX - tx)).toBeLessThan(EPS);
    expect(Math.abs(d.translateY - ty)).toBeLessThan(EPS);
    expect(Math.abs(d.rotation - rot)).toBeLessThan(EPS);
    expect(Math.abs(d.scale - s)).toBeLessThan(EPS);
  });
});
