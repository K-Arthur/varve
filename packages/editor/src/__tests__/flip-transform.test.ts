/**
 * Flip transform tests — verify H/V flip preserves object centre.
 *
 * The flip operation negates a scale axis in the local→parent affine while
 * adjusting the translation so the visual centre stays fixed.
 */
import type { Affine } from '@strata/shared';
import { describe, expect, it } from 'vitest';

// ── Helper ──────────────────────────────────────────────────────────────────
function applyAffine(m: Affine, p: [number, number]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/**
 * Flip H — the same logic used in context.tsx setSelectedFlipH.
 * Negate X-basis and adjust translation to preserve world centre.
 */
function flipH(
  transform: Affine,
  localBounds: { x: number; y: number; w: number; h: number },
): Affine {
  const [a, b, c, d, e, f] = transform;
  const lcx = localBounds.x + localBounds.w / 2;
  return [-a, -b, c, d, e + 2 * a * lcx, f + 2 * b * lcx];
}

/**
 * Flip V — the same logic used in context.tsx setSelectedFlipV.
 * Negate Y-basis and adjust translation to preserve world centre.
 */
function flipV(
  transform: Affine,
  localBounds: { x: number; y: number; w: number; h: number },
): Affine {
  const [a, b, c, d, e, f] = transform;
  const lcy = localBounds.y + localBounds.h / 2;
  return [a, b, -c, -d, e + 2 * c * lcy, f + 2 * d * lcy];
}

/** Compute the world centre of a node: worldTransform applied to local centre. */
function worldCenter(
  t: Affine,
  lb: { x: number; y: number; w: number; h: number },
): [number, number] {
  return applyAffine(t, [lb.x + lb.w / 2, lb.y + lb.h / 2]);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('flipH preserves centre', () => {
  const lb = { x: 0, y: 0, w: 100, h: 100 };

  it('non-rotated at origin', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const before = worldCenter(t, lb);
    const flipped = flipH(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('non-rotated offset position', () => {
    const t: Affine = [2, 0, 0, 3, 200, 300];
    const before = worldCenter(t, lb);
    const flipped = flipH(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('rotated 45 degrees', () => {
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    const t: Affine = [cos45, sin45, -sin45, cos45, 100, 200];
    const before = worldCenter(t, lb);
    const flipped = flipH(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('double flip returns to original position', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const once = flipH(t, lb);
    const twice = flipH(once, lb);
    // Position should be back to original
    expect(twice[4]).toBeCloseTo(t[4], 10);
    expect(twice[5]).toBeCloseTo(t[5], 10);
    // Scale should be back to original sign
    expect(twice[0]).toBeCloseTo(t[0], 10);
    expect(twice[1]).toBeCloseTo(t[1], 10);
  });

  it('preserves Y-basis (no vertical shift)', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const flipped = flipH(t, lb);
    expect(flipped[2]).toBe(t[2]);
    expect(flipped[3]).toBe(t[3]);
    expect(flipped[5]).toBe(t[5]);
  });
});

describe('flipV preserves centre', () => {
  const lb = { x: 0, y: 0, w: 100, h: 100 };

  it('non-rotated at origin', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const before = worldCenter(t, lb);
    const flipped = flipV(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('non-rotated offset position', () => {
    const t: Affine = [2, 0, 0, 3, 200, 300];
    const before = worldCenter(t, lb);
    const flipped = flipV(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('rotated 45 degrees', () => {
    const cos45 = Math.SQRT1_2;
    const sin45 = Math.SQRT1_2;
    const t: Affine = [cos45, sin45, -sin45, cos45, 100, 200];
    const before = worldCenter(t, lb);
    const flipped = flipV(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('double flip returns to original position', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const once = flipV(t, lb);
    const twice = flipV(once, lb);
    expect(twice[4]).toBeCloseTo(t[4], 10);
    expect(twice[5]).toBeCloseTo(t[5], 10);
    expect(twice[2]).toBeCloseTo(t[2], 10);
    expect(twice[3]).toBeCloseTo(t[3], 10);
  });

  it('preserves X-basis (no horizontal shift)', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const flipped = flipV(t, lb);
    expect(flipped[0]).toBe(t[0]);
    expect(flipped[1]).toBe(t[1]);
    expect(flipped[4]).toBe(t[4]);
  });
});

describe('flipH + flipV equivalence', () => {
  const lb = { x: 0, y: 0, w: 100, h: 100 };

  it('H then V preserves centre', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const before = worldCenter(t, lb);
    const hFlipped = flipH(t, lb);
    const hvFlipped = flipV(hFlipped, lb);
    const after = worldCenter(hvFlipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('V then H preserves centre', () => {
    const t: Affine = [1, 0, 0, 1, 50, 50];
    const before = worldCenter(t, lb);
    const vFlipped = flipV(t, lb);
    const vhFlipped = flipH(vFlipped, lb);
    const after = worldCenter(vhFlipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });
});

describe('flip with non-zero local bounds offset', () => {
  it('local rect at (10, 20, 50, 30) — centre is (35, 35)', () => {
    const lb = { x: 10, y: 20, w: 50, h: 30 };
    const t: Affine = [1, 0, 0, 1, 100, 200];
    const before = worldCenter(t, lb);
    const flipped = flipH(t, lb);
    const after = worldCenter(flipped, lb);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });
});
