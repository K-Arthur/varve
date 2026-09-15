import { describe, expect, it } from 'vitest';
import type { CmykColor, GrayColor, ManagedColor, RgbColor } from './colorManagement';
import {
  DEFAULT_BIT_DEPTH,
  isCmykColor,
  isRgbColor,
  rgbFromTuple,
  withDefaultBitDepth,
} from './colorManagement';

describe('withDefaultBitDepth', () => {
  it('returns uint8 for colors without bitDepth (backward compat)', () => {
    const c: RgbColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const result = withDefaultBitDepth(c);
    expect(result.bitDepth).toBe('uint8');
  });

  it('preserves existing bitDepth when set', () => {
    const c: RgbColor = { space: 'rgb', bitDepth: 'float32', r: 0.5, g: 0.5, b: 0.5, a: 1 };
    const result = withDefaultBitDepth(c);
    expect(result.bitDepth).toBe('float32');
  });

  it('uses provided fallback instead of default', () => {
    const c: RgbColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    const result = withDefaultBitDepth(c, 'uint16');
    expect(result.bitDepth).toBe('uint16');
  });

  it('does not mutate the original color', () => {
    const c: RgbColor = { space: 'rgb', r: 100, g: 150, b: 200, a: 255 };
    withDefaultBitDepth(c);
    expect(c.bitDepth).toBeUndefined();
  });

  it('returns spot colors unchanged (no channel precision)', () => {
    const c: ManagedColor = { space: 'spot', name: 'Pantone 185 C', tint: 100, a: 255 };
    const result = withDefaultBitDepth(c);
    expect(result).toBe(c); // same reference
  });

  it('works for CMYK colors', () => {
    const c: CmykColor = { space: 'cmyk', c: 0, m: 100, y: 100, k: 0, a: 255 };
    const result = withDefaultBitDepth(c, 'float16');
    expect(result.bitDepth).toBe('float16');
  });

  it('works for gray colors', () => {
    const c: GrayColor = { space: 'gray', v: 128, a: 255 };
    const result = withDefaultBitDepth(c);
    expect(result.bitDepth).toBe('uint8');
  });

  it('type guard still works after adding bitDepth', () => {
    const c = withDefaultBitDepth({ space: 'rgb', r: 100, g: 150, b: 200, a: 255 });
    expect(isRgbColor(c)).toBe(true);
    expect(isCmykColor(c)).toBe(false);
  });
});

describe('DEFAULT_BIT_DEPTH', () => {
  it('is uint8', () => {
    expect(DEFAULT_BIT_DEPTH).toBe('uint8');
  });
});

describe('rgbFromTuple with bitDepth', () => {
  it('sets bitDepth to uint8', () => {
    const c = rgbFromTuple([100, 150, 200, 255]);
    expect(c.bitDepth).toBe('uint8');
    expect(c.r).toBe(100);
    expect(c.g).toBe(150);
    expect(c.b).toBe(200);
    expect(c.a).toBe(255);
  });
});
