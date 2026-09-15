/**
 * LOD selection: effective device-space scale, ideal level, hysteresis
 * behaviour around level boundaries (brief §6-7), and clamping.
 */
import { describe, expect, it } from 'vitest';
import { clampLod, effectiveDeviceScale, idealLod, selectLod } from './lod';

describe('effectiveDeviceScale', () => {
  it('accounts for zoom, DPR, and node transform', () => {
    expect(effectiveDeviceScale(1, 1, 1, 1)).toBe(1);
    expect(effectiveDeviceScale(0.5, 1, 1, 1)).toBe(0.5);
    expect(effectiveDeviceScale(1, 2, 1, 1)).toBe(2); // Retina: 1 CSS px = 2 device px
    expect(effectiveDeviceScale(0.25, 2, 1, 1)).toBe(0.5);
    expect(effectiveDeviceScale(1, 1, 4, 4)).toBe(4);
  });

  it('uses the max axis under non-uniform scale (never undersamples)', () => {
    expect(effectiveDeviceScale(1, 1, 0.5, 4)).toBe(4);
    expect(effectiveDeviceScale(1, 1, -2, -2)).toBe(2); // negative/flipped scale
  });

  it('is non-negative for degenerate inputs', () => {
    expect(effectiveDeviceScale(0, 1, 1, 1)).toBe(0);
    expect(effectiveDeviceScale(1, 1, 0, 0)).toBe(0);
  });
});

describe('idealLod', () => {
  it('one texel per device pixel', () => {
    expect(idealLod(1, 14)).toBe(0); // 100%
    expect(idealLod(2, 14)).toBe(0); // 200% clamps at L0
    expect(idealLod(0.5, 14)).toBe(1); // 50%
    expect(idealLod(0.125, 14)).toBe(3); // 12.5%
    expect(idealLod(0.0625, 14)).toBe(4); // 6.25%
    expect(idealLod(0.01, 14)).toBe(7); // 1%
    expect(idealLod(0.03125, 14)).toBe(5); // 3.125%
  });

  it('clamps to available levels', () => {
    expect(idealLod(0.001, 4)).toBe(4);
    expect(idealLod(1000, 0)).toBe(0);
  });

  it('retina zoom-in does not oversample display pixels', () => {
    // DPR 2 at 50% zoom: source px = 1 device px -> L0, not L1.
    expect(idealLod(effectiveDeviceScale(0.5, 2, 1, 1), 14)).toBe(0);
  });
});

describe('selectLod hysteresis', () => {
  it('steps one level at a time', () => {
    let level: number | null = null;
    for (const scale of [1, 0.5, 0.25, 0.125, 0.0625]) {
      level = selectLod(scale, level, 14);
    }
    expect(level).toBe(4);
  });

  it('does not thrash around a level boundary', () => {
    // Boundary between L3 and L4 sits at scale 1/8 = 0.125 (f = -log2 = 3).
    // Oscillating f between 3.2 and 3.8 must not flip the level.
    let level = 3;
    for (let i = 0; i < 40; i++) {
      const f = i % 2 === 0 ? 3.2 : 3.8;
      const scale = 2 ** -f;
      level = selectLod(scale, level, 14);
    }
    expect(level).toBe(3);
  });

  it('locks in the level once zoomed past the boundary', () => {
    // Slow zoom-in: f 3.2 -> 3.8 stays L3, 4.2 switches to L4, then stays.
    let level = 3;
    level = selectLod(2 ** -3.2, level, 14);
    expect(level).toBe(3);
    level = selectLod(2 ** -3.8, level, 14);
    expect(level).toBe(3);
    level = selectLod(2 ** -4.2, level, 14);
    expect(level).toBe(4);
    level = selectLod(2 ** -4.4, level, 14);
    expect(level).toBe(4);
    level = selectLod(2 ** -4.1, level, 14);
    expect(level).toBe(4);
  });

  it('zooming back out requires crossing the other side of the dead zone', () => {
    let level = 4;
    level = selectLod(2 ** -3.9, level, 14);
    expect(level).toBe(4); // still inside [3.0, 4.0] dead zone for L4
    level = selectLod(2 ** -3.1, level, 14);
    expect(level).toBe(4);
    level = selectLod(2 ** -2.9, level, 14);
    expect(level).toBe(3);
  });

  it('fast zooms step toward the ideal one level at a time', () => {
    let level = 1;
    for (let i = 0; i < 6; i++) {
      level = selectLod(2 ** -6, level, 14);
    }
    expect(level).toBe(6);
  });

  it('respects maxLevel bounds', () => {
    let level = 0;
    for (let i = 0; i < 8; i++) {
      level = selectLod(2 ** -30, level, 4);
    }
    expect(level).toBe(4);
    for (let i = 0; i < 8; i++) {
      level = selectLod(2 ** 30, level, 4);
    }
    expect(level).toBe(0);
  });
});

describe('clampLod', () => {
  it('clamps both directions', () => {
    expect(clampLod(-1, 4)).toBe(0);
    expect(clampLod(5, 4)).toBe(4);
    expect(clampLod(2, 4)).toBe(2);
  });
});
