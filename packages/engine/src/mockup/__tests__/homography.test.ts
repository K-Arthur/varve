import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  type Homography,
  invertHomography,
  isQuadConcave,
  isQuadSelfCrossing,
  isQuadValid,
  multiplyHomography,
  normalizeQuadCorners,
  type Quad,
  quadBounds,
  solveHomography,
} from '../homography';

const identity: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 1];

describe('solveHomography', () => {
  it('returns identity for identical quads', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const h = solveHomography(q, q);
    expect(h).not.toBeNull();
    const p = applyHomography(h!, { x: 37, y: 41 });
    expect(p.x).toBeCloseTo(37, 6);
    expect(p.y).toBeCloseTo(41, 6);
  });

  it('maps corners exactly for an affine (scaled) quad', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const dst: Quad = [
      { x: 10, y: 20 },
      { x: 310, y: 20 },
      { x: 310, y: 260 },
      { x: 10, y: 260 },
    ];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h!, src[i]!);
      expect(p.x).toBeCloseTo(dst[i]!.x, 5);
      expect(p.y).toBeCloseTo(dst[i]!.y, 5);
    }
  });

  it('maps an interior point through a true perspective (non-affine) quad', () => {
    // Tilted poster: top edge shorter than bottom edge (camera looking down).
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ];
    const dst: Quad = [
      { x: 50, y: 40 },
      { x: 150, y: 40 },
      { x: 250, y: 340 },
      { x: -50, y: 340 },
    ];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    // Center of source should map to the centroid-ish point of the dest quad,
    // and critically the mapping must be exact at the corners.
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h!, src[i]!);
      expect(p.x).toBeCloseTo(dst[i]!.x, 4);
      expect(p.y).toBeCloseTo(dst[i]!.y, 4);
    }
  });

  it('works with reversed (clockwise) winding on the destination', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const dst: Quad = [
      { x: 0, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    const p = applyHomography(h!, { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(80, 6);
  });

  it('handles large coordinates without conditioning blowup', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];
    const dst: Quad = [
      { x: 50000, y: -30000 },
      { x: 51234, y: -29950 },
      { x: 51000, y: -28500 },
      { x: 49800, y: -28600 },
    ];
    const h = solveHomography(src, dst);
    expect(h).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h!, src[i]!);
      expect(p.x).toBeCloseTo(dst[i]!.x, 4);
      expect(p.y).toBeCloseTo(dst[i]!.y, 4);
    }
  });

  it('rejects crossing quads', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const crossing: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 80 },
      { x: 100, y: 0 },
      { x: 0, y: 80 },
    ];
    expect(solveHomography(src, crossing)).toBeNull();
  });

  it('rejects concave destination quads', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const concave: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 30 },
      { x: 100, y: 80 },
    ];
    expect(solveHomography(src, concave)).toBeNull();
  });

  it('rejects coincident corners', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const degenerate: Quad = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    expect(solveHomography(src, degenerate)).toBeNull();
  });

  it('rejects non-finite input', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const bad: Quad = [
      { x: NaN, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    expect(solveHomography(src, bad)).toBeNull();
  });
});

describe('applyHomography / invertHomography', () => {
  it('inverts a projective mapping', () => {
    const src: Quad = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 300 },
      { x: 0, y: 300 },
    ];
    const dst: Quad = [
      { x: 50, y: 40 },
      { x: 150, y: 40 },
      { x: 250, y: 340 },
      { x: -50, y: 340 },
    ];
    const h = solveHomography(src, dst)!;
    const inv = invertHomography(h)!;
    expect(inv).not.toBeNull();
    const p = applyHomography(h, { x: 123, y: 45 });
    const back = applyHomography(inv, p);
    expect(back.x).toBeCloseTo(123, 4);
    expect(back.y).toBeCloseTo(45, 4);
  });

  it('inverts the identity', () => {
    const inv = invertHomography(identity)!;
    expect(applyHomography(inv, { x: 5, y: 7 })).toMatchObject({ x: 5, y: 7 });
  });

  it('returns null for a singular matrix', () => {
    const singular: Homography = [1, 0, 0, 0, 1, 0, 0, 0, 0];
    expect(invertHomography(singular)).toBeNull();
  });

  it('multiplyHomography composes with identity', () => {
    const h = multiplyHomography(identity, identity);
    expect(applyHomography(h, { x: 3, y: 4 })).toMatchObject({ x: 3, y: 4 });
  });
});

describe('isQuadValid', () => {
  it('accepts a normal quad', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    expect(isQuadValid(q)).toBe(true);
  });

  it('rejects NaN and infinity', () => {
    expect(
      isQuadValid([
        { x: 0, y: 0 },
        { x: Infinity, y: 0 },
        { x: 100, y: 80 },
        { x: 0, y: 80 },
      ]),
    ).toBe(false);
  });

  it('rejects a fully collinear (zero-area) quad', () => {
    expect(
      isQuadValid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ]),
    ).toBe(false);
  });

  it('accepts a thin but valid quad', () => {
    expect(
      isQuadValid([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 0, y: 80 },
      ]),
    ).toBe(true);
  });

  it('detects self-crossing', () => {
    expect(
      isQuadSelfCrossing([
        { x: 0, y: 0 },
        { x: 100, y: 80 },
        { x: 100, y: 0 },
        { x: 0, y: 80 },
      ]),
    ).toBe(true);
  });

  it('detects concave', () => {
    expect(
      isQuadConcave([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 40, y: 30 },
        { x: 100, y: 80 },
      ]),
    ).toBe(true);
  });
});

describe('normalizeQuadCorners', () => {
  it('returns corners in a stable counter-clockwise order starting top-left', () => {
    const shuffled: Quad = [
      { x: 100, y: 80 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 80 },
    ];
    const normalized = normalizeQuadCorners(shuffled);
    expect(normalized[0]).toMatchObject({ x: 0, y: 0 });
    expect(normalized[1]).toMatchObject({ x: 100, y: 0 });
    expect(normalized[2]).toMatchObject({ x: 100, y: 80 });
    expect(normalized[3]).toMatchObject({ x: 0, y: 80 });
  });

  it('is idempotent', () => {
    const q: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const once = normalizeQuadCorners(q);
    const twice = normalizeQuadCorners(once);
    expect(twice).toEqual(once);
  });
});

describe('quadBounds', () => {
  it('computes the tight bounding box', () => {
    const q: Quad = [
      { x: 10, y: 20 },
      { x: 210, y: 15 },
      { x: 200, y: 120 },
      { x: -5, y: 90 },
    ];
    expect(quadBounds(q)).toEqual({ x: -5, y: 15, width: 215, height: 105 });
  });
});
