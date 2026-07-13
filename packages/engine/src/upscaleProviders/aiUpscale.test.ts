// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { copyUpscaledTileCore, packRgbChw } from './aiUpscale';

describe('Real-ESRGAN worker helpers', () => {
  it('packs RGB pixels as normalized NCHW planes', () => {
    const image = new ImageData(new Uint8ClampedArray([255, 128, 0, 17, 0, 64, 255, 255]), 2, 1);

    expect([...packRgbChw(image)]).toEqual([
      1,
      0,
      expect.closeTo(128 / 255, 6),
      expect.closeTo(64 / 255, 6),
      0,
      1,
    ]);
  });

  it('clears hidden RGB from fully transparent pixels before inference', () => {
    const image = new ImageData(new Uint8ClampedArray([255, 128, 64, 0]), 1, 1);
    expect([...packRgbChw(image)]).toEqual([0, 0, 0]);
  });

  it('copies only a tile core so padded overlaps cannot create seams', () => {
    const destination = new Uint8ClampedArray(4 * 4 * 4);
    const tileRgb = new Float32Array(6 * 6 * 3);
    const plane = 6 * 6;
    tileRgb.fill(0.25, 0, plane);
    tileRgb.fill(0.5, plane, plane * 2);
    tileRgb.fill(1, plane * 2);

    copyUpscaledTileCore({
      destination,
      destinationWidth: 4,
      tileRgb,
      tileWidth: 6,
      sourceCoreX: 1,
      sourceCoreY: 1,
      coreWidth: 4,
      coreHeight: 4,
      destinationX: 0,
      destinationY: 0,
    });

    expect([...destination.slice(0, 4)]).toEqual([64, 128, 255, 255]);
    expect(destination.every((value, index) => index % 4 === 3 || value > 0)).toBe(true);
  });
});
