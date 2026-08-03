import { describe, expect, it } from 'vitest';
import {
  cmykToRgb,
  deltaEOk,
  gamutMapToSrgb,
  labToXyz,
  linearRgbToRgb,
  linearRgbToXyzD65,
  linearSrgbToOklab,
  linearToSrgb,
  managedColorKey,
  managedColorToCss,
  managedColorToEngineColor,
  managedColorToRgba,
  oklabToLinearSrgb,
  rgbToCmyk,
  rgbToLinearRgb,
  srgbToLinear,
  xyzD65ToLinearRgb,
  xyzToLab,
} from './colorConversion';

// ── Basic sRGB gamma ─────────────────────────────────────────────────────────

describe('srgbToLinear', () => {
  it('converts sRGB 0 to linear 0', () => {
    expect(srgbToLinear(0)).toBe(0);
  });
  it('converts sRGB 255 to linear 1', () => {
    expect(srgbToLinear(255)).toBe(1);
  });
  it('converts sRGB 128 to linear ~0.216', () => {
    expect(srgbToLinear(128)).toBeCloseTo(0.216, 3);
  });
  it('converts sRGB 1 (very dark) to linear ~0.0003', () => {
    expect(srgbToLinear(1)).toBeCloseTo(0.0003, 4);
  });
});

describe('linearToSrgb', () => {
  it('converts linear 0 to sRGB 0', () => {
    expect(linearToSrgb(0)).toBe(0);
  });
  it('converts linear 1 to sRGB 255', () => {
    expect(linearToSrgb(1)).toBe(255);
  });
  it('converts linear ~0.217 to sRGB 128', () => {
    expect(linearToSrgb(0.217)).toBeCloseTo(128, 0);
  });
  it('round-trips with srgbToLinear', () => {
    expect(linearToSrgb(srgbToLinear(42))).toBe(42);
    expect(linearToSrgb(srgbToLinear(200))).toBe(200);
    expect(linearToSrgb(srgbToLinear(0))).toBe(0);
    expect(linearToSrgb(srgbToLinear(255))).toBe(255);
  });
});

