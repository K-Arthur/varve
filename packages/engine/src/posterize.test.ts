/**
 * Tests for Posterize adjustment.
 */

import { describe, expect, it } from 'vitest';
import { applyPosterize } from './posterize';

function makeImageData(w = 4, h = 4): ImageData {
  return new ImageData(w, h);
}

function setPixel(data: ImageData, x: number, y: number, r: number, g: number, b: number, a = 255) {
  const i = (y * data.width + x) * 4;
  data.data[i] = r;
  data.data[i + 1] = g;
  data.data[i + 2] = b;
  data.data[i + 3] = a;
}

function getPixel(data: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * data.width + x) * 4;
  return [data.data[i]!, data.data[i + 1]!, data.data[i + 2]!, data.data[i + 3]!];
}

describe('applyPosterize', () => {
  it('reduces 256 levels to 4 for each channel', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 30, 100, 200, 255);
    applyPosterize(data, { levels: 4 });
    const [r, g, b] = getPixel(data, 0, 0);
    // With 4 levels, step = 255/(4-1) = 85
    // 30 rounds to 0, 100 rounds to 85, 200 rounds to 170
    expect(r).toBe(0);
    expect(g).toBe(85);
    expect(b).toBe(170);
  });

  it('preserves alpha', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 127, 127, 127, 64);
    applyPosterize(data, { levels: 8 });
    expect(getPixel(data, 0, 0)[3]).toBe(64);
  });

  it('does not crash on empty image', () => {
    const data = new ImageData(1, 1);
    expect(() => applyPosterize(data, { levels: 4 })).not.toThrow();
  });

  it('levels=2 produces binary output (0 or 255)', () => {
    const data = makeImageData(4, 1);
    setPixel(data, 0, 0, 0, 0, 0, 255);
    setPixel(data, 1, 0, 100, 100, 100, 255);
    setPixel(data, 2, 0, 200, 200, 200, 255);
    setPixel(data, 3, 0, 255, 255, 255, 255);
    applyPosterize(data, { levels: 2 });
    for (let x = 0; x < 4; x++) {
      const [r, g, b] = getPixel(data, x, 0);
      expect(r).toBe(g);
      expect(g).toBe(b);
      expect(r === 0 || r === 255).toBe(true);
    }
  });

  it('levels=256 is a no-op', () => {
    const data = makeImageData(2, 2);
    for (let i = 0; i < data.data.length; i++) {
      data.data[i] = (i * 17) % 256;
    }
    const before = [...data.data];
    applyPosterize(data, { levels: 256 });
    expect([...data.data]).toEqual(before);
  });
});
