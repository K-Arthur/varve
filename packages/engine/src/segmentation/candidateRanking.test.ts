import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_ACCEPTABLE_REGRET,
  type CandidateRankingCase,
  type CandidateRankingFeatures,
  computeCandidateRankingFeatures,
  evaluateRankingPolicy,
  evaluateRankingPolicyByCategory,
  rankCandidateIndices,
} from './candidateRanking';

function features(overrides: Partial<CandidateRankingFeatures> = {}): CandidateRankingFeatures {
  return {
    score: 0.5,
    areaFraction: 0.1,
    includePointsCovered: 1,
    includePointsTotal: 1,
    excludePointsCovered: 0,
    excludePointsTotal: 0,
    boxOverlapFraction: 1,
    boxCentroidInside: true,
    componentCount: 1,
    unanchoredFraction: 0,
    stability: 0.5,
    touchesEdge: false,
    ...overrides,
  };
}

function blockMask(
  width: number,
  height: number,
  x0: number,
  y0: number,
  size: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y0 + size; y += 1) {
    for (let x = x0; x < x0 + size; x += 1) mask[y * width + x] = 1;
  }
  return mask;
}

describe('computeCandidateRankingFeatures', () => {
  it('measures prompt coverage, box support, area, and topology', () => {
    const mask = blockMask(10, 10, 2, 2, 4);
    const result = computeCandidateRankingFeatures(
      mask,
      10,
      10,
      {
        points: [
          { x: 0.4, y: 0.4, label: 1 },
          { x: 0.9, y: 0.9, label: 0 },
        ],
        box: { x1: 0.1, y1: 0.1, x2: 0.7, y2: 0.7 },
      },
      0.87,
    );
    expect(result.score).toBe(0.87);
    expect(result.areaFraction).toBeCloseTo(0.16, 10);
    expect(result.includePointsCovered).toBe(1);
    expect(result.includePointsTotal).toBe(1);
    expect(result.excludePointsCovered).toBe(0);
    expect(result.excludePointsTotal).toBe(1);
    expect(result.boxOverlapFraction).toBe(1);
    expect(result.boxCentroidInside).toBe(true);
    expect(result.componentCount).toBe(1);
    expect(result.touchesEdge).toBe(false);
    expect(result.stability).toBeGreaterThan(0);
  });

  it('flags exclude-point coverage and edge contact', () => {
    const mask = blockMask(8, 8, 0, 0, 3);
    const result = computeCandidateRankingFeatures(
      mask,
      8,
      8,
      { points: [{ x: 0.1, y: 0.1, label: 0 }] },
      0.4,
    );
    expect(result.excludePointsCovered).toBe(1);
    expect(result.touchesEdge).toBe(true);
    expect(result.componentCount).toBe(1);
  });

  it('scores a thin one-pixel structure as low-stability evidence, not a failure', () => {
    const thin = new Uint8Array(16 * 16);
    for (let x = 0; x < 16; x += 1) thin[8 * 16 + x] = 1;
    const result = computeCandidateRankingFeatures(thin, 16, 16, {}, 0.5);
    expect(result.areaFraction).toBeCloseTo(16 / 256, 10);
    expect(result.stability).toBe(0);
    expect(result.componentCount).toBe(1);
  });

  it('rejects non-finite scores and dimension mismatches', () => {
    expect(() => computeCandidateRankingFeatures(new Uint8Array(4), 2, 2, {}, Number.NaN)).toThrow(
      RangeError,
    );
    expect(() => computeCandidateRankingFeatures(new Uint8Array(3), 2, 2, {}, 0.5)).toThrow(
      RangeError,
    );
  });
});

