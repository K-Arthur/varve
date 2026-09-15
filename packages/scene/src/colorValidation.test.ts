import { describe, expect, it } from 'vitest';
import {
  clampSpotTint,
  isValidManagedColor,
  LCH_HUE_MAX,
  managedColorEquals,
  normalizeManagedColor,
  SPOT_TINT_MAX,
  SPOT_TINT_MIN,
  validateManagedColor,
  wrapHueDegrees,
} from './colorValidation';

describe('validateManagedColor', () => {
  it('accepts a valid rgb color', () => {
    expect(validateManagedColor({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })).toEqual([]);
  });

  it('rejects NaN and infinite channels', () => {
    expect(validateManagedColor({ space: 'rgb', r: NaN, g: 0, b: 0, a: 255 })).toContain(
      'r is NaN',
    );
    expect(validateManagedColor({ space: 'rgb', r: 0, g: Infinity, b: 0, a: 255 })).toContain(
      'g is infinite',
    );
    expect(validateManagedColor({ space: 'lab', l: 50, av: NaN, b: 0, a: 255 })).toContain(
      'a is NaN',
    );
  });

  it('enforces uint8 channel range and integer channels', () => {
    expect(validateManagedColor({ space: 'rgb', r: 300, g: 0, b: 0, a: 255 })).toContain(
      'uint8 channels must be integers in [0, 255]',
    );
    expect(validateManagedColor({ space: 'rgb', r: 1.5, g: 0, b: 0, a: 255 })).toContain(
      'uint8 channels must be integers in [0, 255]',
    );
  });

  it('validates lab lightness range', () => {
    expect(validateManagedColor({ space: 'lab', l: 101, av: 0, b: 0, a: 255 })).toContain(
      'lab lightness must be in [0, 100]',
    );
    expect(validateManagedColor({ space: 'lab', l: 50, av: 0, b: 0, a: 255 })).toEqual([]);
  });

  it('rejects negative lch chroma', () => {
    expect(validateManagedColor({ space: 'lch', l: 50, c: -5, h: 120, a: 255 })).toContain(
      'lch chroma must be >= 0',
    );
  });

  it('requires wrapped lch hue', () => {
    expect(validateManagedColor({ space: 'lch', l: 50, c: 20, h: 420, a: 255 })).toContain(
      'lch hue must be wrapped to [0, 360)',
    );
    expect(validateManagedColor({ space: 'lch', l: 50, c: 20, h: 359, a: 255 })).toEqual([]);
  });

  it('validates spot tint bounds and name', () => {
    expect(
      validateManagedColor({ space: 'spot', name: 'Pantone 185 C', tint: 150, a: 255 }),
    ).toContain(`spot tint must be in [${SPOT_TINT_MIN}, ${SPOT_TINT_MAX}]`);
    expect(validateManagedColor({ space: 'spot', name: '', tint: 50, a: 255 })).toContain(
      'spot color requires a name',
    );
    expect(validateManagedColor({ space: 'spot', name: 'A', tint: 50, a: 255 })).toEqual([]);
  });

  it('requires unresolved colors to carry a source', () => {
    expect(validateManagedColor({ space: 'unresolved', source: '', a: 255 })).toContain(
      'unresolved color requires a source',
    );
  });

  it('accepts registration color', () => {
    expect(validateManagedColor({ space: 'registration', a: 255 })).toEqual([]);
  });

  it('rejects non-finite alpha on every variant', () => {
    expect(validateManagedColor({ space: 'rgb', r: 0, g: 0, b: 0, a: NaN })).toContain(
      'alpha must be finite',
    );
    expect(validateManagedColor({ space: 'registration', a: Infinity })).toContain(
      'alpha must be finite',
    );
  });
});

describe('isValidManagedColor', () => {
  it('is true only for valid colors', () => {
    expect(isValidManagedColor({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })).toBe(true);
    expect(isValidManagedColor({ space: 'lch', l: 50, c: -1, h: 0, a: 255 })).toBe(false);
  });
});

describe('wrapHueDegrees', () => {
  it('wraps deterministically into [0, 360)', () => {
    expect(wrapHueDegrees(0)).toBe(0);
    expect(wrapHueDegrees(360)).toBe(0);
    expect(wrapHueDegrees(370)).toBe(10);
    expect(wrapHueDegrees(-10)).toBe(350);
    expect(wrapHueDegrees(720 + 45)).toBe(45);
    expect(wrapHueDegrees(NaN)).toBe(0);
    expect(wrapHueDegrees(Infinity)).toBe(0);
  });

  it('matches LCH_HUE_MAX bound', () => {
    expect(wrapHueDegrees(LCH_HUE_MAX)).toBe(0);
  });
});

describe('normalizeManagedColor', () => {
  it('wraps hue and takes absolute chroma on lch copies', () => {
    const c = normalizeManagedColor({ space: 'lch', l: 50, c: -20, h: 540, a: 255 });
    expect(c).toEqual({ space: 'lch', l: 50, c: 20, h: 180, a: 255 });
  });

  it('does not mutate the source object', () => {
    const src = { space: 'lch', l: 50, c: -20, h: 540, a: 255 } as const;
    normalizeManagedColor(src);
    expect(src).toEqual({ space: 'lch', l: 50, c: -20, h: 540, a: 255 });
  });

  it('clamps lab lightness into [0, 100]', () => {
    const c = normalizeManagedColor({ space: 'lab', l: 140, av: 10, b: -10, a: 255 });
    expect(c).toEqual({ space: 'lab', l: 100, av: 10, b: -10, a: 255 });
  });

  it('returns null for NaN lch values', () => {
    expect(normalizeManagedColor({ space: 'lch', l: NaN, c: 10, h: 0, a: 255 })).toBeNull();
  });
});

describe('managedColorEquals', () => {
  it('compares within tolerance', () => {
    const a = { space: 'lch' as const, l: 50, c: 20, h: 30, a: 255 };
    expect(
      managedColorEquals(a, { space: 'lch' as const, l: 50.0000000001, c: 20, h: 30, a: 255 }),
    ).toBe(true);
    expect(managedColorEquals(a, { space: 'lch' as const, l: 51, c: 20, h: 30, a: 255 })).toBe(
      false,
    );
  });

  it('distinguishes spaces and nested fallbacks', () => {
    const a = { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255 };
    expect(managedColorEquals(a, { space: 'cmyk' as const, c: 1, m: 2, y: 3, k: 0, a: 255 })).toBe(
      false,
    );
    const u1 = {
      space: 'unresolved' as const,
      source: 'x',
      fallback: { r: 1, g: 1, b: 1 },
      a: 255,
    };
    const u2 = {
      space: 'unresolved' as const,
      source: 'x',
      fallback: { r: 2, g: 1, b: 1 },
      a: 255,
    };
    expect(managedColorEquals(u1, u2)).toBe(false);
  });

  it('treats undefined and missing as equal', () => {
    const a = { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255, profile: undefined };
    expect(managedColorEquals(a, { space: 'rgb' as const, r: 1, g: 2, b: 3, a: 255 })).toBe(true);
  });
});

describe('clampSpotTint', () => {
  it('clamps into [0, 100] and rejects NaN', () => {
    expect(clampSpotTint(150)).toBe(100);
    expect(clampSpotTint(-5)).toBe(0);
    expect(clampSpotTint(42.5)).toBe(42.5);
    expect(clampSpotTint(NaN)).toBe(0);
  });
});
