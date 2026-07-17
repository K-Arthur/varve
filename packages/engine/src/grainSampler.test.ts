import { describe, expect, it } from 'vitest';
import { sampleProceduralGrain, resolveGrainValueSync } from './grainSampler';

describe('grainSampler', () => {
  describe('sampleProceduralGrain', () => {
    it('returns a value between 0 and 1', () => {
      for (let x = 0; x < 100; x++) {
        for (let y = 0; y < 100; y++) {
          const v = sampleProceduralGrain(x, y);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    });

    it('is deterministic (same seed + position → same value)', () => {
      const a = sampleProceduralGrain(10, 20, 42);
      const b = sampleProceduralGrain(10, 20, 42);
      expect(a).toBe(b);
    });

    it('varies with position', () => {
      const v1 = sampleProceduralGrain(0, 0, 42);
      const v2 = sampleProceduralGrain(1, 0, 42);
      const v3 = sampleProceduralGrain(0, 1, 42);
      // At least one should differ (collision unlikely for adjacent pixels)
      expect(v1 === v2 && v1 === v3).toBe(false);
    });

    it('varies with seed', () => {
      const v1 = sampleProceduralGrain(10, 10, 1);
      const v2 = sampleProceduralGrain(10, 10, 2);
      expect(v1).not.toBe(v2);
    });

    it('handles negative coordinates', () => {
      const v = sampleProceduralGrain(-5, -10, 42);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });

  describe('resolveGrainValueSync', () => {
    const baseParams = {
      scale: 1,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
      contrast: 1,
      invert: false,
      anchor: 'brush' as const,
      strokeT: 0,
      seed: 42,
    };

    it('returns procedural grain when grainId is null', () => {
      const v = resolveGrainValueSync(null, 10, 20, baseParams);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });

    it('returns procedural grain when grainId is undefined', () => {
      const v = resolveGrainValueSync(undefined, 10, 20, baseParams);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });

    it('applies contrast adjustment', () => {
      const base = resolveGrainValueSync(null, 10, 20, baseParams);
      const highContrast = resolveGrainValueSync(null, 10, 20, { ...baseParams, contrast: 2 });
      // High contrast pushes values toward 0 or 1
      expect(Math.abs(highContrast - 0.5)).toBeGreaterThanOrEqual(Math.abs(base - 0.5) - 0.01);
    });

    it('applies invert', () => {
      const normal = resolveGrainValueSync(null, 15, 25, baseParams);
      const inverted = resolveGrainValueSync(null, 15, 25, { ...baseParams, invert: true });
      expect(inverted).toBeCloseTo(1 - normal, 5);
    });
  });
});
