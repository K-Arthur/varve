/**
 * Tests for Black & White adjustment.
 */

import { describe, expect, it } from 'vitest';
import { applyBlackAndWhite } from './blackAndWhite';

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

describe('applyBlackAndWhite', () => {
  it('converts a colourful pixel to grayscale', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 200, 50, 50, 255);
    applyBlackAndWhite(data, {
      reds: 40,
      yellows: 60,
      greens: 40,
      cyans: 60,
      blues: 20,
      magentas: 80,
      brightness: 0,
      preserveLuminosity: true,
    });
    const [r, g, b] = getPixel(data, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('preserves alpha', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 100, 150, 200, 64);
    applyBlackAndWhite(data, {
      reds: 40,
      yellows: 60,
      greens: 40,
      cyans: 60,
      blues: 20,
      magentas: 80,
      brightness: 0,
      preserveLuminosity: true,
    });
    expect(getPixel(data, 0, 0)[3]).toBe(64);
  });

  it('does not crash on empty image', () => {
    const data = new ImageData(1, 1);
    expect(() =>
      applyBlackAndWhite(data, {
        reds: 40,
        yellows: 60,
        greens: 40,
        cyans: 60,
        blues: 20,
        magentas: 80,
        brightness: 0,
        preserveLuminosity: true,
      }),
    ).not.toThrow();
  });

  it('fully red pixel with reds=100 gives near-white output', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 255, 0, 0, 255);
    applyBlackAndWhite(data, {
      reds: 200,
      yellows: 0,
      greens: 0,
      cyans: 0,
      blues: 0,
      magentas: 0,
      brightness: 0,
      preserveLuminosity: true,
    });
    const [r] = getPixel(data, 0, 0);
    expect(r).toBeGreaterThan(180);
  });

  it('brightness offset shifts the result', () => {
    const data1 = makeImageData(1, 1);
    setPixel(data1, 0, 0, 128, 128, 128, 255);
    applyBlackAndWhite(data1, {
      reds: 40,
      yellows: 60,
      greens: 40,
      cyans: 60,
      blues: 20,
      magentas: 80,
      brightness: 50,
      preserveLuminosity: true,
    });
    const bright = getPixel(data1, 0, 0)[0];

    const data2 = makeImageData(1, 1);
    setPixel(data2, 0, 0, 128, 128, 128, 255);
    applyBlackAndWhite(data2, {
      reds: 40,
      yellows: 60,
      greens: 40,
      cyans: 60,
      blues: 20,
      magentas: 80,
      brightness: -50,
      preserveLuminosity: true,
    });
    const dark = getPixel(data2, 0, 0)[0];

    expect(bright).toBeGreaterThan(dark);
  });

  it('tint color applies correctly with preserveLuminosity', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 128, 128, 128, 255);
    applyBlackAndWhite(data, {
      reds: 40,
      yellows: 60,
      greens: 40,
      cyans: 60,
      blues: 20,
      magentas: 80,
      brightness: 0,
      tintColor: [255, 0, 0, 255],
      preserveLuminosity: true,
    });
    const [, g, b] = getPixel(data, 0, 0);
    // Green and blue should be near zero since tint is red
    expect(g).toBeLessThan(10);
    expect(b).toBeLessThan(10);
  });
});
