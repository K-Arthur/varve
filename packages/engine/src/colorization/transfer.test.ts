import { describe, expect, it } from 'vitest';
import { rgbToLab } from '../nonSeparable';
import { colorTransferLab, computeLabStats } from './transfer';

describe('computeLabStats', () => {
  it('returns zero stats for a black image', () => {
    const data = new Uint8ClampedArray(4);
    const stats = computeLabStats(data, 1);
    expect(stats.meanA).toBeCloseTo(0, 0);
    expect(stats.meanB).toBeCloseTo(0, 0);
  });

  it('produces non-zero stats for a red pixel', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    const stats = computeLabStats(data, 1);
    expect(stats.meanA).not.toBe(0);
  });

  it('ignores fully transparent pixels when computing reference statistics', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]);
    const stats = computeLabStats(data, 2);
    const [, blueA, blueB] = rgbToLab(0, 0, 1);
    expect(stats.meanA).toBeCloseTo(blueA, 5);
    expect(stats.meanB).toBeCloseTo(blueB, 5);
  });
});

describe('colorTransferLab', () => {
  it('preserves image dimensions', () => {
    const src = new ImageData(4, 4);
    const ref = new ImageData(4, 4);
    ref.data.fill(255);
    const result = colorTransferLab(src, ref, 1, 1);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it('does not crash on empty image', () => {
    const src = new ImageData(1, 1);
    const ref = new ImageData(1, 1);
    ref.data.set([0, 0, 0, 255]);
    const result = colorTransferLab(src, ref, 0, 0);
    expect(result.data).toBeDefined();
  });

  it('rejects a reference with no usable pixels instead of emitting NaN colors', () => {
    const source = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1);
    const reference = new ImageData(new Uint8ClampedArray([255, 0, 0, 0]), 1, 1);
    expect(() => colorTransferLab(source, reference, 1, 1)).toThrow('reference');
  });
});
