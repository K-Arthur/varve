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

  it('shadow adjustment affects dark pixels more than bright pixels', () => {
    const dark = applyColorBalancePixel([30, 30, 30, 255], {
      ...identity,
      shadows: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
    });
    const bright = applyColorBalancePixel([220, 220, 220, 255], {
      ...identity,
      shadows: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
    });
    expect(dark[0] - 30).toBeGreaterThan(bright[0] - 220);
  });

  it('highlight adjustment affects bright pixels more than dark pixels', () => {
    const bright = applyColorBalancePixel([220, 220, 220, 255], {
      ...identity,
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 100 },
    });
    const dark = applyColorBalancePixel([30, 30, 30, 255], {
      ...identity,
      highlights: { cyanRed: 0, magentaGreen: 0, yellowBlue: 100 },
    });
    expect(bright[2] - 220).toBeGreaterThan(dark[2] - 30);
  });

  it('midtone adjustment peaks in the middle range', () => {
    const mid = applyColorBalancePixel([128, 128, 128, 255], {
      ...identity,
      midtones: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
    });
    const dark = applyColorBalancePixel([20, 20, 20, 255], {
      ...identity,
      midtones: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
    });
    const bright = applyColorBalancePixel([235, 235, 235, 255], {
      ...identity,
      midtones: { cyanRed: 100, magentaGreen: 0, yellowBlue: 0 },
    });
    const midDelta = mid[0] - 128;
    expect(midDelta).toBeGreaterThan(0);
    expect(midDelta).toBeGreaterThan(dark[0] - 20);
    expect(midDelta).toBeGreaterThan(bright[0] - 235);
  });

  it('small positive and negative adjustments approximately cancel', () => {
    const base: [number, number, number, number] = [128, 128, 128, 255];
    const up = applyColorBalancePixel(base, {
      ...identity,
      midtones: { cyanRed: 20, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
    });
    const down = applyColorBalancePixel(up, {
      ...identity,
      midtones: { cyanRed: -20, magentaGreen: 0, yellowBlue: 0 },
      preserveLuminosity: false,
    });
    expect(Math.abs(down[0] - 128)).toBeLessThan(3);
  });

  it('all nine values produce a different result than identity', () => {
    const result = applyColorBalancePixel([150, 100, 80, 255], {
      shadows: { cyanRed: 30, magentaGreen: -20, yellowBlue: 15 },
      midtones: { cyanRed: -10, magentaGreen: 25, yellowBlue: -30 },
      highlights: { cyanRed: 40, magentaGreen: -15, yellowBlue: 20 },
      preserveLuminosity: true,
    });
    expect(result[0]).not.toBe(150);
    expect(result[1]).not.toBe(100);
    expect(result[2]).not.toBe(80);
  });

  it('preserves alpha at various levels', () => {
    for (const alpha of [0, 1, 127, 254, 255]) {
      const result = applyColorBalancePixel([128, 128, 128, alpha], {
        ...identity,
        midtones: { cyanRed: 50, magentaGreen: 0, yellowBlue: 0 },
      });
      expect(result[3]).toBe(alpha);
    }
  });

  it('handles near-black pixels without NaN', () => {
    const result = applyColorBalancePixel([1, 1, 1, 255], {
      ...identity,
      shadows: { cyanRed: -100, magentaGreen: -100, yellowBlue: -100 },
      preserveLuminosity: true,
    });
    expect(result.every((c) => Number.isFinite(c))).toBe(true);
  });

  it('handles near-white pixels without overflow', () => {
    const result = applyColorBalancePixel([254, 254, 254, 255], {
      ...identity,
      highlights: { cyanRed: 100, magentaGreen: 100, yellowBlue: 100 },
      preserveLuminosity: true,
    });
    expect(result.every((c) => c >= 0 && c <= 255)).toBe(true);
  });
});

describe('colorBalanceTonalWeights', () => {
  it('at black (0), shadows dominate completely', () => {
    const w = colorBalanceTonalWeights(0);
    expect(w.shadows).toBe(1);
    expect(w.midtones).toBe(0);
    expect(w.highlights).toBe(0);
  });

  it('at middle gray (0.5), midtones dominate completely', () => {
    const w = colorBalanceTonalWeights(0.5);
    expect(w.shadows).toBe(0);
    expect(w.midtones).toBe(1);
    expect(w.highlights).toBe(0);
  });

  it('at white (1), highlights dominate completely', () => {
    const w = colorBalanceTonalWeights(1);
    expect(w.shadows).toBe(0);
    expect(w.midtones).toBe(0);
    expect(w.highlights).toBe(1);
  });

  it('weights always sum to 1', () => {
    for (let l = 0; l <= 1; l += 0.05) {
      const w = colorBalanceTonalWeights(l);
      expect(w.shadows + w.midtones + w.highlights).toBeCloseTo(1, 12);
    }
  });

  it('no weight is ever negative', () => {
    for (let l = -0.1; l <= 1.1; l += 0.05) {
      const w = colorBalanceTonalWeights(l);
      expect(w.shadows).toBeGreaterThanOrEqual(0);
      expect(w.midtones).toBeGreaterThanOrEqual(0);
      expect(w.highlights).toBeGreaterThanOrEqual(0);
    }
  });
});
