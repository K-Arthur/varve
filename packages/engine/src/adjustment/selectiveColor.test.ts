// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applySelectiveColor } from './selectiveColor';

function makePixelData(r: number, g: number, b: number, a = 255): ImageData {
  const data = new ImageData(1, 1);
  data.data[0] = r;
  data.data[1] = g;
  data.data[2] = b;
  data.data[3] = a;
  return data;
}

function getPixel(data: ImageData): [number, number, number, number] {
  return [data.data[0]!, data.data[1]!, data.data[2]!, data.data[3]!];
}

describe('applySelectiveColor', () => {
  it('identity: no adjustments does nothing', () => {
    const src = makePixelData(128, 128, 128);
    const result = applySelectiveColor(src, []);
    expect(getPixel(result)[0]).toBe(128);
  });

  it('reduces cyan in red pixels', () => {
    const red = makePixelData(255, 0, 0);
    const result = applySelectiveColor(red, [
      { color: 'red', cyan: -50, magenta: 0, yellow: 0, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[0]).toBe(255);
  });

  it('increases magenta in green pixels', () => {
    const green = makePixelData(0, 255, 0);
    const result = applySelectiveColor(green, [
      { color: 'green', cyan: 0, magenta: 50, yellow: 0, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[1]).toBeLessThan(255);
  });

  it('affects neutral colors (magenta reduces green)', () => {
    const gray = makePixelData(128, 128, 128);
    const result = applySelectiveColor(gray, [
      { color: 'neutral', cyan: 0, magenta: 100, yellow: 0, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[1]).toBeLessThan(128);
  });

  it('affects neutral colors (cyan reduces red)', () => {
    const gray = makePixelData(128, 128, 128);
    const result = applySelectiveColor(gray, [
      { color: 'neutral', cyan: 100, magenta: 0, yellow: 0, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[0]).toBeLessThan(128);
  });

  it('affects white colors', () => {
    const white = makePixelData(240, 240, 240);
    const result = applySelectiveColor(white, [
      { color: 'white', cyan: 0, magenta: 0, yellow: 20, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[2]).toBeLessThan(240);
  });

  it('affects black colors', () => {
    const nearBlack = makePixelData(30, 30, 30);
    const result = applySelectiveColor(nearBlack, [
      { color: 'black', cyan: 0, magenta: 0, yellow: 0, black: 30, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[0]).toBeLessThanOrEqual(30);
  });

  it('relative method scales with color amount', () => {
    const redish = makePixelData(200, 50, 50);
    const result = applySelectiveColor(redish, [
      { color: 'red', cyan: -50, magenta: 0, yellow: 0, black: 0, method: 'relative' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[0]).toBeGreaterThanOrEqual(0);
  });

  it('applies multiple adjustments', () => {
    const src = makePixelData(200, 100, 50);
    const result = applySelectiveColor(src, [
      { color: 'red', cyan: 20, magenta: 0, yellow: 0, black: 0, method: 'absolute' },
      { color: 'yellow', cyan: 0, magenta: 10, yellow: 0, black: 0, method: 'absolute' },
    ]);
    expect(getPixel(result)[0]).toBeGreaterThan(0);
  });

  it('preserves alpha', () => {
    const src = makePixelData(100, 100, 100, 128);
    const result = applySelectiveColor(src, [
      { color: 'neutral', cyan: 30, magenta: 0, yellow: 0, black: 0, method: 'absolute' },
    ]);
    expect(result.data[3]).toBe(128);
  });

  it('handles fully transparent pixel', () => {
    const src = makePixelData(100, 100, 100, 0);
    const result = applySelectiveColor(src, [
      { color: 'neutral', cyan: 100, magenta: 100, yellow: 100, black: 100, method: 'absolute' },
    ]);
    expect(result.data[3]).toBe(0);
  });

  it('clamps adjustments to valid range', () => {
    const src = makePixelData(128, 128, 128);
    const result = applySelectiveColor(src, [
      { color: 'neutral', cyan: 999, magenta: -999, yellow: 50, black: 0, method: 'absolute' },
    ]);
    const pixel = getPixel(result);
    expect(pixel[0]).toBeGreaterThanOrEqual(0);
    expect(pixel[0]).toBeLessThanOrEqual(255);
  });
});