describe('rgbToLinearRgb / linearRgbToRgb', () => {
  it('converts [255,0,0] to [1,0,0]', () => {
    const [r, g, b] = rgbToLinearRgb([255, 0, 0]);
    expect(r).toBe(1);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
  it('converts [255,255,255] to [1,1,1]', () => {
    const [r, g, b] = rgbToLinearRgb([255, 255, 255]);
    expect(r).toBe(1);
    expect(g).toBe(1);
    expect(b).toBe(1);
  });
  it('round-trips', () => {
    const roundTrip = (c: [number, number, number]) => linearRgbToRgb(rgbToLinearRgb(c));
    expect(roundTrip([0, 0, 0])).toEqual([0, 0, 0]);
    expect(roundTrip([255, 0, 0])).toEqual([255, 0, 0]);
    expect(roundTrip([0, 255, 0])).toEqual([0, 255, 0]);
    expect(roundTrip([0, 0, 255])).toEqual([0, 0, 255]);
    expect(roundTrip([128, 128, 128])).toEqual([128, 128, 128]);
    expect(roundTrip([255, 255, 255])).toEqual([255, 255, 255]);
  });
});

// ── Linear RGB <-> XYZ D65 ───────────────────────────────────────────────────

describe('linearRgbToXyzD65', () => {
  it('converts linear black to XYZ black', () => {
    const [x, y, z] = linearRgbToXyzD65([0, 0, 0]);
    expect(x).toBe(0);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });
  it('converts linear white (D65) to XYZ white', () => {
    const [x, y, z] = linearRgbToXyzD65([1, 1, 1]);
    expect(x).toBeCloseTo(0.95047, 4);
    expect(y).toBeCloseTo(1.0, 4);
    expect(z).toBeCloseTo(1.08883, 4);
  });
  it('converts linear red to XYZ', () => {
    const [x, y, z] = linearRgbToXyzD65([1, 0, 0]);
    expect(x).toBeCloseTo(0.4124564, 4);
    expect(y).toBeCloseTo(0.2126729, 4);
    expect(z).toBeCloseTo(0.0193339, 4);
  });
  it('converts linear green to XYZ', () => {
    const [x, y, z] = linearRgbToXyzD65([0, 1, 0]);
    expect(x).toBeCloseTo(0.3575761, 4);
    expect(y).toBeCloseTo(0.7151522, 4);
    expect(z).toBeCloseTo(0.119192, 4);
  });
  it('converts linear blue to XYZ', () => {
    const [x, y, z] = linearRgbToXyzD65([0, 0, 1]);
    expect(x).toBeCloseTo(0.1804375, 4);
    expect(y).toBeCloseTo(0.072175, 4);
    expect(z).toBeCloseTo(0.9503041, 4);
  });
});

describe('xyzD65ToLinearRgb', () => {
  it('round-trips with linearRgbToXyzD65', () => {
    const testCases: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [0.5, 0.3, 0.8],
      [0.2, 0.6, 0.1],
    ];
    for (const rgb of testCases) {
      const xyz = linearRgbToXyzD65(rgb);
      const result = xyzD65ToLinearRgb(xyz);
      expect(result[0]).toBeCloseTo(rgb[0], 3);
      expect(result[1]).toBeCloseTo(rgb[1], 3);
      expect(result[2]).toBeCloseTo(rgb[2], 3);
    }
  });
});

// ── XYZ <-> CIELAB (D50 adapted) ──────────────────────────────────────────────

describe('xyzToLab / labToXyz', () => {
  it('converts XYZ black to Lab black', () => {
    const [l, a, b] = xyzToLab([0, 0, 0]);
    expect(l).toBeCloseTo(0, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });
  it('converts D65 white to Lab ~100,0,0', () => {
    const white = linearRgbToXyzD65([1, 1, 1]);
    const [l, a, b] = xyzToLab(white);
    expect(l).toBeCloseTo(100, 1);
    expect(a).toBeCloseTo(0, 1);
    expect(b).toBeCloseTo(0, 1);
  });
  it('converts red to Lab (high a*, positive b*)', () => {
    const redXyz = linearRgbToXyzD65([1, 0, 0]);
    const [l, a, b] = xyzToLab(redXyz);
    expect(l).toBeGreaterThan(50);
    expect(a).toBeGreaterThan(50);
    expect(b).toBeGreaterThan(50);
  });
  it('round-trips with labToXyz', () => {
    const testXyz: [number, number, number][] = [
      [0, 0, 0],
      [0.4124564, 0.2126729, 0.0193339],
      [0.95047, 1.0, 1.08883],
      [0.2, 0.3, 0.5],
    ];
    for (const xyz of testXyz) {
      const lab = xyzToLab(xyz);
      const result = labToXyz(lab);
      expect(result[0]).toBeCloseTo(xyz[0], 2);
      expect(result[1]).toBeCloseTo(xyz[1], 2);
      expect(result[2]).toBeCloseTo(xyz[2], 2);
    }
  });
});

// ── Oklab <-> linear sRGB ───────────────────────────────────────────────────────

describe('linearSrgbToOklab / oklabToLinearSrgb', () => {
  it('converts linear black to Oklab ~0,0,0', () => {
    const [l, a, b] = linearSrgbToOklab([0, 0, 0]);
    expect(l).toBeCloseTo(0, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
  });
  it('converts linear white to Oklab ~1,0,0', () => {
    const [l, a, b] = linearSrgbToOklab([1, 1, 1]);
    expect(l).toBeCloseTo(1, 4);
    expect(a).toBeCloseTo(0, 4);
    expect(b).toBeCloseTo(0, 4);
  });
  it('converts linear red to Oklab', () => {
    const [l, a, b] = linearSrgbToOklab([1, 0, 0]);
    expect(l).toBeGreaterThan(0.4);
    expect(a).toBeGreaterThan(0.2);
    expect(b).toBeGreaterThan(0.1);
  });
  it('round-trips', () => {
    const testCases: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [0.5, 0.3, 0.8],
      [0.2, 0.6, 0.1],
    ];
    for (const rgb of testCases) {
      const oklab = linearSrgbToOklab(rgb);
      const result = oklabToLinearSrgb(oklab);
      expect(result[0]).toBeCloseTo(rgb[0], 4);
      expect(result[1]).toBeCloseTo(rgb[1], 4);
      expect(result[2]).toBeCloseTo(rgb[2], 4);
    }
  });
});

// ── RGB <-> CMYK (analytical) ─────────────────────────────────────────────────

describe('rgbToCmyk', () => {
  it('converts white to (0,0,0,0)', () => {
    const [c, m, y, k] = rgbToCmyk(255, 255, 255);
    expect(c).toBe(0);
    expect(m).toBe(0);
    expect(y).toBe(0);
    expect(k).toBe(0);
  });
  it('converts black to (0,0,0,255)', () => {
    const [c, m, y, k] = rgbToCmyk(0, 0, 0);
    expect(c).toBe(0);
    expect(m).toBe(0);
    expect(y).toBe(0);
    expect(k).toBe(255);
  });
  it('converts red to (0,255,255,0)', () => {
    const [c, m, y, k] = rgbToCmyk(255, 0, 0);
    expect(c).toBe(0);
    expect(m).toBe(255);
    expect(y).toBe(255);
    expect(k).toBe(0);
  });
  it('converts green to (255,0,255,0)', () => {
    const [c, m, y, k] = rgbToCmyk(0, 255, 0);
    expect(c).toBe(255);
    expect(m).toBe(0);
    expect(y).toBe(255);
    expect(k).toBe(0);
  });
  it('converts blue to (255,255,0,0)', () => {
    const [c, m, y, k] = rgbToCmyk(0, 0, 255);
    expect(c).toBe(255);
    expect(m).toBe(255);
    expect(y).toBe(0);
    expect(k).toBe(0);
  });
});

describe('cmykToRgb', () => {
  it('round-trips with rgbToCmyk', () => {
    const testCases: [number, number, number][] = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
      [128, 128, 128],
      [200, 100, 50],
    ];
    for (const [r, g, b] of testCases) {
      const cmyk = rgbToCmyk(r, g, b);
      const result = cmykToRgb(cmyk[0], cmyk[1], cmyk[2], cmyk[3]);
      expect(result[0]).toBeCloseTo(r, 0);
      expect(result[1]).toBeCloseTo(g, 0);
      expect(result[2]).toBeCloseTo(b, 0);
    }
  });
});

// ── ΔEOK ──────────────────────────────────────────────────────────────────────

describe('deltaEOk', () => {
  it('returns 0 for identical colors', () => {
    expect(deltaEOk([255, 0, 0, 255], [255, 0, 0, 255])).toBeCloseTo(0, 4);
  });
  it('returns >0 for different colors', () => {
    expect(deltaEOk([255, 0, 0, 255], [0, 255, 0, 255])).toBeGreaterThan(0);
  });
  it('black vs white is large', () => {
    const dE = deltaEOk([0, 0, 0, 255], [255, 255, 255, 255]);
    expect(dE).toBeGreaterThan(0.5);
  });
});

// ── ManagedColor helpers ─────────────────────────────────────────────────────

describe('managedColorToRgba', () => {
  it('converts RgbColor to RGBA tuple', () => {
    const result = managedColorToRgba({ space: 'rgb', r: 255, g: 128, b: 64, a: 255 });
    expect(result).toEqual([255, 128, 64, 255]);
  });
  it('converts CmykColor to RGBA tuple via analytical conversion', () => {
    const result = managedColorToRgba({ space: 'cmyk', c: 0, m: 255, y: 255, k: 0, a: 255 });
    expect(result[0]).toBeCloseTo(255, 0);
    expect(result[1]).toBeCloseTo(0, 0);
    expect(result[2]).toBeCloseTo(0, 0);
    expect(result[3]).toBe(255);
  });
  it('converts GrayColor to RGBA tuple', () => {
    const result = managedColorToRgba({ space: 'gray', v: 128, a: 255 });
    expect(result[0]).toBe(128);
    expect(result[1]).toBe(128);
    expect(result[2]).toBe(128);
    expect(result[3]).toBe(255);
  });
  it('converts SpotColorRef using processFallback', () => {
    const result = managedColorToRgba({
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 100,
      a: 255,
      processFallback: { c: 0, m: 255, y: 255, k: 0 },
    });
    expect(result[0]).toBeCloseTo(255, 0);
    expect(result[1]).toBeCloseTo(0, 0);
    expect(result[2]).toBeCloseTo(0, 0);
    expect(result[3]).toBe(255);
  });
  it('falls back to black for SpotColorRef without processFallback', () => {
    const result = managedColorToRgba({
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 100,
      a: 255,
    });
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(0);
    expect(result[3]).toBe(255);
  });
  it('applies spot tint as opacity', () => {
    const result = managedColorToRgba({
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 50,
      a: 255,
      processFallback: { c: 0, m: 255, y: 255, k: 0 },
    });
    expect(result[0]).toBeCloseTo(255, 0);
    expect(result[1]).toBeCloseTo(0, 0);
    expect(result[2]).toBeCloseTo(0, 0);
    expect(result[3]).toBe(128);
  });
});

describe('managedColorToCss', () => {
  it('formats RgbColor as rgba()', () => {
    expect(managedColorToCss({ space: 'rgb', r: 255, g: 0, b: 0, a: 255 })).toBe('rgba(255,0,0,1)');
  });
  it('formats CmykColor as rgba()', () => {
    const css = managedColorToCss({ space: 'cmyk', c: 0, m: 255, y: 255, k: 0, a: 255 });
    expect(css).toMatch(/^rgba\(/);
  });
  it('formats GrayColor as rgba()', () => {
    expect(managedColorToCss({ space: 'gray', v: 128, a: 255 })).toBe('rgba(128,128,128,1)');
  });
  it('formats SpotColorRef as rgba()', () => {
    const css = managedColorToCss({
      space: 'spot',
      name: 'Pantone 185 C',
      tint: 100,
      a: 255,
      processFallback: { c: 0, m: 255, y: 255, k: 0 },
    });
    expect(css).toMatch(/^rgba\(/);
  });
});

describe('managedColorToEngineColor', () => {
  it('converts RgbColor to engine Color tuple', () => {
    const result = managedColorToEngineColor({ space: 'rgb', r: 255, g: 128, b: 64, a: 255 });
    expect(result).toEqual([255, 128, 64, 255]);
  });
});

// ── Gamut mapping ─────────────────────────────────────────────────────────────

describe('gamutMapToSrgb', () => {
  it('maps in-gamut Oklch to sRGB', () => {
    const [r, g, b] = gamutMapToSrgb([0.5, 0.1, 0]);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });
  it('maps white Oklch to sRGB white', () => {
    const [r, g, b] = gamutMapToSrgb([1, 0, 0]);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });
  it('maps black Oklch to sRGB black', () => {
    const [r, g, b] = gamutMapToSrgb([0, 0, 0]);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
  it('clamps out-of-gamut high-chroma red', () => {
    const [r, g, b] = gamutMapToSrgb([0.5, 0.4, 0.07]);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(255);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(255);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(255);
  });
});

describe('managedColorKey', () => {
  it('distinguishes colors by space, channels, depth, and profile', () => {
    const a = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const b = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const c = { space: 'rgb', r: 101, g: 150, b: 200, a: 255 };
    const d = { space: 'cmyk', c: 100, m: 150, y: 200, k: 0, a: 255 };
    const e = { space: 'rgb', bitDepth: 'float32', r: 0.5, g: 0.5, b: 0.5, a: 1 };
    const f = { space: 'rgb', r: 100, g: 150, b: 200, a: 255, profile: 'srgb' };
    expect(managedColorKey(a)).toBe(managedColorKey(b));
    expect(managedColorKey(a)).not.toBe(managedColorKey(c));
    expect(managedColorKey(a)).not.toBe(managedColorKey(d));
    expect(managedColorKey(a)).not.toBe(managedColorKey(e));
    expect(managedColorKey(a)).not.toBe(managedColorKey(f));
  });
});
