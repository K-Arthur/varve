import { describe, expect, it } from 'vitest';

import { maskCoverageFromPixel, maskFromImageData } from './maskOps';

function imageDataFrom(pixels: Array<[number, number, number, number]>): ImageData {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { width: pixels.length, height: 1, data } as unknown as ImageData;
}

describe('maskCoverageFromPixel', () => {
  it('reads the all-channel encoding through alpha', () => {
    // maskToDataUrl writers: R=G=B=A=coverage.
    expect(maskCoverageFromPixel(128, 128)).toBe(128);
    expect(maskCoverageFromPixel(255, 255)).toBe(255);
    expect(maskCoverageFromPixel(0, 0)).toBe(0);
  });

  it('reads the white-RGB plus alpha encoding from alpha', () => {
    // Depth workflow writer: white RGB with coverage only in alpha. The
    // previous red-only read reported full coverage for partial masks and
    // let "Refine edges" destroy a committed depth mask.
    expect(maskCoverageFromPixel(255, 0)).toBe(0);
    expect(maskCoverageFromPixel(255, 64)).toBe(64);
    expect(maskCoverageFromPixel(255, 255)).toBe(255);
  });

  it('reads the legacy RGB-only encoding (alpha=255) from red', () => {
    expect(maskCoverageFromPixel(200, 255)).toBe(200);
    expect(maskCoverageFromPixel(0, 255)).toBe(0);
  });

  it('never changes a dark-RGB mask with real alpha coverage', () => {
    expect(maskCoverageFromPixel(0, 255)).toBe(0);
    expect(maskCoverageFromPixel(96, 240)).toBe(96);
  });
});

describe('maskFromImageData', () => {
  it('decodes mixed encodings pixel-by-pixel', () => {
    const image = imageDataFrom([
      [255, 255, 255, 0], // white RGB, empty alpha (depth) -> 0
      [255, 255, 255, 128], // white RGB, partial alpha (depth) -> 128
      [64, 64, 64, 64], // all-channel coverage -> 64
      [180, 180, 180, 255], // legacy RGB-only -> 180
      [0, 0, 0, 255], // dark opaque -> 0
    ]);
    expect(Array.from(maskFromImageData(image))).toEqual([0, 128, 64, 180, 0]);
  });
});
