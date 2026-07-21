import { describe, expect, it } from 'vitest';
import { decodeDepthOutput, depthToMask } from '../models/depth';

describe('depth', () => {
  describe('decodeDepthOutput', () => {
    it('normalizes depth output to 0-255 range', () => {
      const raw = new Float32Array([0.2, 0.5, 0.3, 0.9]);
      const result = decodeDepthOutput(raw, 2, 2, 2, 2);
      expect(result.depthMap.length).toBe(4);
      expect(result.depthMap[0]).toBe(0); // min → 0
      expect(result.depthMap[3]).toBe(255); // max → 255
    });

    it('resizes depth map when target differs from output', () => {
      const raw = new Float32Array(256 * 256).fill(0.5);
      // Set one pixel to max
      raw[0] = 1.0;
      const result = decodeDepthOutput(raw, 256, 256, 512, 512);
      expect(result.width).toBe(512);
      expect(result.height).toBe(512);
      expect(result.depthMap.length).toBe(512 * 512);
    });

    it('handles uniform input (all same depth)', () => {
      const raw = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      const result = decodeDepthOutput(raw, 2, 2, 2, 2);
      // All zeros when range is 0 (degenerate normalization)
      for (const v of result.depthMap) {
        expect(v).toBe(0);
      }
    });

    it('preserves rawDepth when dimensions match', () => {
      const raw = new Float32Array([0.1, 0.3, 0.5, 0.7]);
      const result = decodeDepthOutput(raw, 2, 2, 2, 2);
      expect(result.rawDepth).toBeDefined();
      expect(result.rawDepth!.length).toBe(4);
    });
  });

  describe('depthToMask', () => {
    it('selects pixels within depth range', () => {
      const depth = new Uint8Array([50, 100, 150, 200]);
      const mask = depthToMask(depth, 80, 180);
      expect(mask[0]).toBe(0); // 50 < 80
      expect(mask[1]).toBe(255); // 80 <= 100 <= 180
      expect(mask[2]).toBe(255); // 80 <= 150 <= 180
      expect(mask[3]).toBe(0); // 200 > 180
    });

    it('returns all zeros when no pixels in range', () => {
      const depth = new Uint8Array([10, 20, 30]);
      const mask = depthToMask(depth, 100, 200);
      for (const v of mask) {
        expect(v).toBe(0);
      }
    });

    it('returns all 255 when all pixels in range', () => {
      const depth = new Uint8Array([100, 150, 200]);
      const mask = depthToMask(depth, 0, 255);
      for (const v of mask) {
        expect(v).toBe(255);
      }
    });
  });
});
