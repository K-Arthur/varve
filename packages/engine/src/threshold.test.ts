/**
 * Tests for Threshold adjustment.
 */

import { describe, expect, it } from 'vitest';
import { applyThreshold } from './threshold';

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

describe('applyThreshold', () => {
  it('converts dark pixels to black', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 50, 50, 50, 255);
    applyThreshold(data, { level: 128 });
    const [r, g, b] = getPixel(data, 0, 0);
    expect(r).toBe(0);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it('converts bright pixels to white', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 200, 200, 200, 255);
    applyThreshold(data, { level: 128 });
    const [r, g, b] = getPixel(data, 0, 0);
    expect(r).toBe(255);
    expect(g).toBe(255);
    expect(b).toBe(255);
  });

  it('preserves alpha', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 100, 100, 100, 64);
    applyThreshold(data, { level: 128 });
    expect(getPixel(data, 0, 0)[3]).toBe(64);
  });

  it('does not crash on empty image', () => {
    const data = new ImageData(1, 1);
    expect(() => applyThreshold(data, { level: 128 })).not.toThrow();
  });

  it('level=0 makes everything white', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 0, 0, 0, 255);
    setPixel(data, 1, 0, 1, 1, 1, 255);
    applyThreshold(data, { level: 0 });
    for (let x = 0; x < 2; x++) {
      expect(getPixel(data, x, 0)[0]).toBe(255);
    }
  });

  it('level=255 makes everything black', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 254, 254, 254, 255);
    setPixel(data, 1, 0, 255, 255, 255, 255);
    applyThreshold(data, { level: 255 });
    expect(getPixel(data, 0, 0)[0]).toBe(0);
    expect(getPixel(data, 1, 0)[0]).toBe(255);
  });

  it('produces binary output (only 0 or 255)', () => {
    const data = makeImageData(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        setPixel(data, x, y, (x * y * 42) % 256, 0, 0, 255);
      }
    }
    applyThreshold(data, { level: 128 });
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const [r, g, b] = getPixel(data, x, y);
        expect(r).toBe(g);
        expect(g).toBe(b);
        expect(r === 0 || r === 255).toBe(true);
      }
    }
  });
});
