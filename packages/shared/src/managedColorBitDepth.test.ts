import { describe, expect, it } from 'vitest';
import { managedColorToCss, managedColorToNormalized, managedColorToRgba } from './colorConversion';

describe('managedColorToRgba with bit depth', () => {
  it('uint8 RGB passes through unchanged (backward compat)', () => {
    const c = { space: 'rgb' as const, r: 100, g: 150, b: 200, a: 255 };
    expect(managedColorToRgba(c)).toEqual([100, 150, 200, 255]);
  });

  it('RGB without bitDepth defaults to uint8', () => {
    const c = { space: 'rgb' as const, r: 50, g: 100, b: 150, a: 255 };
    expect(managedColorToRgba(c)).toEqual([50, 100, 150, 255]);
  });

  it('uint16 RGB normalizes to 0-255', () => {
    // uint16 32768 ≈ 0.5000076 → uint8 128
    // uint16 16384 ≈ 0.2500038 → uint8 64
    // uint16 49152 ≈ 0.7500114 → uint8 191
    const c = {
      space: 'rgb' as const,
      bitDepth: 'uint16' as const,
      r: 32768,
      g: 16384,
      b: 49152,
      a: 65535,
    };
    const [r, g, b, a] = managedColorToRgba(c);
    expect(r).toBe(128);
    expect(g).toBe(64);
    expect(b).toBe(191);
    expect(a).toBe(255);
  });

  it('float32 RGB normalizes to 0-255', () => {
    const c = {
      space: 'rgb' as const,
      bitDepth: 'float32' as const,
      r: 0.0,
      g: 0.5,
      b: 1.0,
      a: 1.0,
    };
    const [r, g, b, a] = managedColorToRgba(c);
    expect(r).toBe(0);
    expect(g).toBe(128);
    expect(b).toBe(255);
    expect(a).toBe(255);
  });

  it('float16 RGB preserves sub-8-bit precision through normalization', () => {
    // 1/512 ≈ 0.00195 — too small for uint8 but representable in float
    const c = {
      space: 'rgb' as const,
      bitDepth: 'float16' as const,
      r: 1 / 512,
      g: 0.5,
      b: 1 / 512,
      a: 1.0,
    };
    const [r, g, b, a] = managedColorToRgba(c);
    // 1/512 * 255 ≈ 0.498 → rounds to 0
    expect(r).toBe(0);
    expect(g).toBe(128);
    expect(b).toBe(0);
    expect(a).toBe(255);
  });

  it('float32 HDR values > 1 clamp to 255', () => {
    const c = {
      space: 'rgb' as const,
      bitDepth: 'float32' as const,
      r: 1.5,
      g: 2.0,
      b: 0.5,
      a: 1.0,
    };
    const [r, g, b] = managedColorToRgba(c);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(128);
  });

  it('uint8 CMYK converts via analytical path', () => {
    const c = { space: 'cmyk' as const, c: 0, m: 0, y: 0, k: 0, a: 255 };
    // CMYK(0,0,0,0) → RGB(255,255,255)
    expect(managedColorToRgba(c)).toEqual([255, 255, 255, 255]);
  });

  it('uint16 CMYK normalizes channels before conversion', () => {
    // uint16 max = 65535 → normalized 1.0 → CMYK(100%,0,0,0) → RGB(0,255,255)
    const c = {
      space: 'cmyk' as const,
      bitDepth: 'uint16' as const,
      c: 65535,
      m: 0,
      y: 0,
      k: 0,
      a: 65535,
    };
    const [r, g, b] = managedColorToRgba(c);
    // C=100% (255), M=0, Y=0, K=0 → R = 255*(1-1)*(1-0) = 0, G = 255, B = 255
    expect(r).toBe(0);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('float32 CMYK normalizes channels before conversion', () => {
    // float 0.5 → denormalize to uint8 128 → CMYK(128,0,0,0) → RGB(127,255,255)
    const c = {
      space: 'cmyk' as const,
      bitDepth: 'float32' as const,
      c: 0.5,
      m: 0,
      y: 0,
      k: 0,
      a: 1.0,
    };
    const [r, g, b] = managedColorToRgba(c);
    // denormalizeChannel(0.5, 'uint8') = 128 → cmykToRgb(128,0,0,0) → R = round(255*(1-128/255)) = 127
    expect(r).toBe(127);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('uint8 gray expands to RGB', () => {
    const c = { space: 'gray' as const, v: 128, a: 255 };
    expect(managedColorToRgba(c)).toEqual([128, 128, 128, 255]);
  });

  it('uint16 gray normalizes to 0-255', () => {
    const c = { space: 'gray' as const, bitDepth: 'uint16' as const, v: 32768, a: 65535 };
    const [r, g, b] = managedColorToRgba(c);
    expect(r).toBe(128);
    expect(g).toBe(128);
    expect(b).toBe(128);
  });

  it('float32 gray normalizes to 0-255', () => {
    const c = { space: 'gray' as const, bitDepth: 'float32' as const, v: 0.2, a: 1.0 };
    const expected = Math.round(0.2 * 255);
    const [r, g, b] = managedColorToRgba(c);
    expect(r).toBe(expected);
    expect(g).toBe(expected);
    expect(b).toBe(expected);
  });
});

describe('managedColorToNormalized', () => {
  it('uint8 returns 0.0-1.0 range', () => {
    const c = { space: 'rgb' as const, r: 0, g: 128, b: 255, a: 255 };
    const [r, g, b, a] = managedColorToNormalized(c);
    expect(r).toBe(0);
    expect(g).toBeCloseTo(0.50196, 4);
    expect(b).toBe(1);
    expect(a).toBe(1);
  });

  it('float32 returns values close to input without uint8 quantization', () => {
    const c = {
      space: 'rgb' as const,
      bitDepth: 'float32' as const,
      r: 0.5,
      g: 0.5,
      b: 0.5,
      a: 1.0,
    };
    const [r, g, b, a] = managedColorToNormalized(c);
    expect(r).toBe(0.5);
    expect(g).toBe(0.5);
    expect(b).toBe(0.5);
    expect(a).toBe(1);
  });

  it('preserves distinct float levels that collapse to the same RGBA8 value', () => {
    const first = managedColorToNormalized({
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.1234,
      g: 0.5,
      b: 0.5,
      a: 1,
    });
    const second = managedColorToNormalized({
      space: 'rgb',
      bitDepth: 'float32',
      r: 0.1235,
      g: 0.5,
      b: 0.5,
      a: 1,
    });
    expect(first[0]).toBe(0.1234);
    expect(second[0]).toBe(0.1235);
    expect(first[0]).not.toBe(second[0]);
    expect(
      managedColorToRgba({
        space: 'rgb',
        bitDepth: 'float32',
        r: 0.1234,
        g: 0.5,
        b: 0.5,
        a: 1,
      })[0],
    ).toBe(
      managedColorToRgba({
        space: 'rgb',
        bitDepth: 'float32',
        r: 0.1235,
        g: 0.5,
        b: 0.5,
        a: 1,
      })[0],
    );
  });

  it('keeps fractional CMYK channels out of the display quantization path', () => {
    const color = {
      space: 'cmyk' as const,
      bitDepth: 'float32' as const,
      c: 0.1234,
      m: 0.2345,
      y: 0.3456,
      k: 0.0123,
      a: 1,
    };
    const [r, g, b, a] = managedColorToNormalized(color);
    expect(r).toBeCloseTo((1 - color.c) * (1 - color.k), 12);
    expect(g).toBeCloseTo((1 - color.m) * (1 - color.k), 12);
    expect(b).toBeCloseTo((1 - color.y) * (1 - color.k), 12);
    expect(a).toBe(1);
  });

  it('CMYK returns normalized RGB (via process path)', () => {
    const c = { space: 'cmyk' as const, c: 0, m: 0, y: 0, k: 255, a: 255 };
    // CMYK(0,0,0,255) → RGB(0,0,0)
    const [r, g, b] = managedColorToNormalized(c);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });
});

describe('managedColorToCss with bit depth', () => {
  it('uint8 produces standard rgba()', () => {
    const c = { space: 'rgb' as const, r: 255, g: 128, b: 0, a: 255 };
    expect(managedColorToCss(c)).toBe('rgba(255,128,0,1)');
  });

  it('float32 produces rgba() with normalized channels', () => {
    const c = {
      space: 'rgb' as const,
      bitDepth: 'float32' as const,
      r: 1.0,
      g: 0.5,
      b: 0.0,
      a: 1.0,
    };
    expect(managedColorToCss(c)).toBe('rgba(255,128,0,1)');
  });
});
