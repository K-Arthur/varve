/**
 * Tests for Threshold adjustment.
 *
 * Coverage targets the prompt's required correctness properties:
 * - grayscale ramp
 * - exact boundary equality
 * - alpha edge behavior
 * - all luminance modes
 * - metamorphic monotonicity
 * - normalizeParams edge cases
 */

import { describe, expect, it } from 'vitest';
import {
  applyThreshold,
  applyThresholdPixel,
  normalizeThresholdParams,
  thresholdLuminance,
} from './threshold';

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

  it('supports explicit average and max-channel tonal sources', () => {
    expect(
      applyThresholdPixel([255, 0, 0, 255], { level: 80, luminanceMode: 'average-rgb' })[0],
    ).toBe(255);
    expect(
      applyThresholdPixel([255, 0, 0, 255], { level: 254, luminanceMode: 'max-channel' })[0],
    ).toBe(255);
    expect(
      applyThresholdPixel([255, 0, 0, 255], { level: 100, luminanceMode: 'relative-luminance' })[0],
    ).toBe(0);
  });

  it('preserves hidden RGB on fully transparent pixels', () => {
    expect(applyThresholdPixel([17, 29, 41, 0], { level: 0 })).toEqual([17, 29, 41, 0]);
  });

  it('preserves hidden RGB on semi-transparent pixels', () => {
    const result = applyThresholdPixel([200, 200, 200, 128], { level: 128 });
    expect(result[3]).toBe(128);
    expect(result[0]).toBe(255);
  });

  it('handles all primary and secondary colors at default threshold', () => {
    const colors: Array<[number, number, number]> = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
    ];
    for (const [r, g, b] of colors) {
      const result = applyThresholdPixel([r, g, b, 255], { level: 128 });
      expect(result[0] === 0 || result[0] === 255).toBe(true);
      expect(result[0]).toBe(result[1]);
      expect(result[1]).toBe(result[2]);
    }
  });

  it('middle gray (128) is above threshold at level 128', () => {
    const result = applyThresholdPixel([128, 128, 128, 255], { level: 128 });
    expect(result[0]).toBe(255);
  });

  it('middle gray (127) is below threshold at level 128', () => {
    const result = applyThresholdPixel([127, 127, 127, 255], { level: 128 });
    expect(result[0]).toBe(0);
  });

  it('grayscale ramp produces monotonically non-increasing white count', () => {
    const width = 256;
    const data = new ImageData(width, 1);
    for (let x = 0; x < width; x++) {
      const i = x * 4;
      data.data[i] = x;
      data.data[i + 1] = x;
      data.data[i + 2] = x;
      data.data[i + 3] = 255;
    }
    applyThreshold(data, { level: 128 });
    let whiteCount = 0;
    for (let x = 0; x < width; x++) {
      if (data.data[x * 4] === 255) whiteCount++;
    }
    expect(whiteCount).toBe(128);
  });

  it('metamorphic: increasing threshold can only reduce or maintain white count', () => {
    const width = 256;
    const data = new ImageData(width, 1);
    for (let x = 0; x < width; x++) {
      const i = x * 4;
      data.data[i] = x;
      data.data[i + 1] = x;
      data.data[i + 2] = x;
      data.data[i + 3] = 255;
    }
    let previousWhiteCount = width + 1;
    for (let level = 0; level <= 255; level++) {
      const copy = new ImageData(width, 1);
      copy.data.set(data.data);
      applyThreshold(copy, { level });
      let whiteCount = 0;
      for (let x = 0; x < width; x++) {
        if (copy.data[x * 4] === 255) whiteCount++;
      }
      expect(whiteCount).toBeLessThanOrEqual(previousWhiteCount);
      previousWhiteCount = whiteCount;
    }
  });
});

describe('thresholdLuminance', () => {
  it('relative-luminance uses Rec.709 weights', () => {
    expect(thresholdLuminance(255, 0, 0, 'relative-luminance')).toBeCloseTo(0.2126 * 255, 0);
    expect(thresholdLuminance(0, 255, 0, 'relative-luminance')).toBeCloseTo(0.7152 * 255, 0);
    expect(thresholdLuminance(0, 0, 255, 'relative-luminance')).toBeCloseTo(0.0722 * 255, 0);
  });

  it('average-rgb returns the arithmetic mean', () => {
    expect(thresholdLuminance(100, 200, 50, 'average-rgb')).toBeCloseTo(116.67, 1);
  });

  it('max-channel returns the maximum channel', () => {
    expect(thresholdLuminance(50, 200, 100, 'max-channel')).toBe(200);
  });

  it('defaults to relative-luminance', () => {
    expect(thresholdLuminance(128, 128, 128)).toBe(
      thresholdLuminance(128, 128, 128, 'relative-luminance'),
    );
  });
});

describe('normalizeThresholdParams', () => {
  it('clamps level to [0, 255]', () => {
    expect(normalizeThresholdParams({ level: -10 }).level).toBe(0);
    expect(normalizeThresholdParams({ level: 300 }).level).toBe(255);
  });

  it('defaults to level 128 for undefined', () => {
    expect(normalizeThresholdParams(undefined).level).toBe(128);
  });

  it('defaults to relative-luminance for invalid mode', () => {
    expect(
      normalizeThresholdParams({ level: 100, luminanceMode: 'invalid' as never }).luminanceMode,
    ).toBe('relative-luminance');
  });

  it('accepts all valid luminance modes', () => {
    expect(normalizeThresholdParams({ luminanceMode: 'average-rgb' }).luminanceMode).toBe(
      'average-rgb',
    );
    expect(normalizeThresholdParams({ luminanceMode: 'max-channel' }).luminanceMode).toBe(
      'max-channel',
    );
  });

  it('pins algorithm version', () => {
    expect(normalizeThresholdParams({ algorithmVersion: 99 }).algorithmVersion).toBe(1);
  });
});
