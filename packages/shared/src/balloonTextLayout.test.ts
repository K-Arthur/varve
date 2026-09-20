import { describe, expect, it } from 'vitest';
import {
  ellipseLineWidthProfile,
  resolveTextWrapLineWidths,
  TEXT_WRAP_SHAPES,
} from './balloonTextLayout';

describe('ellipseLineWidthProfile', () => {
  it('is symmetric with the widest line near the vertical middle', () => {
    const widths = ellipseLineWidthProfile({ width: 240, height: 200, lineHeight: 25 });
    expect(widths.length).toBeGreaterThan(3);
    for (let index = 0; index < widths.length; index++) {
      expect(widths[index]).toBeCloseTo(widths[widths.length - 1 - index]!, 5);
    }
    const widest = Math.max(...widths);
    const widestIndex = widths.indexOf(widest);
    const middle = (widths.length - 1) / 2;
    expect(Math.abs(widestIndex - middle)).toBeLessThanOrEqual(1);
    expect(widths[0]).toBeLessThan(widest);
    expect(widths[widths.length - 1]).toBeLessThan(widest);
  });

  it('never exceeds the interior width and never returns a non-finite value', () => {
    const widths = ellipseLineWidthProfile({ width: 180, height: 320, lineHeight: 28 });
    for (const width of widths) {
      expect(Number.isFinite(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(180 + 1e-9);
    }
  });

  it('floors narrow lines so a word is never squeezed into a sliver', () => {
    const widths = ellipseLineWidthProfile({
      width: 300,
      height: 400,
      lineHeight: 40,
      minWidthRatio: 0.5,
    });
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(150 - 1e-9);
  });

  it('returns a single full-width entry for degenerate boxes instead of NaN', () => {
    expect(ellipseLineWidthProfile({ width: 0, height: 0, lineHeight: 0 })).toEqual([1]);
    const pathological = ellipseLineWidthProfile({
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
      lineHeight: 16,
    });
    expect(pathological.every((width) => Number.isFinite(width) && width > 0)).toBe(true);
  });

  it('caps the number of entries for extremely tall boxes', () => {
    const widths = ellipseLineWidthProfile({
      width: 100,
      height: 10_000_000,
      lineHeight: 1,
      maxLines: 64,
    });
    expect(widths).toHaveLength(64);
  });
});

describe('resolveTextWrapLineWidths', () => {
  it('treats the rectangle as the default and only profiles the ellipse', () => {
    expect(
      resolveTextWrapLineWidths({
        wrapShape: undefined,
        width: 200,
        height: 120,
        lineHeight: 20,
      }),
    ).toBeNull();
    expect(
      resolveTextWrapLineWidths({
        wrapShape: 'rect',
        width: 200,
        height: 120,
        lineHeight: 20,
      }),
    ).toBeNull();
    expect(
      resolveTextWrapLineWidths({
        wrapShape: 'ellipse',
        width: 200,
        height: 120,
        lineHeight: 20,
      }),
    ).not.toBeNull();
  });

  it('declines non-finite or empty boxes so callers fall back to rectangles', () => {
    for (const box of [
      { width: 0, height: 100 },
      { width: 100, height: 0 },
      { width: Number.NaN, height: 100 },
      { width: 100, height: Number.POSITIVE_INFINITY },
    ]) {
      expect(
        resolveTextWrapLineWidths({
          wrapShape: 'ellipse',
          width: box.width,
          height: box.height,
          lineHeight: 20,
        }),
      ).toBeNull();
    }
    expect(
      resolveTextWrapLineWidths({
        wrapShape: 'ellipse',
        width: 100,
        height: 100,
        lineHeight: 0,
      }),
    ).toBeNull();
  });
});

describe('TEXT_WRAP_SHAPES', () => {
  it('is the closed vocabulary the Inspector exposes', () => {
    expect([...TEXT_WRAP_SHAPES]).toEqual(['rect', 'ellipse']);
  });
});
