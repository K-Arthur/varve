import { describe, expect, it } from 'vitest';
import {
  adaptiveThreshold,
  DEFAULT_PREPARE_OPTIONS,
  prepareImageData,
  removeBorderConnectedBackground,
} from './prepareSource';
import { DEFAULT_VECTORIZATION_SETTINGS } from './settings';

function solid(width: number, height: number, rgba: [number, number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return new ImageData(data, width, height);
}

function pixel(data: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * data.width + x) * 4;
  return [
    data.data[i] as number,
    data.data[i + 1] as number,
    data.data[i + 2] as number,
    data.data[i + 3] as number,
  ];
}

describe('removeBorderConnectedBackground', () => {
  it('removes border-connected white but keeps enclosed white counters', () => {
    const image = solid(5, 5, [255, 255, 255, 255]);
    // Dark ring (1..3 border) with a white center counter.
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 3; x += 1) {
        if (x === 2 && y === 2) continue;
        const i = (y * 5 + x) * 4;
        image.data[i] = 0;
        image.data[i + 1] = 0;
        image.data[i + 2] = 0;
      }
    }

    const out = removeBorderConnectedBackground(image);
    expect(pixel(out, 0, 0)[3]).toBe(0);
    expect(pixel(out, 2, 2)[3]).toBe(255);
    expect(pixel(out, 2, 1)[3]).toBe(255);
    expect(out).not.toBe(image);
  });

  it('does not mutate the input and returns it untouched when nothing qualifies', () => {
    const image = solid(2, 2, [10, 20, 30, 255]);
    const before = new Uint8ClampedArray(image.data);
    const out = removeBorderConnectedBackground(image);
    expect(out).toBe(image);
    expect(image.data).toEqual(before);
  });

  it('leaves a dark background alone when the border is not near-white', () => {
    const image = solid(3, 3, [20, 20, 20, 255]);
    const out = removeBorderConnectedBackground(image);
    expect(pixel(out, 0, 0)[3]).toBe(255);
  });
});

describe('adaptiveThreshold', () => {
  it('detects a dark mark against an uneven bright background', () => {
    const width = 24;
    const height = 24;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        // Uneven illumination: left is 140, right is 250.
        const background = Math.round(140 + (x / (width - 1)) * 110);
        const dark = x >= 8 && x <= 14 && y >= 8 && y <= 14;
        const value = dark ? 40 : background;
        const i = (y * width + x) * 4;
        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }
    }
    const source = new ImageData(data, width, height);
    const out = adaptiveThreshold(source, 0, 12);
    expect(pixel(out, 11, 11)[0]).toBe(0);
    expect(pixel(out, 1, 1)[0]).toBe(255);
    expect(pixel(out, 22, 22)[0]).toBe(255);
  });

  it('is deterministic for the same input and window', () => {
    const source = solid(12, 12, [180, 180, 180, 255]);
    const a = adaptiveThreshold(source, 5, 15);
    const b = adaptiveThreshold(source, 5, 15);
    expect(a.data).toEqual(b.data);
  });
});

describe('prepareImageData', () => {
  it('uses the trace threshold for the fixed binarize stage', () => {
    const source = solid(2, 1, [140, 140, 140, 255]);
    const prep = {
      ...DEFAULT_VECTORIZATION_SETTINGS.prep,
      threshold: true,
      removeBackground: false,
    };
    const below = prepareImageData(source, prep, { threshold: 200, alphaThreshold: 1 });
    const above = prepareImageData(source, prep, { threshold: 100, alphaThreshold: 1 });
    expect(pixel(below, 0, 0)[0]).toBe(0);
    expect(pixel(above, 0, 0)[0]).toBe(255);
  });

  it('returns the input unchanged for an identity stack', () => {
    const source = solid(2, 1, [1, 2, 3, 255]);
    const identity = {
      ...DEFAULT_VECTORIZATION_SETTINGS.prep,
      removeBackground: false,
    };
    expect(prepareImageData(source, identity, DEFAULT_PREPARE_OPTIONS)).toBe(source);
  });

  it('honors adaptive threshold over the fixed threshold', () => {
    const source = solid(8, 8, [200, 200, 200, 255]);
    const prep = {
      ...DEFAULT_VECTORIZATION_SETTINGS.prep,
      threshold: true,
      adaptiveThreshold: true,
      adaptiveWindow: 3,
      adaptiveSensitivity: 10,
      removeBackground: false,
    };
    const out = prepareImageData(source, prep, { threshold: 250, alphaThreshold: 1 });
    // Uniform gray cannot be below the local mean, so adaptive output is white.
    expect(pixel(out, 4, 4)[0]).toBe(255);
  });
});
