import { describe, expect, it } from 'vitest';
import { mergeDirtyRects, MAX_DIRTY_INPUT_RECTS } from '../dirtyRegionMerge';

const V = { width: 1600, height: 1000 };

describe('mergeDirtyRects', () => {
  it('keeps two distant small rects separate (no gap amplification)', () => {
    const result = mergeDirtyRects(
      [
        { x: 10, y: 10, w: 20, h: 20 },
        { x: 1500, y: 800, w: 20, h: 20 },
      ],
      {},
      V,
    );
    expect(result.rects).toHaveLength(2);
    expect(result.fallback).toBe('none');
    // Per-rect cost stays at the sum; the bounding-box union (what a single
    // union clip would clear) is the reported amplification.
    expect(result.sumAreaBefore).toBe(800);
    expect(result.sumAreaAfter).toBe(800);
    expect(result.unionAreaAfter).toBe(1_223_100);
    expect(result.amplification).toBeCloseTo(1528.875, 2);
  });

  it('merges strongly overlapping rects', () => {
    const result = mergeDirtyRects(
      [
        { x: 0, y: 0, w: 100, h: 100 },
        { x: 60, y: 60, w: 100, h: 100 },
      ],
      {},
      V,
    );
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]).toEqual({ x: 0, y: 0, w: 160, h: 160 });
    expect(result.mergesApplied).toBe(1);
    // Amplification: union 25600 / sum 20000 = 1.28 (overlapping).
    expect(result.amplification).toBeCloseTo(1.28, 2);
  });

  it('merges nearby rects within the merge distance', () => {
    const result = mergeDirtyRects(
      [
        { x: 0, y: 0, w: 20, h: 20 },
        { x: 30, y: 0, w: 20, h: 20 },
      ],
      { maxRects: 1 },
      V,
    );
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]).toEqual({ x: 0, y: 0, w: 50, h: 20 });
  });

  it('does not merge distant rects when below the count budget', () => {
    const result = mergeDirtyRects(
      [
        { x: 0, y: 0, w: 20, h: 20 },
        { x: 400, y: 0, w: 20, h: 20 },
      ],
      { maxRects: 4 },
      V,
    );
    expect(result.rects).toHaveLength(2);
    expect(result.mergesApplied).toBe(0);
  });

  it('never forces an expensive merge to meet the count budget', () => {
    // Five rects 300 units apart: merging any pair would create a ~8×
    // amplified rectangle (union / sum), so the policy keeps them separate
    // even though the count budget is 2 — that is the anti-pathology rule.
    const rects = Array.from({ length: 5 }, (_, i) => ({
      x: i * 300,
      y: 0,
      w: 20,
      h: 20,
    }));
    const result = mergeDirtyRects(rects, { maxRects: 2, mergeDistance: 40 }, V);
    expect(result.rects).toHaveLength(5);
    expect(result.mergesApplied).toBe(0);
    expect(result.afterCount).toBeLessThanOrEqual(MAX_DIRTY_INPUT_RECTS);
  });

  it('meets the count budget when admissible pairs exist', () => {
    // Five rects 10 units apart: every pair is within mergeDistance, so the
    // greedy merge runs until the count budget is satisfied.
    const rects = Array.from({ length: 5 }, (_, i) => ({
      x: i * 30,
      y: 0,
      w: 20,
      h: 20,
    }));
    const result = mergeDirtyRects(rects, { maxRects: 2, mergeDistance: 40 }, V);
    expect(result.rects.length).toBeLessThanOrEqual(2);
    expect(result.mergesApplied).toBeGreaterThan(0);
  });

  it('falls back to a viewport-sized rect past the area threshold', () => {
    const result = mergeDirtyRects(
      [
        { x: 0, y: 0, w: 1200, h: 600 },
        { x: 200, y: 400, w: 1200, h: 600 },
      ],
      { areaThresholdRatio: 0.6 },
      V,
    );
    expect(result.fallback).toBe('viewport-area');
    expect(result.rects).toEqual([{ x: 0, y: 0, w: 1600, h: 1000 }]);
    expect(result.unionAreaAfter).toBe(1_600_000);
  });

  it('does not fall back when the per-rect cost stays under the threshold', () => {
    // Two rects 300 units apart: kept separate, and the sum of their areas is
    // far below the fallback threshold even though the bounding-box union is
    // large — tiny distant invalidations must not degrade to a full redraw.
    const result = mergeDirtyRects(
      [
        { x: 0, y: 0, w: 600, h: 300 },
        { x: 900, y: 0, w: 600, h: 300 },
      ],
      { areaThresholdRatio: 0.6 },
      V,
    );
    expect(result.fallback).toBe('none');
    expect(result.rects).toHaveLength(2);
    expect(result.sumAreaAfter).toBe(360_000);
    expect(result.unionAreaAfter).toBe(450_000);
  });

  it('counts overflowed inputs beyond the collector cap', () => {
    const inputs = Array.from({ length: MAX_DIRTY_INPUT_RECTS + 20 }, (_, i) => ({
      x: i,
      y: 0,
      w: 1,
      h: 1,
    }));
    const result = mergeDirtyRects(inputs, { maxRects: 8 }, V);
    expect(result.beforeCount).toBe(MAX_DIRTY_INPUT_RECTS);
    expect(result.overflowed).toBe(20);
    expect(result.rects.length).toBeLessThanOrEqual(8);
  });

  it('drops NaN, infinity and zero-size inputs and counts them as overflow', () => {
    const result = mergeDirtyRects(
      [
        { x: NaN, y: 0, w: 10, h: 10 },
        { x: 0, y: 0, w: Infinity, h: 10 },
        { x: 0, y: 0, w: 0, h: 10 },
        { x: 0, y: 0, w: 10, h: 0 },
        { x: 5, y: 5, w: 10, h: 10 },
      ],
      {},
      V,
    );
    expect(result.rects).toHaveLength(1);
    expect(result.overflowed).toBe(4);
  });

  it('handles negative coordinates and huge values without NaN propagation', () => {
    const result = mergeDirtyRects(
      [
        { x: -1e9, y: -1e9, w: 1e8, h: 1e8 },
        { x: -2e9, y: -2e9, w: 1e8, h: 1e8 },
      ],
      {},
      V,
    );
    expect(result.fallback).toBe('viewport-area');
    expect(Number.isFinite(result.unionAreaAfter)).toBe(true);
  });

  it('is deterministic across repeated calls', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => ({
      x: (i * 137) % 2000,
      y: (i * 61) % 1500,
      w: 40,
      h: 30,
    }));
    const first = mergeDirtyRects(inputs, {}, V);
    const second = mergeDirtyRects(inputs, {}, V);
    expect(first.rects).toEqual(second.rects);
    expect(first.mergesApplied).toBe(second.mergesApplied);
    expect(first.amplification).toBe(second.amplification);
  });

  it('returns an empty set for empty inputs', () => {
    const result = mergeDirtyRects([], {}, V);
    expect(result.rects).toEqual([]);
    expect(result.beforeCount).toBe(0);
    expect(result.afterCount).toBe(0);
    expect(result.amplification).toBe(1);
  });

  it('never loses dirty pixels: the merged-set union equals the input union', () => {
    const inputs = Array.from({ length: 20 }, (_, i) => ({
      x: (i * 97) % 1500,
      y: (i * 53) % 900,
      w: 60 + (i % 5) * 10,
      h: 40 + (i % 3) * 10,
    }));
    const result = mergeDirtyRects(inputs, { maxRects: 8 }, V);
    let inputUnion = null;
    let mergedUnion = null;
    const unionOf = (left: { x: number; y: number; w: number; h: number } | null, right: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } => {
      if (!left) return { ...right };
      const x = Math.min(left.x, right.x);
      const y = Math.min(left.y, right.y);
      return {
        x,
        y,
        w: Math.max(left.x + left.w, right.x + right.w) - x,
        h: Math.max(left.y + left.h, right.y + right.h) - y,
      };
    };
    for (const rect of inputs) inputUnion = unionOf(inputUnion, rect);
    for (const rect of result.rects) mergedUnion = unionOf(mergedUnion, rect);
    expect(mergedUnion).toEqual(inputUnion);
  });
});
