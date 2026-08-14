import { describe, expect, it } from 'vitest';
import {
  averagePrecision,
  computeRetrievalMetrics,
  duplicateMetrics,
  meanOf,
  nDcgAtK,
  reciprocalRank,
} from './metrics';

const relevant = new Set(['b', 'd']);

describe('retrieval metrics', () => {
  it('computes reciprocal rank of the first relevant hit', () => {
    expect(reciprocalRank([{ id: 'a', score: 0.9 }], relevant)).toBe(0);
    expect(
      reciprocalRank(
        [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.8 }],
        relevant,
      ),
    ).toBe(0.5);
    expect(reciprocalRank([{ id: 'b', score: 0.8 }], relevant)).toBe(1);
  });

  it('computes average precision capped at k', () => {
    const ranked = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.8 },
      { id: 'c', score: 0.7 },
      { id: 'd', score: 0.6 },
    ];
    // hits at rank 2 (prec 1/2) and rank 4 (prec 2/4); AP = (0.5 + 0.5)/2
    expect(averagePrecision(ranked, relevant, 10)).toBeCloseTo(0.5, 5);
    // capping at k=3 drops the rank-4 hit
    expect(averagePrecision(ranked, relevant, 3)).toBeCloseTo(0.25, 5);
  });

  it('computes nDCG with binary relevance', () => {
    const ranked = [
      { id: 'b', score: 1 },
      { id: 'a', score: 0.9 },
      { id: 'd', score: 0.8 },
    ];
    // ideal ordering is b,d (both relevant first); dcg gains 1/log2(2) and 1/log2(4)
    const ndcg = nDcgAtK(ranked, relevant, 3);
    expect(ndcg).toBeGreaterThan(0.5);
    expect(ndcg).toBeLessThan(1);
    // perfect ordering scores 1
    expect(nDcgAtK([{ id: 'b', score: 1 }, { id: 'd', score: 0.5 }], relevant, 2)).toBe(1);
  });

  it('aggregates query metrics into overall retrieval metrics', () => {
    const metrics = computeRetrievalMetrics([
      { id: 'q1', ranked: [{ id: 'b', score: 1 }], relevant },
      { id: 'q2', ranked: [{ id: 'x', score: 1 }], relevant },
    ]);
    expect(metrics.recallAt1).toBe(0.5);
    expect(metrics.mrr).toBeCloseTo(0.5, 5);
    expect(metrics.recallAt10).toBe(0.5);
  });

  it('handles empty query sets', () => {
    const m = computeRetrievalMetrics([]);
    expect(m.mAP).toBe(0);
    expect(m.recallAt1).toBe(0);
  });

  it('averages per-domain metric sets', () => {
    const a = computeRetrievalMetrics([{ id: 'q', ranked: [{ id: 'b', score: 1 }], relevant }]);
    const b = computeRetrievalMetrics([{ id: 'q', ranked: [{ id: 'x', score: 1 }], relevant }]);
    const mean = meanOf([a, b]);
    expect(mean.recallAt1).toBe(0.5);
    expect(mean.nDCG).toBeCloseTo((a.nDCG + b.nDCG) / 2, 5);
  });
});

describe('duplicate detection metrics', () => {
  it('computes precision/recall/FPR/FNR/F1', () => {
    const m = duplicateMetrics({
      truePositives: 10,
      falsePositives: 5,
      trueNegatives: 80,
      falseNegatives: 2,
    });
    expect(m.precision).toBeCloseTo(10 / 15, 5);
    expect(m.recall).toBeCloseTo(10 / 12, 5);
    expect(m.falsePositiveRate).toBeCloseTo(5 / 85, 5);
    expect(m.falseNegativeRate).toBeCloseTo(2 / 12, 5);
    expect(m.count).toBe(97);
  });

  it('handles degenerate empty detections', () => {
    const m = duplicateMetrics({ truePositives: 0, falsePositives: 0, trueNegatives: 10, falseNegatives: 5 });
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
    expect(m.falsePositiveRate).toBe(0);
  });
});
