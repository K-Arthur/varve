import { describe, expect, it } from 'vitest';
import {
  applyColorBalance,
  applyColorBalancePixel,
  colorBalanceTonalWeights,
  normalizeColorBalanceParams,
} from './colorBalance';

const identity = {
  shadows: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
  preserveLuminosity: true,
};

function image(pixel: [number, number, number, number]): ImageData {
  const data = new ImageData(1, 1);
  data.data.set(pixel);
  return data;
}

function linearLuminance(r: number, g: number, b: number): number {
  const linear = (value: number) => {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

describe('Color Balance scalar kernel', () => {
  it('normalizes finite signed controls and pins the algorithm version', () => {
    expect(
      normalizeColorBalanceParams({
        shadows: { cyanRed: Number.NaN, magentaGreen: 200, yellowBlue: -200 },
        preserveLuminosity: false,
      }),
    ).toEqual({
      shadows: { cyanRed: 0, magentaGreen: 100, yellowBlue: -100 },
      midtones: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
      algorithmVersion: 1,
    });
  });

  it('uses smooth normalized overlapping tonal weights', () => {
    for (const luminance of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const weights = colorBalanceTonalWeights(luminance);
      expect(weights.shadows).toBeGreaterThanOrEqual(0);
      expect(weights.midtones).toBeGreaterThanOrEqual(0);
      expect(weights.highlights).toBeGreaterThanOrEqual(0);
      expect(weights.shadows + weights.midtones + weights.highlights).toBeCloseTo(1, 12);
    }
    expect(colorBalanceTonalWeights(0).shadows).toBe(1);
    expect(colorBalanceTonalWeights(0.5).midtones).toBe(1);
    expect(colorBalanceTonalWeights(1).highlights).toBe(1);
  });

  it('has an exact identity fast path and preserves transparent hidden RGB', () => {
    const data = image([17, 29, 41, 0]);
    const result = applyColorBalance(data, identity);
    expect(result).toBe(data);
    expect(Array.from(data.data)).toEqual([17, 29, 41, 0]);
  });

  it('moves a neutral midtone toward red on the cyan/red axis', () => {
    const red = applyColorBalancePixel([128, 128, 128, 255], {
      ...identity,
      midtones: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
    });
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(red[0]).toBeGreaterThan(red[2]);
  });

  it('keeps linear luminance close when Preserve Luminosity is enabled', () => {
    const before: [number, number, number, number] = [180, 92, 48, 255];
    const after = applyColorBalancePixel(before, {
      ...identity,
      shadows: { cyanRed: -80, magentaGreen: 60, yellowBlue: 30 },
      midtones: { cyanRed: 60, magentaGreen: -70, yellowBlue: -40 },
      highlights: { cyanRed: 90, magentaGreen: 50, yellowBlue: -80 },
    });
    const beforeLum = linearLuminance(before[0], before[1], before[2]);
    const afterLum = linearLuminance(after[0], after[1], after[2]);
    expect(Math.abs(afterLum - beforeLum)).toBeLessThan(0.02);
  });

  it('never emits non-finite or out-of-range channel values', () => {
    const after = applyColorBalancePixel([1, 1, 1, 127], {
      shadows: { cyanRed: -100, magentaGreen: -100, yellowBlue: -100 },
      midtones: { cyanRed: 100, magentaGreen: 100, yellowBlue: 100 },
      highlights: { cyanRed: 100, magentaGreen: -100, yellowBlue: 100 },
      preserveLuminosity: false,
    });
    expect(
      after
        .slice(0, 3)
        .every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255),
    ).toBe(true);
    expect(after[3]).toBe(127);
  });
});
