import { describe, expect, it } from 'vitest';
import { ellipseLineWidthProfile, lineWidthAt, TEXT_WRAP_SHAPES } from './balloonTextLayout';

describe('ellipseLineWidthProfile', () => {
  it('is symmetric with the widest line near the vertical middle', () => {
    const widths = ellipseLineWidthProfile({ width: 240, lineCount: 9 });
    expect(widths).toHaveLength(9);
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
    for (const lineCount of [1, 2, 3, 7, 40]) {
      const widths = ellipseLineWidthProfile({ width: 180, lineCount });
      for (const width of widths) {
        expect(Number.isFinite(width)).toBe(true);
        expect(width).toBeGreaterThan(0);
        expect(width).toBeLessThanOrEqual(180 + 1e-9);
      }
    }
  });

  it('keeps a one-line caption at full width', () => {
    expect(ellipseLineWidthProfile({ width: 300, lineCount: 1 })).toEqual([300]);
  });

  it('floors narrow lines so a word is never squeezed into a sliver', () => {
    const widths = ellipseLineWidthProfile({
      width: 300,
      lineCount: 12,
      minWidthRatio: 0.5,
    });
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(150 - 1e-9);
  });

  it('returns finite entries for degenerate input instead of NaN', () => {
    expect(ellipseLineWidthProfile({ width: 0, lineCount: 0 })).toEqual([1]);
    const nanWidth = ellipseLineWidthProfile({ width: Number.NaN, lineCount: 4 });
    expect(nanWidth).toHaveLength(4);
    expect(nanWidth.every((width) => Number.isFinite(width) && width > 0 && width <= 1)).toBe(true);
    const huge = ellipseLineWidthProfile({ width: 100, lineCount: 10_000 });
    expect(huge).toHaveLength(512);
    expect(huge.every((width) => Number.isFinite(width) && width > 0)).toBe(true);
  });
});

describe('lineWidthAt', () => {
  it('falls back to the box width without a profile', () => {
    expect(lineWidthAt(null, 200, 3)).toBe(200);
    expect(lineWidthAt(undefined, 200, 0)).toBe(200);
    expect(lineWidthAt([], 200, 0)).toBe(200);
  });

  it('clamps to the box and reuses the last entry past the end', () => {
    const profile = [40, 120, 80];
    expect(lineWidthAt(profile, 200, 0)).toBe(40);
    expect(lineWidthAt(profile, 90, 1)).toBe(90);
    expect(lineWidthAt(profile, 200, 5)).toBe(80);
    expect(lineWidthAt([Number.NaN], 200, 0)).toBe(200);
  });
});

describe('TEXT_WRAP_SHAPES', () => {
  it('is the closed vocabulary the Inspector exposes', () => {
    expect([...TEXT_WRAP_SHAPES]).toEqual(['rect', 'ellipse']);
  });
});
