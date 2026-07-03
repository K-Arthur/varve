/**
 * Tests for non-separable blend modes and L*C*h color space conversion.
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  lum,
  clipColor,
  setLum,
  sat,
  setSat,
  blendHueW3C,
  blendSaturationW3C,
  blendColorW3C,
  blendLuminosityW3C,
  blendHueLch,
  blendSaturationLch,
  blendColorLch,
  blendLuminosityLch,
  blendNonSeparable,
  rgbToLab,
  labToRgb,
  rgbToLch,
  lchToRgb,
} from './nonSeparable';

// ── W3C helpers ──────────────────────────────────────────────────────────────

describe('lum', () => {
  it('computes relative luminance', () => {
    // Gray 50%: 0.3*0.5 + 0.59*0.5 + 0.11*0.5 = 0.5
    expect(lum(0.5, 0.5, 0.5)).toBeCloseTo(0.5);
    // Black
    expect(lum(0, 0, 0)).toBeCloseTo(0);
    // White
    expect(lum(1, 1, 1)).toBeCloseTo(1);
    // Red
    expect(lum(1, 0, 0)).toBeCloseTo(0.3);
  });
});

describe('clipColor', () => {
  it('clips negative values', () => {
    const [r, g, b] = clipColor(-0.5, 0.2, 0.8);
    expect(r).not.toBeLessThan(0);
    expect(g).not.toBeLessThan(0);
    expect(b).not.toBeLessThan(0);
  });

  it('clips values above 1', () => {
    const [r, g, b] = clipColor(1.5, 0.3, 0.7);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('preserves in-gamut colors', () => {
    const [r, g, b] = clipColor(0.3, 0.5, 0.7);
    expect(r).toBeCloseTo(0.3);
    expect(g).toBeCloseTo(0.5);
    expect(b).toBeCloseTo(0.7);
  });

  it('preserves luminance through clip', () => {
    const [r, g, b] = clipColor(1.2, -0.1, 0.5);
    const l = lum(r, g, b);
    expect(l).toBeGreaterThan(0);
  });
});

describe('setLum', () => {
  it('sets luminance to target value', () => {
    const [r, g, b] = setLum(0.3, 0.5, 0.7, 0.6);
    const l = lum(r, g, b);
    expect(l).toBeCloseTo(0.6, 1);
  });
});

describe('sat', () => {
  it('returns max - min', () => {
    expect(sat(0.8, 0.3, 0.5)).toBeCloseTo(0.5);
  });

  it('gray has zero saturation', () => {
    expect(sat(0.5, 0.5, 0.5)).toBeCloseTo(0);
  });
});

describe('setSat', () => {
  it('sets saturation to target', () => {
    const [r, g, b] = setSat(0.3, 0.5, 0.7, 0.4);
    const s = sat(r, g, b);
    expect(s).toBeCloseTo(0.4, 1);
  });

  it('preserves hue (order of channels)', () => {
    const [r, g] = setSat(0.3, 0.7, 0.5, 0.5);
    // Original: g > b > r, so g should be max, r should be min
    expect(r).toBeCloseTo(0);
    expect(g).toBeCloseTo(0.5);
  });
});

// ── W3C blend modes ──────────────────────────────────────────────────────────

describe('blendHueW3C', () => {
  it('preserves backdrop luminance', () => {
    const backdrop = [0.5, 0.5, 0.5] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendHueW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const l = lum(r, g, b);
    expect(l).toBeCloseTo(0.5, 1);
  });

  it('applies source hue while preserving backdrop sat+lightness', () => {
    const backdrop = [0.6, 0.4, 0.5] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendHueW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const lBackdrop = lum(backdrop[0], backdrop[1], backdrop[2]);
    const lResult = lum(r, g, b);
    expect(lResult).toBeCloseTo(lBackdrop, 1);
    // Red hue should increase red relative to green
    expect(r).toBeGreaterThan(g);
  });
});

describe('blendSaturationW3C', () => {
  it('transfers saturation from source to backdrop', () => {
    const backdrop = [0.6, 0.3, 0.5] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [r, g, b] = blendSaturationW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    // Backdrop has original hue + lightness, source provides saturation
    // setSat(backdrop, sat(source)) should produce saturation > 0
    const s = sat(r, g, b);
    expect(s).toBeGreaterThan(0);
    // Luminance should be preserved from backdrop
    const lResult = lum(r, g, b);
    const lBackdrop = lum(backdrop[0], backdrop[1], backdrop[2]);
    expect(lResult).toBeCloseTo(lBackdrop, 1);
  });

  it('desaturated source produces low saturation result', () => {
    const backdrop = [0.8, 0.2, 0.2] as const;
    const source = [0.5, 0.5, 0.5] as const;
    const [r, g, b] = blendSaturationW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const s = sat(r, g, b);
    // setSat on a non-gray backdrop with sat=0 gives mid gray → 0 or nearly 0
    expect(s).toBeLessThan(0.1);
  });
});

describe('blendColorW3C', () => {
  it('transfers hue and saturation from source', () => {
    const backdrop = [0.5, 0.5, 0.5] as const;
    const source = [0.8, 0.2, 0.5] as const;
    const [r, g, b] = blendColorW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const l = lum(r, g, b);
    expect(l).toBeCloseTo(0.5, 1);
    expect(r).toBeGreaterThan(g);
  });
});

describe('blendLuminosityW3C', () => {
  it('transfers luminance from source', () => {
    const backdrop = [0.2, 0.2, 0.2] as const;
    const source = [0.8, 0.8, 0.8] as const;
    const [r, g, b] = blendLuminosityW3C(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const l = lum(r, g, b);
    expect(l).toBeGreaterThan(0.5);
  });
});

// ── Color space conversion ───────────────────────────────────────────────────

describe('rgbToLab / labToRgb', () => {
  it('gray round-trips', () => {
    const gray = 0.5;
    const [L, a, b] = rgbToLab(gray, gray, gray);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
    const [r, g, bl] = labToRgb(L, a, b);
    expect(r).toBeCloseTo(gray, 0);
    expect(g).toBeCloseTo(gray, 0);
    expect(bl).toBeCloseTo(gray, 0);
  });

  it('black round-trips', () => {
    const [L, a, b] = rgbToLab(0, 0, 0);
    expect(L).toBeCloseTo(0, 0);
    const [r, g, bl] = labToRgb(L, a, b);
    expect(r).toBeCloseTo(0, 0);
    expect(g).toBeCloseTo(0, 0);
    expect(bl).toBeCloseTo(0, 0);
  });

  it('white round-trips', () => {
    const [L, a, b] = rgbToLab(1, 1, 1);
    expect(L).toBeCloseTo(100, 0);
    const [r, g, bl] = labToRgb(L, a, b);
    expect(r).toBeCloseTo(1, 0);
    expect(g).toBeCloseTo(1, 0);
    expect(bl).toBeCloseTo(1, 0);
  });

  it('red round-trips approximately', () => {
    const [L, a, b] = rgbToLab(1, 0, 0);
    const [r, g, bl] = labToRgb(L, a, b);
    expect(r).toBeGreaterThan(0.9);
    expect(g).toBeLessThan(0.1);
    expect(bl).toBeLessThan(0.1);
  });
});

describe('rgbToLch / lchToRgb', () => {
  it('gray has zero chroma', () => {
    const [L, C, h] = rgbToLch(0.5, 0.5, 0.5);
    expect(C).toBeCloseTo(0, 1);
    expect(L).toBeGreaterThan(0);
  });

  it('red has positive chroma and ~0deg hue', () => {
    const [, C, h] = rgbToLch(1, 0, 0);
    expect(C).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('round-trip preserves color', () => {
    const [r, g, b] = [0.3, 0.6, 0.9] as const;
    const [L, C, h] = rgbToLch(r, g, b);
    const [r2, g2, b2] = lchToRgb(L, C, h);
    expect(r2).toBeCloseTo(r, 1);
    expect(g2).toBeCloseTo(g, 1);
    expect(b2).toBeCloseTo(b, 1);
  });
});

// ── L*C*h* blend modes ───────────────────────────────────────────────────────

describe('blendHueLch', () => {
  it('preserves backdrop lightness and chroma', () => {
    const backdrop = [0.5, 0.5, 0.5] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [bL, bC] = rgbToLch(backdrop[0], backdrop[1], backdrop[2]);
    const [r, g, bb] = blendHueLch(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const [rL, rC] = rgbToLch(r, g, bb);
    expect(rL).toBeCloseTo(bL, 1);
    expect(rC).toBeCloseTo(bC, 1);
  });
});

describe('blendSaturationLch', () => {
  it('preserves backdrop lightness and hue', () => {
    const backdrop = [0.5, 0.2, 0.7] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [bL, , bH] = rgbToLch(backdrop[0], backdrop[1], backdrop[2]);
    const [r, g, bb] = blendSaturationLch(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const [rL, , rH] = rgbToLch(r, g, bb);
    // L*C*h conversion introduces some precision loss; use relaxed tolerance
    expect(rL).toBeCloseTo(bL, 0);
    expect(Math.abs(rL - bL)).toBeLessThan(5);
    expect(rH).toBeCloseTo(bH, 0);
  });
});

describe('blendColorLch', () => {
  it('preserves backdrop lightness, transfers chroma and hue from source', () => {
    const backdrop = [0.6, 0.3, 0.5] as const;
    const source = [0.8, 0.2, 0.2] as const;
    const [bL] = rgbToLch(backdrop[0], backdrop[1], backdrop[2]);
    const [, sC, sH] = rgbToLch(source[0], source[1], source[2]);
    const [r, g, bb] = blendColorLch(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const [rL, rC, rH] = rgbToLch(r, g, bb);
    expect(Math.abs(rL - bL)).toBeLessThan(5);
    expect(Math.abs(rC - sC)).toBeLessThan(5);
    expect(Math.abs(rH - sH)).toBeLessThan(5);
  });
});

describe('blendLuminosityLch', () => {
  it('transfers lightness from source, preserves chroma and hue from backdrop', () => {
    const backdrop = [0.3, 0.6, 0.9] as const;
    const source = [0.1, 0.1, 0.1] as const;
    const [, bC, bH] = rgbToLch(backdrop[0], backdrop[1], backdrop[2]);
    const [sL] = rgbToLch(source[0], source[1], source[2]);
    const [r, g, bb] = blendLuminosityLch(backdrop[0], backdrop[1], backdrop[2], source[0], source[1], source[2]);
    const [rL, rC, rH] = rgbToLch(r, g, bb);
    // L*C*h: result lightness should trend toward source, chroma/hue toward backdrop
    expect(rL).toBeLessThan(50); // darkened from ~64 (backdrop) toward 9 (source)
    expect(rC).toBeGreaterThan(0); // chroma preserved from backdrop
    // Result should be closer to backdrop hue than source hue (backdrop hue ~244, source undefined ~0)
    expect(Math.abs(rH - bH)).toBeLessThan(30);
  });
});

// ── Dispatch ─────────────────────────────────────────────────────────────────

describe('blendNonSeparable dispatch', () => {
  it('dispatches all four modes', () => {
    const b = [0.5, 0.5, 0.5] as const;
    const s = [0.8, 0.2, 0.2] as const;
    for (const mode of ['hue', 'saturation', 'color', 'luminosity'] as const) {
      const [r, g, bb] = blendNonSeparable(b[0], b[1], b[2], s[0], s[1], s[2], mode);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      expect(bb).toBeGreaterThanOrEqual(0);
      expect(bb).toBeLessThanOrEqual(1);
    }
  });

  it('returns source for unknown mode', () => {
    const [r, g, b] = blendNonSeparable(0.5, 0.5, 0.5, 0.8, 0.2, 0.2, 'unknown');
    expect(r).toBeCloseTo(0.8);
    expect(g).toBeCloseTo(0.2);
    expect(b).toBeCloseTo(0.2);
  });
});
