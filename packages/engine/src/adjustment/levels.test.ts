// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { applyLevels, buildLevelsLUT } from './levels';

function makeTestImageData(
  pixels: [number, number, number, number][],
  w: number,
  h: number,
): ImageData {
  const data = new ImageData(w, h);
  for (let i = 0; i < pixels.length; i++) {
    const off = i * 4;
    const px = pixels[i]!;
    data.data[off] = px[0];
    data.data[off + 1] = px[1];
    data.data[off + 2] = px[2];
    data.data[off + 3] = px[3];
  }
  return data;
}

describe('buildLevelsLUT', () => {
  it('produces identity with default params', () => {
    const lut = buildLevelsLUT({});
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeCloseTo(i, 0);
    }
  });

  it('clamps input black point', () => {
    const lut = buildLevelsLUT({ inputBlack: 50 });
    expect(lut[0]).toBe(0);
    expect(lut[25]).toBe(0);
    expect(lut[50]).toBeCloseTo(0, 0);
    expect(lut[255]).toBe(255);
  });

  it('clamps input white point', () => {
    const lut = buildLevelsLUT({ inputWhite: 200 });
    expect(lut[200]).toBe(255);
    expect(lut[255]).toBe(255);
  });

  it('maps output range', () => {
    const lut = buildLevelsLUT({ outputBlack: 25, outputWhite: 230 });
    expect(lut[0]).toBe(25);
    expect(lut[255]).toBe(230);
  });

  it('gamma correction affects midtones', () => {
    const gamma2 = buildLevelsLUT({ gamma: 2 });
    const gamma05 = buildLevelsLUT({ gamma: 0.5 });
    expect(gamma2[128]).toBeGreaterThan(128);
    expect(gamma05[128]).toBeLessThan(128);
  });

  it('handles edge case: all extremes', () => {
    const lut = buildLevelsLUT({ inputBlack: 100, inputWhite: 150, gamma: 0.1 });
    expect(lut[100]).toBeGreaterThanOrEqual(0);
    expect(lut[255]).toBeLessThanOrEqual(255);
  });

  it('handles edge case: input inverted', () => {
    const lut = buildLevelsLUT({ inputBlack: 200, inputWhite: 50 });
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBeGreaterThanOrEqual(0);
      expect(lut[i]).toBeLessThanOrEqual(255);
    }
  });
});

describe('applyLevels', () => {
  it('stretches contrast over full range', () => {
    const src = makeTestImageData(
      [
        [50, 60, 70, 255],
        [200, 210, 220, 255],
      ],
      2,
      1,
    );
    const result = applyLevels(src, 'rgb', { inputBlack: 50, inputWhite: 200 });
    expect(result.data[0]).toBe(0);
    expect(result.data[4]).toBe(255);
  });

  it('applies red channel only', () => {
    const src = makeTestImageData([[100, 150, 200, 255]], 1, 1);
    const result = applyLevels(src, 'red', { outputBlack: 0, outputWhite: 0 });
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it('preserves alpha', () => {
    const src = makeTestImageData([[100, 100, 100, 128]], 1, 1);
    const result = applyLevels(src, 'rgb', {});
    expect(result.data[3]).toBe(128);
  });

  it('handles single pixel', () => {
    const src = makeTestImageData([[128, 128, 128, 255]], 1, 1);
    const result = applyLevels(src, 'rgb', {});
    expect(result.data[0]).toBe(128);
  });
});
