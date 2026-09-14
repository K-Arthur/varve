import { describe, expect, it } from 'vitest';
import {
  applyLiquifyDab,
  createFreezeSampler,
  createLiquifyField,
  decodeFreezeMask,
  validateLiquifyField,
} from '../field';
import { warpImageDataByField } from '../warp';

function image(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 20;
    data[i + 1] = 80;
    data[i + 2] = 140;
    data[i + 3] = 255;
  }
  return new ImageData(data, width, height);
}

describe('liquify runtime contracts', () => {
  it('resamples an identity field when the requested output size differs', () => {
    const source = image(8, 6);
    const field = createLiquifyField(8, 6, 2, 2);

    const output = warpImageDataByField(source, field, {
      outputWidth: 4,
      outputHeight: 3,
    });

    expect([output.width, output.height]).toEqual([4, 3]);
    expect(output.data.length).toBe(4 * 3 * 4);
    expect(Array.from(output.data.slice(0, 4))).toEqual([20, 80, 140, 255]);
  });

  it('falls back to source dimensions for malformed output sizes', () => {
    const source = image(8, 6);
    const field = createLiquifyField(8, 6, 2, 2);

    const output = warpImageDataByField(source, field, {
      outputWidth: Number.NaN,
      outputHeight: Number.POSITIVE_INFINITY,
    });

    expect([output.width, output.height]).toEqual([8, 6]);
  });

  it('does not allocate an unbounded output for hostile dimensions', () => {
    const source = image(8, 6);
    const field = createLiquifyField(8, 6, 2, 2);

    const output = warpImageDataByField(source, field, {
      outputWidth: 1_000_000,
      outputHeight: 1_000_000,
    });

    expect([output.width, output.height]).toEqual([8, 6]);
  });

  it('treats non-finite dab parameters as a no-op', () => {
    const field = createLiquifyField(100, 100, 4, 4);
    const moved = applyLiquifyDab(field, 'push', {
      x: 50,
      y: 50,
      radius: 100,
      strength: 1,
      pressure: 1,
      deltaX: 8,
      deltaY: 0,
    });

    const malformed = applyLiquifyDab(moved, 'push', {
      x: 50,
      y: 50,
      radius: 100,
      strength: Number.NaN,
      pressure: 1,
      deltaX: 20,
      deltaY: 0,
    });

    expect(malformed).toEqual(moved);
  });

  it('normalizes a positive fractional reference extent to a valid pixel extent', () => {
    const field = createLiquifyField(10, 10, 2, 2);
    const repaired = validateLiquifyField({ ...field, referenceWidth: 0.4 });

    expect(repaired).not.toBeNull();
    expect(repaired!.referenceWidth).toBeGreaterThanOrEqual(1);
  });

  it('rejects oversized freeze runs and keeps malformed samples finite', () => {
    const oversized = btoa(`0:${(512 * 512 + 1).toString(36)}`);
    expect(decodeFreezeMask(oversized)).toBeNull();

    const sampler = createFreezeSampler(2, 2, new Uint8Array(4).fill(255));
    expect(sampler?.sampleNormalized(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
