import { describe, expect, it } from 'vitest';
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
});

describe('colorTransferLab', () => {
  it('preserves image dimensions', () => {
    const src = new ImageData(4, 4);
    const ref = new ImageData(4, 4);
    const result = colorTransferLab(src, ref, 1, 1);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
  });

  it('does not crash on empty image', () => {
    const src = new ImageData(1, 1);
    const ref = new ImageData(1, 1);
    const result = colorTransferLab(src, ref, 0, 0);
    expect(result.data).toBeDefined();
  });
});
