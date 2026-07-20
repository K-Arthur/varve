import { describe, expect, it } from 'vitest';
import {
  deriveHeight,
  deriveWidth,
  ratioValue,
  roundDimension,
  simplifyRatio,
  swapDimensions,
  validateDimensions,
} from './presetAspectRatio';

describe('simplifyRatio', () => {
  it('GCD-reduces integer pairs', () => {
    expect(simplifyRatio(1920, 1080)).toEqual({ w: 16, h: 9 });
    expect(simplifyRatio(1080, 1080)).toEqual({ w: 1, h: 1 });
    expect(simplifyRatio(1080, 1920)).toEqual({ w: 9, h: 16 });
  });

  it('normalizes non-integer pairs by the smaller value', () => {
    const ratio = simplifyRatio(210.5, 297.7);
    expect(ratio.w).toBeCloseTo(1, 5);
    expect(ratio.h).toBeCloseTo(297.7 / 210.5, 5);
  });

  it('falls back to decimal normalization when GCD-reduction still yields large terms', () => {
    // ISO A4 (210x297mm) GCD-reduces to 70:99 — technically exact, but not a
    // recognizable ratio. Should normalize to ~1:sqrt(2) instead.
    const ratio = simplifyRatio(210, 297);
    expect(ratio.w).toBeCloseTo(1, 5);
    expect(ratio.h).toBeCloseTo(Math.SQRT2, 3);
  });

  it('falls back to 1:1 for invalid input', () => {
    expect(simplifyRatio(0, 100)).toEqual({ w: 1, h: 1 });
    expect(simplifyRatio(-10, 100)).toEqual({ w: 1, h: 1 });
    expect(simplifyRatio(Number.NaN, 100)).toEqual({ w: 1, h: 1 });
    expect(simplifyRatio(Number.POSITIVE_INFINITY, 100)).toEqual({ w: 1, h: 1 });
  });
});

describe('ratioValue', () => {
  it('computes width/height', () => {
    expect(ratioValue({ w: 16, h: 9 })).toBeCloseTo(16 / 9, 10);
  });

  it('returns 0 for a zero-height ratio rather than throwing', () => {
    expect(ratioValue({ w: 16, h: 0 })).toBe(0);
  });
});

describe('deriveHeight / deriveWidth', () => {
  const ratio16x9 = { w: 16, h: 9 };

  it('derives the complementary dimension at a fixed ratio', () => {
    expect(deriveHeight(1920, ratio16x9)).toBe(1080);
    expect(deriveWidth(1080, ratio16x9)).toBe(1920);
  });

  it('is a pure function of (dimension, ratio) — repeated calls with the same input are stable', () => {
    const widths = [333, 667, 1001, 1337, 1920, 2001];
    for (const w of widths) {
      expect(deriveHeight(w, ratio16x9)).toBe(deriveHeight(w, ratio16x9));
    }
  });

  it('converges to a fixed point under repeated back-and-forth derivation, rather than drifting indefinitely', () => {
    // A naive implementation that re-derives from the *previous rounded*
    // output on every edit could compound rounding error without bound.
    // Deriving directly from the ratio each time means alternating
    // width<->height edits settle into a stable fixed point after the first
    // round trip, and further edits never move again.
    let width = 1001;
    let height = deriveHeight(width, ratio16x9);
    for (let i = 0; i < 50; i++) {
      width = deriveWidth(height, ratio16x9);
      height = deriveHeight(width, ratio16x9);
    }
    const stableWidth = width;
    const stableHeight = height;
    width = deriveWidth(height, ratio16x9);
    height = deriveHeight(width, ratio16x9);
    expect(width).toBe(stableWidth);
    expect(height).toBe(stableHeight);
  });

  it('handles decimal/non-integer ratios (ISO paper)', () => {
    const isoRatio = simplifyRatio(210, 297);
    expect(deriveHeight(210, isoRatio)).toBeCloseTo(297, 0);
  });
});

describe('roundDimension', () => {
  it('rounds to the nearest whole unit', () => {
    expect(roundDimension(10.4)).toBe(10);
    expect(roundDimension(10.5)).toBe(11);
    expect(roundDimension(10.6)).toBe(11);
  });
});

describe('swapDimensions', () => {
  it('swaps exactly with no rounding', () => {
    expect(swapDimensions({ width: 1920, height: 1080 })).toEqual({ width: 1080, height: 1920 });
  });

  it('is idempotent when applied twice', () => {
    const original = { width: 393, height: 852 };
    expect(swapDimensions(swapDimensions(original))).toEqual(original);
  });
});

describe('validateDimensions', () => {
  it('accepts positive finite dimensions', () => {
    expect(validateDimensions(100, 200)).toBeNull();
    expect(validateDimensions(0.5, 0.5)).toBeNull();
  });

  it('rejects zero, negative, non-finite, and excessively large values', () => {
    expect(validateDimensions(0, 100)).not.toBeNull();
    expect(validateDimensions(100, 0)).not.toBeNull();
    expect(validateDimensions(-5, 100)).not.toBeNull();
    expect(validateDimensions(Number.NaN, 100)).not.toBeNull();
    expect(validateDimensions(Number.POSITIVE_INFINITY, 100)).not.toBeNull();
    expect(validateDimensions(10_000_000, 100)).not.toBeNull();
  });
});
