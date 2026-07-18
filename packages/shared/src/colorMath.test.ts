import { describe, expect, it } from 'vitest';
import {
  binnedMode,
  contrastRatio,
  deltaEOK,
  findAccessibleColor,
  mean,
  median,
  oklchToRgb,
  rgbToOklch,
  stddev,
} from './colorMath';

describe('mean', () => {
  it('returns the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it('returns 0 for an empty array', () => {
    expect(mean([])).toBe(0);
  });
});

describe('stddev', () => {
  it('returns the sample standard deviation', () => {
    // Sample stddev of [2,4,4,4,5,5,7,9] = sqrt(32/7) ≈ 2.138
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 2);
  });

  it('returns 0 for fewer than 2 values', () => {
    expect(stddev([42])).toBe(0);
    expect(stddev([])).toBe(0);
  });
});

describe('median', () => {
  it('returns the middle value for odd-length arrays', () => {
    expect(median([1, 3, 5, 7, 9])).toBe(5);
  });

  it('returns the average of two middle values for even-length arrays', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for an empty array', () => {
    expect(median([])).toBe(0);
  });
});

describe('binnedMode', () => {
  it('returns the lower bound of the most frequent bin', () => {
    expect(binnedMode([4, 8, 8, 12, 12, 12, 16], 4)).toBe(12);
  });

  it('returns null for an empty array', () => {
    expect(binnedMode([], 4)).toBeNull();
  });

  it('returns null for non-positive bin size', () => {
    expect(binnedMode([1, 2, 3], 0)).toBeNull();
  });
});

describe('rgbToOklch / oklchToRgb', () => {
  it('round-trips pure red', () => {
    const red: [number, number, number] = [255, 0, 0];
    const oklch = rgbToOklch(red);
    const out = oklchToRgb(oklch);
    expect(out[0]).toBeCloseTo(255, 0);
    expect(out[1]).toBeCloseTo(0, 0);
    expect(out[2]).toBeCloseTo(0, 0);
  });
});

describe('contrastRatio', () => {
  it('returns 21:1 for black on white', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 1);
  });

  it('returns ~4.0:1 for red on white', () => {
    const ratio = contrastRatio([255, 0, 0], [255, 255, 255]);
    expect(ratio).toBeGreaterThan(3.9);
    expect(ratio).toBeLessThan(4.1);
  });
});

describe('deltaEOK', () => {
  it('returns 0 for identical colors', () => {
    const red = rgbToOklch([255, 0, 0]);
    expect(deltaEOK(red, red)).toBeCloseTo(0, 6);
  });

  it('is small for nearby colors and large for distant colors', () => {
    const red = rgbToOklch([255, 0, 0]);
    const darkRed = rgbToOklch([200, 0, 0]);
    const blue = rgbToOklch([0, 0, 255]);
    expect(deltaEOK(red, darkRed)).toBeLessThan(deltaEOK(red, blue));
  });
});

describe('findAccessibleColor', () => {
  it('fixes red on white to meet 4.5:1 while staying perceptually close', () => {
    const fixed = findAccessibleColor([255, 0, 0], [255, 255, 255], 4.5);
    expect(contrastRatio(fixed, [255, 255, 255])).toBeGreaterThanOrEqual(4.5);
    const fixedOklch = rgbToOklch(fixed);
    const redOklch = rgbToOklch([255, 0, 0]);
    expect(deltaEOK(fixedOklch, redOklch)).toBeLessThan(5.0);
  });

  it('returns the input unchanged when it already passes', () => {
    const black: [number, number, number] = [0, 0, 0];
    expect(findAccessibleColor(black, [255, 255, 255], 4.5)).toEqual(black);
  });
});
