import { describe, expect, it } from 'vitest';
import {
  constrainPortraitAlpha,
  decodeModnetAlpha,
  modnetInputDimensions,
  preprocessModnetImageData,
  resizeAlphaArea,
} from './modnetPortrait';

describe('modnetInputDimensions', () => {
  it('matches upstream get_scale_factor for landscape sources', () => {
    // 1920x1080: longer edge -> 512, shorter edge -> int(1920/1080*512)=910, floored to 896.
    expect(modnetInputDimensions(1920, 1080)).toEqual({ width: 896, height: 512 });
    expect(modnetInputDimensions(800, 600)).toEqual({ width: 672, height: 512 });
  });

  it('matches upstream get_scale_factor for portrait sources', () => {
    expect(modnetInputDimensions(1080, 1920)).toEqual({ width: 512, height: 896 });
  });

  it('upscales sources whose long edge is below 512', () => {
    expect(modnetInputDimensions(400, 400)).toEqual({ width: 512, height: 512 });
    expect(modnetInputDimensions(300, 200)).toEqual({ width: 768, height: 512 });
  });

  it('keeps an in-range source size, floored to 32', () => {
    expect(modnetInputDimensions(512, 512)).toEqual({ width: 512, height: 512 });
    expect(modnetInputDimensions(600, 600)).toEqual({ width: 512, height: 512 });
    expect(modnetInputDimensions(700, 620)).toEqual({ width: 576, height: 512 });
  });

  it('rejects invalid dimensions', () => {
    expect(() => modnetInputDimensions(0, 100)).toThrow();
    expect(() => modnetInputDimensions(100.5, 100)).toThrow();
  });
});

describe('resizeAlphaArea', () => {
  it('returns a copy for identical dimensions', () => {
    const source = new Float32Array([0.25, 0.5, 0.75, 1]);
    const result = resizeAlphaArea(source, 2, 2, 2, 2);
    expect(Array.from(result)).toEqual([0.25, 0.5, 0.75, 1]);
    expect(result).not.toBe(source);
  });

  it('uses fractional area weights when downscaling', () => {
    // 3 -> 2: target0 covers [0,1.5), target1 covers [1.5,3).
    const result = resizeAlphaArea(new Float32Array([0, 1, 2]), 3, 1, 2, 1);
    expect(result[0]).toBeCloseTo(1 / 3, 6);
    expect(result[1]).toBeCloseTo(5 / 3, 6);
  });

  it('averages an exact integer box when the scale divides evenly', () => {
    const source = new Float32Array(16);
    for (let i = 0; i < 16; i += 1) source[i] = i;
    const result = resizeAlphaArea(source, 4, 4, 2, 2);
    // top-left box {0,1,4,5} mean = 2.5; bottom-right {10,11,14,15} mean = 12.5.
    expect(result[0]).toBeCloseTo(2.5, 6);
    expect(result[3]).toBeCloseTo(12.5, 6);
  });

  it('uses nearest sampling when upscaling (OpenCV INTER_AREA behaviour)', () => {
    const result = resizeAlphaArea(new Float32Array([0, 1]), 2, 1, 4, 1);
    expect(Array.from(result)).toEqual([0, 0, 1, 1]);
  });
});

describe('preprocessModnetImageData', () => {
  it('packs NCHW in the [-1,1] range the upstream graph expects', () => {
    const data = new Uint8ClampedArray([255, 0, 128, 255]);
    const result = preprocessModnetImageData(
      { data, width: 1, height: 1 },
      { width: 1, height: 1 },
    );
    expect(result.tensor.length).toBe(3);
    expect(result.tensor[0]).toBeCloseTo(1, 6);
    expect(result.tensor[1]).toBeCloseTo(-1, 6);
    expect(result.tensor[2]).toBeCloseTo(128 / 127.5 - 1, 6);
  });

  it('keeps the requested geometry and normalizes area averages', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const result = preprocessModnetImageData(
      { data, width: 4, height: 4 },
      { width: 2, height: 2 },
    );
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    for (const value of result.tensor) expect(value).toBeCloseTo(1, 6);
  });
});

