/**
 * Tests for duotone tonal mapping.
 */

import { describe, expect, it } from 'vitest';
import { applyDuotone, buildDuotoneLut } from './duotone';

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

describe('buildDuotoneLut', () => {
  it('produces a 256-entry RGBA LUT', () => {
    const lut = buildDuotoneLut({
      shadowColor: [0, 0, 0, 255],
      highlightColor: [255, 255, 255, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 1,
      preserveLuminosity: false,
    });
    expect(lut.length).toBe(256 * 4);
  });

  it('shadow luminance maps to shadow colour', () => {
    const lut = buildDuotoneLut({
      shadowColor: [50, 100, 150, 255],
      highlightColor: [255, 220, 180, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 1,
      preserveLuminosity: false,
    });
    expect(lut[0]).toBe(50);
    expect(lut[1]).toBe(100);
    expect(lut[2]).toBe(150);
  });

  it('highlight luminance maps to highlight colour', () => {
    const lut = buildDuotoneLut({
      shadowColor: [50, 100, 150, 255],
      highlightColor: [255, 220, 180, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 1,
      preserveLuminosity: false,
    });
    const idx = 255 * 4;
    expect(lut[idx]).toBe(255);
    expect(lut[idx + 1]).toBe(220);
    expect(lut[idx + 2]).toBe(180);
  });
});

describe('applyDuotone', () => {
  it('preserves alpha', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 100, 100, 100, 255);
    setPixel(data, 0, 1, 50, 50, 50, 128);
    applyDuotone(data, {
      shadowColor: [0, 0, 0, 255],
      highlightColor: [255, 255, 255, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 1,
      preserveLuminosity: false,
    });
    expect(getPixel(data, 0, 1)[3]).toBe(128);
  });

  it('does not crash on empty image', () => {
    const data = new ImageData(1, 1);
    expect(() =>
      applyDuotone(data, {
        shadowColor: [0, 0, 0, 255],
        highlightColor: [255, 255, 255, 255],
        shadowPoint: 0.25,
        highlightPoint: 0.75,
        intensity: 0.5,
        preserveLuminosity: false,
      }),
    ).not.toThrow();
  });

  it('at intensity 0 leaves image unchanged', () => {
    const data = makeImageData(2, 2);
    setPixel(data, 0, 0, 120, 80, 200, 255);
    const before = [...data.data];
    applyDuotone(data, {
      shadowColor: [255, 0, 0, 255],
      highlightColor: [0, 255, 0, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 0,
      preserveLuminosity: false,
    });
    expect([...data.data]).toEqual(before);
  });

  it('preserveLuminosity maintains input luminance approximately', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 180, 180, 180, 255);
    const inputLum = 0.2126 * 180 + 0.7152 * 180 + 0.0722 * 180;
    applyDuotone(data, {
      shadowColor: [80, 80, 80, 255],
      highlightColor: [200, 200, 200, 255],
      shadowPoint: 0.25,
      highlightPoint: 0.75,
      intensity: 1,
      preserveLuminosity: true,
    });
    const [r, g, b] = getPixel(data, 0, 0);
    const outLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Near-neutral duotone colors should preserve luminance within ~3
    expect(Math.abs(outLum - inputLum)).toBeLessThan(3);
  });

  it('linear interpolation maps midpoint to average of two colours', () => {
    const data = makeImageData(1, 1);
    setPixel(data, 0, 0, 127, 127, 127, 255);
    applyDuotone(data, {
      shadowColor: [0, 0, 0, 255],
      highlightColor: [100, 200, 50, 255],
      shadowPoint: 0,
      highlightPoint: 1,
      intensity: 1,
      preserveLuminosity: false,
      interpolation: 'linear',
    });
    const [r, g] = getPixel(data, 0, 0);
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(60);
    expect(g).toBeGreaterThan(80);
    expect(g).toBeLessThan(120);
  });
});
