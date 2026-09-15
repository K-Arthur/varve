import { describe, expect, it } from 'vitest';
import { combineChromaAtSourceResolution, combineLabToImageData } from './colorSpace';

describe('combineLabToImageData', () => {
  it('preserves transparent source RGB instead of recoloring hidden pixels', () => {
    const source = new Uint8ClampedArray([12, 34, 56, 0]);
    const result = combineLabToImageData(
      source,
      1,
      1,
      new Float32Array([80]),
      new Float32Array([80]),
    );
    expect(Array.from(result.data)).toEqual([12, 34, 56, 0]);
  });

  it('rejects short or non-finite chroma planes', () => {
    const source = new Uint8ClampedArray([128, 128, 128, 255]);
    expect(() =>
      combineLabToImageData(source, 1, 1, new Float32Array(), new Float32Array([0])),
    ).toThrow('shorter');
    expect(() =>
      combineLabToImageData(source, 1, 1, new Float32Array([Number.NaN]), new Float32Array([0])),
    ).toThrow('non-finite');
  });
});

describe('combineChromaAtSourceResolution', () => {
  it('resizes cached chroma to the full source and keeps source alpha', () => {
    const source = new ImageData(
      new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 0]),
      2,
      1,
    );
    const result = combineChromaAtSourceResolution(source, {
      a: new Float32Array([40]),
      b: new Float32Array([50]),
      width: 1,
      height: 1,
    });
    expect(result.width).toBe(2);
    expect(result.height).toBe(1);
    expect(result.data[3]).toBe(255);
    expect(result.data[7]).toBe(0);
    // Chroma is applied to the opaque pixel: the output must be tinted
    // (larger a*/b* than the neutral source).
    expect(result.data[0]).not.toBe(result.data[1]);
  });

  it('uses the identity path when chroma already matches the source size', () => {
    const source = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const result = combineChromaAtSourceResolution(source, {
      a: new Float32Array([40]),
      b: new Float32Array([50]),
      width: 1,
      height: 1,
    });
    expect(result.width).toBe(1);
    expect(result.data[3]).toBe(255);
  });

  it('rejects malformed cached chroma', () => {
    const source = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    expect(() =>
      combineChromaAtSourceResolution(source, {
        a: new Float32Array(0),
        b: new Float32Array(1),
        width: 1,
        height: 1,
      }),
    ).toThrow('shorter');
    expect(() =>
      combineChromaAtSourceResolution(source, {
        a: new Float32Array(1),
        b: new Float32Array(1),
        width: 0,
        height: 1,
      }),
    ).toThrow('positive integers');
  });
});
