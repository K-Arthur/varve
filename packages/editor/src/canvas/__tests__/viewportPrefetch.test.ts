/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import {
  computePrefetchRegion,
  isInPrefetchRegion,
  isPrefetchEnabled,
  prefetchDistance,
  rankPrefetchCandidates,
  schedulePrefetch,
  setPrefetchEnabled,
} from '../viewportPrefetch';

describe('viewportPrefetch', () => {
  describe('computePrefetchRegion', () => {
    it('expands viewport by default margin', () => {
      const region = computePrefetchRegion({ width: 1200, height: 800 }, 1);
      expect(region.w).toBeCloseTo(1200 + 1200 * 0.75 * 2, 5);
      expect(region.h).toBeCloseTo(800 + 800 * 0.75 * 2, 5);
    });

    it('scales margin with zoom', () => {
      const zoomed = computePrefetchRegion({ width: 1200, height: 800 }, 2);
      expect(zoomed.w).toBeGreaterThan(0);
      expect(zoomed.h).toBeGreaterThan(0);
    });

    it('accepts custom margin', () => {
      const region = computePrefetchRegion({ width: 100, height: 100 }, 1, 0.5);
      expect(region.w).toBe(100 + 100 * 0.5 * 2);
    });
  });

  describe('isInPrefetchRegion', () => {
    it('returns true for content just outside viewport', () => {
      const viewport = { x: 0, y: 0, w: 100, h: 100 };
      const prefetch = { x: -75, y: -75, w: 250, h: 250 };
      const bounds = { x: 110, y: 0, w: 10, h: 10 };
      expect(isInPrefetchRegion(bounds, prefetch, viewport)).toBe(true);
    });

    it('returns false for content inside viewport', () => {
      const viewport = { x: 0, y: 0, w: 100, h: 100 };
      const prefetch = { x: -75, y: -75, w: 250, h: 250 };
      const bounds = { x: 50, y: 50, w: 10, h: 10 };
      expect(isInPrefetchRegion(bounds, prefetch, viewport)).toBe(false);
    });

    it('returns false for content far outside prefetch region', () => {
      const viewport = { x: 0, y: 0, w: 100, h: 100 };
      const prefetch = { x: -75, y: -75, w: 250, h: 250 };
      const bounds = { x: 1000, y: 1000, w: 10, h: 10 };
      expect(isInPrefetchRegion(bounds, prefetch, viewport)).toBe(false);
    });
  });

  describe('prefetchDistance', () => {
    it('returns positive distance from viewport center', () => {
      const d = prefetchDistance(200, 0, { x: 0, y: 0, w: 100, h: 100 });
      expect(d).toBeGreaterThan(0);
    });

    it('returns zero for content at viewport center', () => {
      const d = prefetchDistance(50, 50, { x: 0, y: 0, w: 100, h: 100 });
      expect(d).toBe(0);
    });
  });

  describe('rankPrefetchCandidates', () => {
    it('sorts by distance ascending', () => {
      const candidates = [
        { nodeId: 'far', priority: 10, distance: 200 },
        { nodeId: 'near', priority: 5, distance: 50 },
        { nodeId: 'medium', priority: 8, distance: 100 },
      ];
      const ranked = rankPrefetchCandidates(candidates);
      expect(ranked.map((c) => c.nodeId)).toEqual(['near', 'medium', 'far']);
    });
  });

  describe('schedulePrefetch', () => {
    it('returns a cancelable task', () => {
      const fn = vi.fn();
      const task = schedulePrefetch(fn);
      expect(typeof task.cancel).toBe('function');
      expect(task.completed).toBeInstanceOf(Promise);
      task.cancel();
      // Task should not have been called
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('global enable toggle', () => {
    it('starts enabled', () => {
      expect(isPrefetchEnabled()).toBe(true);
    });

    it('can be disabled and re-enabled', () => {
      setPrefetchEnabled(false);
      expect(isPrefetchEnabled()).toBe(false);
      setPrefetchEnabled(true);
      expect(isPrefetchEnabled()).toBe(true);
    });
  });
});
