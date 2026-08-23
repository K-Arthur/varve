import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  isQuadValid,
  solveHomography,
  type Quad,
  type Vec2,
} from '../mockup/homography';

/**
 * Geometry the image-node perspective renderer depends on. The default
 * (identity) quad must reproduce the original framing exactly; a known
 * trapezoid must map the source rectangle's corners onto its own corners
 * under the canonical homography solver.
 */

function srcRect(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}

function approx(a: Vec2, b: Vec2, tol = 1e-6): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;
}

describe('perspective homography — default (identity) quad', () => {
  it('maps source corners onto themselves (no distortion)', () => {
    const w = 120;
    const h = 80;
    const quad: Quad = srcRect(w, h);
    expect(isQuadValid(quad)).toBe(true);
    const H = solveHomography(srcRect(w, h), quad);
    expect(H).not.toBeNull();
    if (!H) return;
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(H, { x: quad[i]!.x, y: quad[i]!.y });
      expect(approx(mapped, quad[i]!, 1e-4)).toBe(true);
    }
  });
});

describe('perspective homography — trapezoid quad', () => {
  it('maps source corners onto the destination quad corners', () => {
    const w = 100;
    const h = 100;
    const dst: Quad = [
      { x: 10, y: 0 },
      { x: 90, y: 0 },
      { x: 120, y: 100 },
      { x: -20, y: 100 },
    ];
    expect(isQuadValid(dst)).toBe(true);
    const H = solveHomography(srcRect(w, h), dst);
    expect(H).not.toBeNull();
    if (!H) return;
    for (let i = 0; i < 4; i++) {
      const mapped = applyHomography(H, { x: srcRect(w, h)[i]!.x, y: srcRect(w, h)[i]!.y });
      expect(approx(mapped, dst[i]!, 1e-4)).toBe(true);
    }
  });

  it('rejects a degenerate (crossed) destination quad', () => {
    const crossed: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(isQuadValid(crossed)).toBe(false);
    expect(solveHomography(srcRect(100, 100), crossed)).toBeNull();
  });

  it('rejects non-finite and pathological coordinates before solving', () => {
    expect(
      isQuadValid([
        { x: 0, y: 0 },
        { x: Number.POSITIVE_INFINITY, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]),
    ).toBe(false);
    expect(
      solveHomography(srcRect(100, 100), [
        { x: 0, y: 0 },
        { x: 1e10, y: 0 },
        { x: 1e10, y: 100 },
        { x: 0, y: 100 },
      ]),
    ).toBeNull();
  });
});
