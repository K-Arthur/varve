import { describe, expect, it } from 'vitest';
import { rasterPatternOffsetPlacements } from './rasterPatternOffset';

describe('raster pattern source offsets', () => {
  it('wraps integer offsets on both axes without changing the tile dimensions', () => {
    expect(rasterPatternOffsetPlacements(4, 3, 1, 1)).toEqual([
      { x: -3, y: -2 },
      { x: 1, y: -2 },
      { x: -3, y: 1 },
      { x: 1, y: 1 },
    ]);
  });

  it('normalizes negative and out-of-range offsets to one periodic cell', () => {
    expect(rasterPatternOffsetPlacements(4, 3, -1, 4)).toEqual([
      { x: -1, y: -2 },
      { x: 3, y: -2 },
      { x: -1, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  it('rejects invalid dimensions and non-finite offsets', () => {
    expect(() => rasterPatternOffsetPlacements(0, 3, 1, 0)).toThrow(/positive integer/);
    expect(() => rasterPatternOffsetPlacements(4, 3, Number.NaN, 0)).toThrow(/finite/);
  });
});
