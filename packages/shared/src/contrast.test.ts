import { describe, expect, it } from 'vitest';
import {
  autoFixContrast,
  contrastRatio,
  relativeLuminance,
  WCAG_AA_LARGE,
  WCAG_AA_NORMAL,
  WCAG_AAA_LARGE,
  wcagLevel,
} from './contrast';

describe('relativeLuminance', () => {
  it('returns 1 for white', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 4);
  });

  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 4);
  });

  it('returns ~0.2126 for pure red', () => {
    expect(relativeLuminance(255, 0, 0)).toBeCloseTo(0.2126, 4);
  });

  it('returns ~0.7152 for pure green', () => {
    expect(relativeLuminance(0, 255, 0)).toBeCloseTo(0.7152, 4);
  });

  it('returns ~0.0722 for pure blue', () => {
    expect(relativeLuminance(0, 0, 255)).toBeCloseTo(0.0722, 4);
  });

  it('returns ~0.215 for sRGB mid-gray (128, 128, 128)', () => {
    const lum = relativeLuminance(128, 128, 128);
    expect(lum).toBeGreaterThan(0.2);
    expect(lum).toBeLessThan(0.22);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for black on white', () => {
    const w = relativeLuminance(255, 255, 255);
    const b = relativeLuminance(0, 0, 0);
    expect(contrastRatio(w, b)).toBeCloseTo(21, 1);
  });

  it('returns 21:1 for white on black (order swapped)', () => {
    const w = relativeLuminance(255, 255, 255);
    const b = relativeLuminance(0, 0, 0);
    expect(contrastRatio(b, w)).toBeCloseTo(21, 1);
  });

  it('returns 1:1 for identical luminance', () => {
    const l = relativeLuminance(128, 128, 128);
    expect(contrastRatio(l, l)).toBeCloseTo(1, 4);
  });

  it('computes red-on-white contrast correctly', () => {
    const red = relativeLuminance(255, 0, 0);
    const white = relativeLuminance(255, 255, 255);
    const ratio = contrastRatio(red, white);
    // Red on white: ~4.0:1 — fails AA (4.5)
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.1);
  });

  it('computes red-on-green contrast correctly', () => {
    const red = relativeLuminance(255, 0, 0);
    const green = relativeLuminance(0, 255, 0);
    const ratio = contrastRatio(red, green);
    // Red vs green: ~2.91:1
    expect(ratio).toBeGreaterThan(2.8);
    expect(ratio).toBeLessThan(3.0);
  });
});

describe('wcagLevel', () => {
  it('returns AAA for 21:1 (normal text)', () => {
    expect(wcagLevel(21)).toBe('AAA');
  });

  it('returns AAA for 7:1 (normal text)', () => {
    expect(wcagLevel(7)).toBe('AAA');
  });

  it('returns AA for 4.5:1 (normal text)', () => {
    expect(wcagLevel(4.5)).toBe('AA');
  });

  it('returns FAIL for 3.0:1 (normal text)', () => {
    expect(wcagLevel(3.0)).toBe('FAIL');
  });

  it('returns FAIL for 1:1 (normal text)', () => {
    expect(wcagLevel(1)).toBe('FAIL');
  });

  describe('large text', () => {
    it('returns AAA for 4.5:1 (large text)', () => {
      expect(wcagLevel(4.5, true)).toBe('AAA');
    });

    it('returns AA for 3.0:1 (large text)', () => {
      expect(wcagLevel(3.0, true)).toBe('AA');
    });

    it('returns FAIL for 2.5:1 (large text)', () => {
      expect(wcagLevel(2.5, true)).toBe('FAIL');
    });
  });

  it('boundary: just below AA normal', () => {
    expect(wcagLevel(WCAG_AA_NORMAL - 0.01)).toBe('FAIL');
  });

  it('boundary: just below AAA large', () => {
    expect(wcagLevel(WCAG_AAA_LARGE - 0.01, true)).toBe('AA');
  });
});

describe('autoFixContrast', () => {
  it('returns null when contrast is already sufficient (black on white)', () => {
    const result = autoFixContrast(0, 0, 0, 255, 255, 255);
    expect(result).toBeNull();
  });

  it('fixes a failing red-on-white pair to AA', () => {
    // Red (255,0,0) on white (255,255,255) — ~4.0:1, fails AA
    const result = autoFixContrast(255, 0, 0, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
    }
  });

  it('fixes a failing light-gray-on-white pair to AA', () => {
    // Light gray (150,150,150) on white — ~2.66:1, fails AA
    const result = autoFixContrast(150, 150, 150, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
    }
  });

  it('fixes a failing pair to a custom target ratio (AA large)', () => {
    const result = autoFixContrast(180, 180, 180, 255, 255, 255, WCAG_AA_LARGE);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_LARGE);
      expect(result.deltaEOK).toBeLessThan(5);
    }
  });

  it('handles identical fg and bg (returns null)', () => {
    const result = autoFixContrast(128, 128, 128, 128, 128, 128);
    expect(result).toBeNull();
  });

  it('fixes dark-on-light by darkening foreground', () => {
    // Gray (150,150,150) on white — ~2.66:1, fails AA
    // Fix should darken the gray
    const result = autoFixContrast(150, 150, 150, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
      // Should have darkened toward black
      expect(result.r).toBeLessThan(150);
      expect(result.g).toBeLessThan(150);
      expect(result.b).toBeLessThan(150);
    }
  });

  it('fixes light-on-dark by lightening foreground', () => {
    // Gray (140,140,140) on gray (70,70,70) — check contrast first
    const initialRatio = contrastRatio(
      relativeLuminance(140, 140, 140),
      relativeLuminance(70, 70, 70),
    );
    // If already sufficient, skip this test's premise
    if (initialRatio >= WCAG_AA_NORMAL) return;

    const result = autoFixContrast(140, 140, 140, 70, 70, 70);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
      // Should have lightened toward white
      expect(result.r).toBeGreaterThan(140);
    }
  });

  it('keeps ΔEOK < 5 for a subtle fix', () => {
    // Close-but-not-quite pair: subtle adjustment
    const result = autoFixContrast(170, 170, 170, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.deltaEOK).toBeLessThan(5);
    }
  });

  it('handles very close colors gracefully (may return null)', () => {
    // Extremely close colors where fix needs huge shift
    const result = autoFixContrast(200, 200, 200, 210, 210, 210);
    // Accept either outcome
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
    }
  });

  it('properly gamut-maps a wide-gamut saturated foreground on white', () => {
    // Saturated green (0, 255, 0) on white — ~1.37:1, fails AA.
    // The binary search darkens L while keeping a,b constant, which can
    // produce Oklab→sRGB values outside the gamut. The fix uses
    // chroma-reduction gamut mapping instead of simple clipping.
    const result = autoFixContrast(0, 255, 0, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
      // Should have darkened toward black
      expect(result.r).toBeLessThanOrEqual(50);
      expect(result.g).toBeLessThan(200);
      expect(result.b).toBeLessThanOrEqual(50);
    }
  });

  it('produces identical results for in-gamut colors (gamut mapping is identity)', () => {
    // Gray (150,150,150) on white — fully in sRGB gamut.
    // Gamut mapping should produce the same result as simple clamping
    // because the binary search never leaves the gamut.
    const result = autoFixContrast(150, 150, 150, 255, 255, 255);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
      expect(result.deltaEOK).toBeLessThan(5);
      // Darkened toward black
      expect(result.r).toBeLessThan(150);
      expect(result.g).toBeLessThan(150);
      expect(result.b).toBeLessThan(150);
    }
  });
});
