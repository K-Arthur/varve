// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildCurveLUT, applyCurve } from './curves';

function makeTestImageData(
  pixels: [number, number, number, number][],
  w: number,
  h: number,
): ImageData {
  const data = new ImageData(w, h);
  for (let i = 0; i < pixels.length; i++) {
    const off = i * 4;
    data.data[off] = pixels[i]![0];
    data.data[off + 1] = pixels[i]![1];
    data.data[off + 2] = pixels[i]![2];
    data.data[off + 3] = pixels[i]![3];
  }
  return data;
}

describe('buildCurveLUT', () => {
  it('returns identity for empty points', () => {
    const lut = buildCurveLUT([]);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it('returns identity for two-point identity line', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]);
    for (let i = 0; i < 256; i++) {
      expect(lut[i]).toBe(i);
    }
  });

  it('inverts image with flipped endpoints', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]);
    expect(lut[0]).toBe(255);
    expect(lut[255]).toBe(0);
    expect(lut[128]).toBeCloseTo(127, -1);
  });

  it('increases contrast with S-curve', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 0.25, y: 0.1 },
      { x: 0.75, y: 0.9 },
      { x: 1, y: 1 },
    ]);
    expect(lut[64]).toBeLessThan(64);
    expect(lut[192]).toBeGreaterThan(192);
  });

  it('clamps output to [0, 255]', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 1 },
    ]);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});

describe('applyCurve', () => {
  it('applies RGB curve to all channels', () => {
    const src = makeTestImageData(
      [
        [100, 150, 200, 255],
        [50, 100, 150, 255],
      ],
      2,
      1,
    );
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.3 },
      { x: 1, y: 1 },
    ]);
    const result = applyCurve(src, 'rgb', lut);
    expect(result.data[0]).toBeLessThan(100);
    expect(result.data[1]).toBeLessThan(150);
    expect(result.data[2]).toBeLessThan(200);
  });

  it('applies red channel only', () => {
    const src = makeTestImageData([[100, 150, 200, 255]], 1, 1);
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ]);
    const result = applyCurve(src, 'red', lut);
    expect(result.data[0]).toBe(0);
    expect(result.data[1]).toBe(150);
    expect(result.data[2]).toBe(200);
  });

  it('preserves alpha', () => {
    const src = makeTestImageData([[100, 100, 100, 50]], 1, 1);
    const lut = buildCurveLUT([]);
    const result = applyCurve(src, 'rgb', lut);
    expect(result.data[3]).toBe(50);
  });

  it('handles single pixel edge case', () => {
    const src = makeTestImageData([[128, 128, 128, 255]], 1, 1);
    const lut = buildCurveLUT([]);
    const result = applyCurve(src, 'rgb', lut);
    expect(result.data[0]).toBe(128);
  });

  it('clamps extrapolated values', () => {
    const lut = buildCurveLUT([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]);
    expect(lut[255]).toBe(255);
    expect(lut[0]).toBe(0);
  });
});