describe('rankCandidateIndices', () => {
  it('returns the provider order unchanged for the provider policy', () => {
    expect(
      rankCandidateIndices([features({ score: 0.1 }), features({ score: 0.9 })], 'provider'),
    ).toEqual([0, 1]);
  });

  it('orders by score for the score policy with deterministic ties', () => {
    expect(
      rankCandidateIndices(
        [features({ score: 0.4 }), features({ score: 0.9 }), features({ score: 0.4 })],
        'score',
      ),
    ).toEqual([1, 0, 2]);
  });

  it('groups prompt-disagreeing candidates below agreeing ones', () => {
    const agreeing = features({ score: 0.5, includePointsCovered: 1 });
    const missingInclude = features({ score: 0.9, includePointsCovered: 0, includePointsTotal: 1 });
    const coveringExclude = features({
      score: 0.9,
      excludePointsCovered: 1,
      excludePointsTotal: 1,
    });
    expect(
      rankCandidateIndices([missingInclude, coveringExclude, agreeing], 'guarded-band-box'),
    ).toEqual([2, 1, 0]);
  });

  it('treats a box-unsupported candidate as lower agreement', () => {
    const supported = features({ score: 0.5 });
    const unsupported = features({
      score: 0.55,
      boxOverlapFraction: 0.05,
      boxCentroidInside: false,
    });
    expect(rankCandidateIndices([unsupported, supported], 'guarded-band-box')).toEqual([1, 0]);
  });

  it('reorders only inside the declared score band', () => {
    const scoreLeader = features({ score: 0.7, boxOverlapFraction: 0.3 });
    const boxWinner = features({ score: 0.69, boxOverlapFraction: 0.9 });
    expect(rankCandidateIndices([scoreLeader, boxWinner], 'guarded-band-box')).toEqual([1, 0]);
    const farBehind = features({ score: 0.6, boxOverlapFraction: 1 });
    expect(rankCandidateIndices([scoreLeader, farBehind], 'guarded-band-box')).toEqual([0, 1]);
  });

  it('prefers the larger candidate only inside the band for the area policy', () => {
    const small = features({ score: 0.7, areaFraction: 0.1 });
    const large = features({ score: 0.69, areaFraction: 0.4 });
    expect(rankCandidateIndices([small, large], 'guarded-band-area')).toEqual([1, 0]);
    const muchLowerScore = features({ score: 0.55, areaFraction: 0.9 });
    expect(rankCandidateIndices([small, muchLowerScore], 'guarded-band-area')).toEqual([0, 1]);
  });

  it('never drops candidates and keeps exact ties in provider order', () => {
    const order = rankCandidateIndices(
      [features({ score: 0.5 }), features({ score: 0.5 }), features({ score: 0.5 })],
      'guarded-band-box',
    );
    expect(order).toEqual([0, 1, 2]);
  });
});

function evaluationCase(
  caseId: string,
  category: string,
  candidateIoU: number[],
  featureOverrides: Partial<CandidateRankingFeatures>[],
): CandidateRankingCase {
  return {
    caseId,
    category,
    candidateIoU,
    providerSelectedIndex: 0,
    features: candidateIoU.map((_, index) => features(featureOverrides[index] ?? {})),
  };
}

describe('evaluateRankingPolicy', () => {
  const cases: CandidateRankingCase[] = [
    evaluationCase('a', 'easy', [0.9, 0.6], [{ score: 0.9 }, { score: 0.5 }]),
    evaluationCase('b', 'hard', [0.4, 0.8], [{ score: 0.7 }, { score: 0.6 }]),
  ];

  it('reports top-1, oracle, regret, and top-k recall', () => {
    const provider = evaluateRankingPolicy(cases, 'provider');
    expect(provider.meanTop1IoU).toBeCloseTo((0.9 + 0.4) / 2, 10);
    expect(provider.meanBestAvailableIoU).toBeCloseTo((0.9 + 0.8) / 2, 10);
    expect(provider.meanRegret).toBeCloseTo(0.2, 10);
    expect(provider.worstRegret).toBeCloseTo(0.4, 10);
    // Case b's acceptable candidate sits at rank 2.
    expect(provider.acceptableAtK).toEqual([1, 1]);
    expect(provider.top1AcceptableRate).toBeCloseTo(0.5, 10);
    expect(provider.coverageRate).toBe(1);

    const score = evaluateRankingPolicy(cases, 'score');
    expect(score.meanRegret).toBeCloseTo(0.2, 10);
  });

  it('counts acceptance with the declared regret band', () => {
    const borderline = [
      evaluationCase('c', 'easy', [0.85, 0.8], [{ score: 0.85 }, { score: 0.8 }]),
    ];
    expect(evaluateRankingPolicy(borderline, 'provider').top1AcceptableRate).toBe(1);
    const outside = [evaluationCase('d', 'easy', [0.74, 0.85], [{ score: 0.85 }, { score: 0.8 }])];
    expect(evaluateRankingPolicy(outside, 'provider').top1AcceptableRate).toBe(0);
    expect(CANDIDATE_ACCEPTABLE_REGRET).toBe(0.1);
  });

  it('produces per-category tails for worst-category checks', () => {
    const byCategory = evaluateRankingPolicyByCategory(cases, 'provider');
    expect(Object.keys(byCategory)).toEqual(['easy', 'hard']);
    expect(byCategory.hard?.worstRegret).toBeCloseTo(0.4, 10);
    expect(byCategory.easy?.worstRegret).toBe(0);
  });
});