describe('decodeModnetAlpha', () => {
  it('accepts the official [1,1,H,W] contract and clamps', () => {
    const decoded = decodeModnetAlpha(new Float32Array([0, 0.5, 1, 1.00005]), [1, 1, 2, 2]);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.activationApplied).toBe(false);
    expect(Array.from(decoded.alpha)).toEqual([0, 0.5, 1, 1]);
  });

  it('applies exactly one sigmoid when the graph emits raw logits', () => {
    const decoded = decodeModnetAlpha(new Float32Array([-10, 0, 10, 0.25]), [1, 1, 2, 2]);
    expect(decoded.activationApplied).toBe(true);
    expect(decoded.alpha[0]).toBeCloseTo(1 / (1 + Math.exp(10)), 6);
    expect(decoded.alpha[1]).toBeCloseTo(0.5, 6);
    expect(decoded.alpha[2]).toBeCloseTo(1 - 1 / (1 + Math.exp(10)), 6);
  });

  it('accepts relaxed shapes and rejects malformed output', () => {
    expect(decodeModnetAlpha(new Float32Array([0, 1]), [1, 2]).height).toBe(1);
    const square = decodeModnetAlpha(new Float32Array([0, 0.25, 0.5, 1]), [2, 2]);
    expect(square.width).toBe(2);
    expect(square.height).toBe(2);
    expect(() => decodeModnetAlpha(new Float32Array([0, 1]), [2])).toThrow();
    expect(() => decodeModnetAlpha(new Float32Array([0, Number.NaN]), [1, 2])).toThrow();
    expect(() => decodeModnetAlpha(new Float32Array([0, 1, 2]), [1, 2])).toThrow();
    expect(() => decodeModnetAlpha(new Float32Array([0, 1]), [2, 1, 1, 1])).toThrow();
  });
});

describe('constrainPortraitAlpha', () => {
  const expectClose = (actual: Float32Array, expected: number[]) => {
    expect(actual.length).toBe(expected.length);
    expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 6));
  };

  it('preserves fractional coverage inside the support and zeroes outside it', () => {
    // 5x1: constraint covers pixels 1..3. Alpha values are distinct.
    const alpha = new Float32Array([0.9, 0.4, 0.5, 0.6, 0.9]);
    const constraint = new Uint8Array([0, 255, 255, 255, 0]);
    const result = constrainPortraitAlpha(alpha, 5, 1, constraint, { supportRadius: 0 });
    expectClose(result, [0, 0.4, 0.5, 0.6, 0]);
  });

  it('does not multiply the two soft estimates (no edge darkening)', () => {
    const alpha = new Float32Array([1, 0.5, 0.25, 0.5, 1]);
    const constraint = new Uint8Array([255, 255, 255, 255, 255]);
    const result = constrainPortraitAlpha(alpha, 5, 1, constraint, { supportRadius: 0 });
    expectClose(result, [1, 0.5, 0.25, 0.5, 1]);
  });

  it('dilates the support so genuine edge slivers survive the coarse boundary', () => {
    const alpha = new Float32Array([0.2, 0.4, 0.8, 0.4, 0.2]);
    const constraint = new Uint8Array([0, 0, 255, 0, 0]);
    const result = constrainPortraitAlpha(alpha, 5, 1, constraint, { supportRadius: 1 });
    expectClose(result, [0, 0.4, 0.8, 0.4, 0]);
    const tight = constrainPortraitAlpha(alpha, 5, 1, constraint, { supportRadius: 0 });
    expectClose(tight, [0, 0, 0.8, 0, 0]);
  });

  it('rejects mismatched planes', () => {
    expect(() => constrainPortraitAlpha(new Float32Array(2), 2, 1, new Uint8Array(3))).toThrow();
  });
});
