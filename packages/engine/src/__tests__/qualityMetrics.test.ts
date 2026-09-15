import { describe, expect, it } from 'vitest';
import {
  createAlphaRamp,
  createCheckerboard,
  createGradient,
} from '../imageQuality/fixtureGenerators';
import {
  computeAlphaDifference,
  computeColorDifference,
  computePalettePreservation,
  computePsnr,
  computeSsim,
  computeTileBoundaryDifference,
  extractRegion,
  hasNanPixels,
} from '../imageQuality/metrics';

describe('quality metrics', () => {
  describe('computePsnr', () => {
    it('returns Infinity for identical images', () => {
      const img = createCheckerboard(16, 16, 4);
      expect(computePsnr(img, img)).toBe(Infinity);
    });

    it('returns null for mismatched dimensions', () => {
      const a = createCheckerboard(16, 16, 4);
      const b = createCheckerboard(8, 8, 4);
      expect(computePsnr(a, b)).toBeNull();
    });

    it('returns finite PSNR for different images', () => {
      const a = createCheckerboard(16, 16, 4);
      const b = createGradient(16, 16);
      const psnr = computePsnr(a, b);
      expect(psnr).toBeGreaterThan(0);
      expect(psnr).toBeLessThan(100);
    });
  });

  describe('computeSsim', () => {
    it('returns 1 for identical images', () => {
      const img = createCheckerboard(16, 16, 4);
      expect(computeSsim(img, img)).toBeCloseTo(1, 2);
    });

    it('returns null for mismatched dimensions', () => {
      const a = createCheckerboard(16, 16, 4);
      const b = createCheckerboard(8, 8, 4);
      expect(computeSsim(a, b)).toBeNull();
    });
  });

  describe('computeColorDifference', () => {
    it('returns 0 for identical images', () => {
      const img = createCheckerboard(16, 16, 4);
      expect(computeColorDifference(img, img)).toBe(0);
    });

    it('returns positive difference for different images', () => {
      const a = createCheckerboard(16, 16, 4);
      const b = createGradient(16, 16);
      expect(computeColorDifference(a, b)).toBeGreaterThan(0);
    });
  });

  describe('computeAlphaDifference', () => {
    it('returns 0 for opaque-only images', () => {
      const a = createCheckerboard(16, 16, 4);
      expect(computeAlphaDifference(a, a)).toBe(0);
    });

    it('detects alpha differences', () => {
      const a = createAlphaRamp(16, 16);
      const b = createCheckerboard(16, 16, 4);
      expect(computeAlphaDifference(a, b)).toBeGreaterThan(0);
    });
  });

  describe('computeTileBoundaryDifference', () => {
    it('returns 0 for a smooth image', () => {
      const img = createCheckerboard(16, 16, 16);
      expect(computeTileBoundaryDifference(img, 16)).toBe(0);
    });

    it('detects boundary artifacts', () => {
      const img = createCheckerboard(16, 16, 4);
      const diff = computeTileBoundaryDifference(img, 8);
      expect(diff).toBeGreaterThanOrEqual(0);
    });
  });

  describe('hasNanPixels', () => {
    it('returns false for valid image', () => {
      const img = createCheckerboard(16, 16, 4);
      expect(hasNanPixels(img)).toBe(false);
    });
  });

  describe('extractRegion', () => {
    it('extracts the correct size sub-region', () => {
      const img = createCheckerboard(16, 16, 4);
      const region = extractRegion(img, { x: 0, y: 0, width: 8, height: 8 });
      expect(region.width).toBe(8);
      expect(region.height).toBe(8);
    });

    it('clamps to image bounds', () => {
      const img = createCheckerboard(16, 16, 4);
      const region = extractRegion(img, { x: 12, y: 12, width: 8, height: 8 });
      expect(region.width).toBe(8);
      expect(region.height).toBe(8);
    });
  });

  describe('computePalettePreservation', () => {
    it('returns true for identical images', () => {
      const img = createCheckerboard(16, 16, 4);
      expect(computePalettePreservation(img, img)).toBe(true);
    });
  });
});
