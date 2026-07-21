import { describe, expect, it } from 'vitest';
import { decodeTextRegions, padToStride } from './paddleocr';

describe('paddleocr', () => {
  describe('padToStride', () => {
    it('rounds up to the nearest multiple of the stride', () => {
      expect(padToStride(100, 32)).toBe(128);
      expect(padToStride(64, 32)).toBe(64);
      expect(padToStride(1, 32)).toBe(32);
    });

    it('defaults to stride 32', () => {
      expect(padToStride(33)).toBe(64);
    });
  });

  describe('decodeTextRegions', () => {
    it('finds a single connected region above the probability threshold', () => {
      const w = 4;
      const h = 4;
      // biome-ignore format: readability of the grid layout
      const data = new Float32Array([
        0, 0, 0, 0,
        0, 1, 1, 0,
        0, 1, 1, 0,
        0, 0, 0, 0,
      ]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.x).toBe(1);
      expect(regions[0]!.y).toBe(1);
      expect(regions[0]!.width).toBe(2);
      expect(regions[0]!.height).toBe(2);
      expect(regions[0]!.confidence).toBeCloseTo(1, 5);
    });

    it('separates two non-adjacent regions', () => {
      const w = 6;
      const h = 2;
      // biome-ignore format: readability of the grid layout
      const data = new Float32Array([
        1, 0, 0, 0, 1, 1,
        1, 0, 0, 0, 1, 1,
      ]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(2);
      // sorted by y then x: the left region (x=0) comes before the right (x=4)
      expect(regions[0]!.x).toBe(0);
      expect(regions[0]!.width).toBe(1);
      expect(regions[1]!.x).toBe(4);
      expect(regions[1]!.width).toBe(2);
    });

    it('filters out regions smaller than minRegionArea', () => {
      const w = 4;
      const h = 4;
      const data = new Float32Array(w * h).fill(0);
      data[0] = 1; // single isolated pixel
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 4);
      expect(regions).toHaveLength(0);
    });

    it('scales region coordinates to the target resolution', () => {
      const w = 2;
      const h = 2;
      const data = new Float32Array([1, 1, 1, 1]).fill(1);
      const regions = decodeTextRegions(data, w, h, 8, 4, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.width).toBe(8);
      expect(regions[0]!.height).toBe(4);
    });

    it('averages per-pixel probability into the region confidence', () => {
      const w = 2;
      const h = 1;
      const data = new Float32Array([0.6, 0.8]);
      const regions = decodeTextRegions(data, w, h, w, h, 0.5, 1);
      expect(regions).toHaveLength(1);
      expect(regions[0]!.confidence).toBeCloseTo(0.7, 5);
    });
  });
});
