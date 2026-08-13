import { describe, expect, it } from 'vitest';
import {
  DepthMapCache,
  depthCacheKey,
  depthRangeToMask,
  deserializeDepthMap,
  normalizeDepthPrediction,
  sampleDepth,
  serializeDepthMap,
} from './depthMap';

describe('DepthMap', () => {
  it('normalizes raw near-is-high output into canonical near-is-low values', () => {
    const map = normalizeDepthPrediction(new Float32Array([10, 20, 30, 40]), 2, 2, {
      lowPercentile: 0,
      highPercentile: 1,
    });
    expect([...map.values]).toEqual([1, expect.closeTo(2 / 3, 3), expect.closeTo(1 / 3, 3), 0]);
    expect(map.metadata.nearFarConvention).toBe('nearIsLow');
  });

  it('ignores non-finite and outlier samples during robust normalization', () => {
    const map = normalizeDepthPrediction(
      new Float32Array([10, 20, 30, 40, 100000, Number.NaN]),
      3,
      2,
      { lowPercentile: 0, highPercentile: 0.8 },
    );
    expect(map.valid[5]).toBe(0);
    expect([...map.values].every(Number.isFinite)).toBe(true);
    expect(map.values[0]).toBeGreaterThan(map.values[3]!);
  });

  it('uses a stable mid-plane for uniform predictions', () => {
    const map = normalizeDepthPrediction(new Float32Array([4, 4, 4, 4]), 2, 2);
    expect([...map.values]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('round-trips a 16-bit resource without reducing it to 8-bit precision', () => {
    const map = normalizeDepthPrediction(new Float32Array([0, 0.1234, 0.5678, 1]), 2, 2, {
      nearFarConvention: 'nearIsLow',
      lowPercentile: 0,
      highPercentile: 1,
      metadata: { sourceAssetId: 'image-1', sourceRevision: 3 },
    });
    const restored = deserializeDepthMap(serializeDepthMap(map, 'depth-1'));
    expect(restored.metadata.sourceRevision).toBe(3);
    expect(restored.values[1]).toBeCloseTo(map.values[1]!, 4);
    expect(restored.values[1]).not.toBe(Math.round(map.values[1]! * 255) / 255);
  });

  it('samples a neighbourhood and turns ranges into semantic masks', () => {
    const map = normalizeDepthPrediction(new Float32Array([0, 0.25, 0.5, 1]), 2, 2, {
      nearFarConvention: 'nearIsLow',
      lowPercentile: 0,
      highPercentile: 1,
    });
    expect(sampleDepth(map, 0, 0, 1)).toBeCloseTo(0.4375, 3);
    expect([...depthRangeToMask(map, 0.2, 0.6)]).toEqual([0, 255, 255, 0]);
  });

  it('keys maps by source revision and bounds the decoded cache', () => {
    const base = {
      sourceHash: 'abc',
      sourceRevision: 1,
      modelId: 'depth-small',
      modelVersion: '2',
      preprocessingVersion: 1,
      width: 2,
      height: 2,
    };
    expect(depthCacheKey(base)).not.toBe(depthCacheKey({ ...base, sourceRevision: 2 }));
    const cache = new DepthMapCache(2);
    const map = normalizeDepthPrediction(new Float32Array([0, 1, 0, 1]), 2, 2);
    cache.set('a', map);
    cache.set('b', map);
    cache.set('c', map);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
  });
});
