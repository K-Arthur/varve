import { describe, expect, it } from 'vitest';
import { combineLabToImageData } from './colorSpace';

describe('combineLabToImageData', () => {
  it('preserves transparent source RGB instead of recoloring hidden pixels', () => {
    const source = new Uint8ClampedArray([12, 34, 56, 0]);
    const result = combineLabToImageData(
      source,
      1,
      1,
      new Float32Array([80]),
      new Float32Array([80]),
      1,
    );
    expect(Array.from(result.data)).toEqual([12, 34, 56, 0]);
  });

  it('rejects short or non-finite chroma planes', () => {
    const source = new Uint8ClampedArray([128, 128, 128, 255]);
    expect(() =>
      combineLabToImageData(source, 1, 1, new Float32Array(), new Float32Array([0]), 1),
    ).toThrow('shorter');
    expect(() =>
      combineLabToImageData(source, 1, 1, new Float32Array([Number.NaN]), new Float32Array([0]), 1),
    ).toThrow('non-finite');
  });
});
