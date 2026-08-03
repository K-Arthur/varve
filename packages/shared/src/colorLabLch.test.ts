import { describe, expect, it } from 'vitest';
import {
  labToLch,
  labToRgb,
  lchToLab,
  lchToRgb,
  managedColorKey,
  managedColorToRgba,
  normalizeHueDegrees,
  rgbToLab,
  rgbToLch,
  roundTo,
} from './colorConversion';

describe('rgbToLab / labToRgb', () => {
  it('round-trips neutral colors within tolerance', () => {
    for (const v of [0, 51, 128, 200, 255]) {
      const lab = rgbToLab(v, v, v);
      const [r, g, b] = labToRgb(lab[0], lab[1], lab[2]);
      expect(Math.abs(r - v)).toBeLessThanOrEqual(1);
      expect(Math.abs(g - v)).toBeLessThanOrEqual(1);
      expect(Math.abs(b - v)).toBeLessThanOrEqual(1);
    }
  });

  it('round-trips saturated colors within tolerance', () => {
    const samples: [number, number, number][] = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
      [128, 64, 192],
    ];
    for (const [sr, sg, sb] of samples) {
      const lab = rgbToLab(sr, sg, sb);
      const [r, g, b] = labToRgb(lab[0], lab[1], lab[2]);
      expect(Math.abs(r - sr)).toBeLessThanOrEqual(2);
      expect(Math.abs(g - sg)).toBeLessThanOrEqual(2);
      expect(Math.abs(b - sb)).toBeLessThanOrEqual(2);
    }
  });

  it('produces finite values for all valid inputs', () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 51) {
        for (let b = 0; b <= 255; b += 51) {
          const lab = rgbToLab(r, g, b);
          expect(lab.every((v) => Number.isFinite(v))).toBe(true);
          const [rr, gg, bb] = labToRgb(lab[0], lab[1], lab[2]);
          expect([rr, gg, bb].every((v) => Number.isFinite(v))).toBe(true);
        }
      }
    }
  });
});

describe('labToLch / lchToLab', () => {
  it('round-trips within tolerance', () => {
    const samples: [number, number, number][] = [
      [50, 20, 30],
      [20, -30, 10],
      [80, 0, -50],
      [10, 100, -80],
      [50, -40, -40],
    ];
    for (const lab of samples) {
      const lch = labToLch(lab);
      const back = lchToLab(lch);
      expect(Math.abs(back[0] - lab[0])).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(back[1] - lab[1])).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(back[2] - lab[2])).toBeLessThanOrEqual(1e-9);
    }
  });

  it('normalizes hue into [0, 360)', () => {
    expect(labToLch([50, 0, 20])[2]).toBeGreaterThanOrEqual(0);
    expect(labToLch([50, 0, 20])[2]).toBeLessThan(360);
  });

  it('treats achromatic colors with hue 0', () => {
    const lch = labToLch([50, 0, 0]);
    expect(lch[1]).toBeLessThan(1e-12);
    expect(lch[2]).toBe(0);
  });

  it('rejects negative chroma by normalization', () => {
    const [_l, a, b] = lchToLab([50, -20, 120]);
    expect(Math.sqrt(a * a + b * b)).toBeCloseTo(20, 9);
  });
});

describe('normalizeHueDegrees', () => {
  it('wraps and handles non-finite input', () => {
    expect(normalizeHueDegrees(370)).toBe(10);
    expect(normalizeHueDegrees(-30)).toBe(330);
    expect(normalizeHueDegrees(NaN)).toBe(0);
  });
});

describe('managedColorToRgba for new variants', () => {
  it('converts lab to a clamped rgb preview', () => {
    const lab = rgbToLab(255, 0, 0);
    const [r, g, b, a] = managedColorToRgba({
      space: 'lab',
      l: lab[0],
      av: lab[1],
      b: lab[2],
      a: 255,
    });
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(15);
    expect(b).toBeLessThan(15);
    expect(a).toBe(255);
  });

  it('converts lch with hue degrees', () => {
    const [r, g, b] = managedColorToRgba({
      space: 'lch',
      l: 50,
      c: 20,
      h: 30,
      a: 255,
    });
    expect([r, g, b].every((v) => v >= 0 && v <= 255)).toBe(true);
  });

  it('renders registration as black', () => {
    expect(managedColorToRgba({ space: 'registration', a: 128 })).toEqual([0, 0, 0, 128]);
  });

  it('uses unresolved fallback for display', () => {
    expect(
      managedColorToRgba({
        space: 'unresolved',
        source: 'SomeICCTag',
        fallback: { r: 10, g: 20, b: 30 },
        a: 255,
      }),
    ).toEqual([10, 20, 30, 255]);
  });

  it('falls back to parsing css source for unresolved colors', () => {
    expect(managedColorToRgba({ space: 'unresolved', source: '#ff8800', a: 255 })).toEqual([
      255, 136, 0, 255,
    ]);
  });

  it('keeps alpha bit-depth scaled for lab/lch', () => {
    const [, , , a] = managedColorToRgba({
      space: 'lab',
      l: 50,
      av: 0,
      b: 0,
      a: 32768,
      bitDepth: 'uint16',
    });
    expect(a).toBe(128);
  });
});

describe('managedColorKey for new variants', () => {
  it('is stable and distinct per variant', () => {
    const lab = { space: 'lab' as const, l: 50, av: 10, b: 20, a: 255 };
    const lab2 = { space: 'lab' as const, l: 50, av: 11, b: 20, a: 255 };
    const lch = { space: 'lch' as const, l: 50, c: 10, h: 20, a: 255 };
    expect(managedColorKey(lab)).toBe(managedColorKey({ ...lab }));
    expect(managedColorKey(lab)).not.toBe(managedColorKey(lab2));
    expect(managedColorKey(lab)).not.toBe(managedColorKey(lch));
    expect(managedColorKey({ space: 'registration' as const, a: 255 })).toBe('registration:255');
    expect(managedColorKey({ space: 'unresolved' as const, source: 'x', a: 255 })).not.toBe(
      managedColorKey({ space: 'unresolved' as const, source: 'y', a: 255 }),
    );
  });

  it('distinguishes spot identity by spotId before name', () => {
    const a = { space: 'spot' as const, spotId: 's1', name: 'Ink', tint: 100, a: 255 };
    const b = { space: 'spot' as const, spotId: 's2', name: 'Ink', tint: 100, a: 255 };
    expect(managedColorKey(a)).not.toBe(managedColorKey(b));
  });
});

describe('roundTo', () => {
  it('rounds deterministically', () => {
    expect(roundTo(1.23456, 3)).toBe(1.235);
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(-0.005, 2)).toBe(-0.01);
  });
});

describe('rgbToLch / lchToRgb', () => {
  it('round-trips within tolerance', () => {
    const lch = rgbToLch(200, 100, 50);
    const [r, g, b] = lchToRgb(lch[0], lch[1], lch[2]);
    expect(Math.abs(r - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - 100)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 50)).toBeLessThanOrEqual(2);
  });
});
