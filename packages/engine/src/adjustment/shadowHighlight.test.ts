// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { applyShadowHighlight } from './shadowHighlight';

function image(...pixels: [number, number, number, number][]): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((pixel, index) => data.set(pixel, index * 4));
  return new ImageData(data, pixels.length, 1);
}

describe('applyShadowHighlight', () => {
  it('recovers shadows and suppresses highlights while preserving alpha', () => {
    const source = image([20, 30, 40, 255], [230, 220, 210, 128]);
    applyShadowHighlight(source, {
      shadows: 80,
      highlights: 80,
      tonalWidth: 50,
      midpoint: 50,
    });

    expect(source.data[0]).toBeGreaterThan(20);
    expect(source.data[1]).toBeGreaterThan(30);
    expect(source.data[2]).toBeGreaterThan(40);
    expect(source.data[4]).toBeLessThan(230);
    expect(source.data[5]).toBeLessThan(220);
    expect(source.data[6]).toBeLessThan(210);
    expect(source.data[3]).toBe(255);
    expect(source.data[7]).toBe(128);
  });

  it('leaves identity parameters and hidden RGB untouched', () => {
    const source = image([12, 34, 56, 255], [200, 10, 90, 0]);
    const before = Array.from(source.data);
    applyShadowHighlight(source, { shadows: 0, highlights: 0, tonalWidth: 50, midpoint: 50 });
    expect(Array.from(source.data)).toEqual(before);
  });
});
