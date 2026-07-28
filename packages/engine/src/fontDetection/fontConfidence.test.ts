import { describe, expect, it } from 'vitest';
import {
  analyzeMargin,
  calibrateConfidence,
  combineScores,
  compositeRenderScore,
  distributionEntropy,
  estimateCropQuality,
  rankCandidates,
  temperatureScale,
} from './fontConfidence';
import type { FontCandidate } from './fontDetectionTypes';

describe('temperatureScale', () => {
  it('returns empty array for empty input', () => {
    expect(temperatureScale([])).toEqual([]);
  });

  it('flattens distribution with high temperature', () => {
    const probs = [0.9, 0.05, 0.05];
    const scaled = temperatureScale(probs, 3.0);
    expect(scaled[0]!).toBeLessThan(probs[0]!);
    expect(scaled[1]!).toBeGreaterThan(probs[1]!);
  });

  it('preserves order', () => {
    const probs = [0.7, 0.2, 0.1];
    const scaled = temperatureScale(probs);
    expect(scaled[0]!).toBeGreaterThan(scaled[1]!);
    expect(scaled[1]!).toBeGreaterThan(scaled[2]!);
  });
});

describe('distributionEntropy', () => {
  it('returns 0 for deterministic distribution', () => {
    const entropy = distributionEntropy([1, 0, 0]);
    expect(entropy).toBeCloseTo(0, 5);
  });

  it('returns max entropy for uniform distribution', () => {
    const entropy = distributionEntropy([0.25, 0.25, 0.25, 0.25]);
    expect(entropy).toBeCloseTo(2.0, 5);
  });

  it('returns higher entropy for flatter distributions', () => {
    const peaked = distributionEntropy([0.9, 0.05, 0.05]);
    const flat = distributionEntropy([0.4, 0.3, 0.3]);
    expect(flat).toBeGreaterThan(peaked);
  });
});

describe('analyzeMargin', () => {
  it('returns correct margin between top candidates', () => {
    const result = analyzeMargin([0.7, 0.2, 0.1]);
    expect(result.margin).toBeCloseTo(0.5, 5);
    expect(result.isConfident).toBe(true);
  });

  it('flags small margin as not confident', () => {
    const result = analyzeMargin([0.3, 0.28, 0.22]);
    expect(result.isConfident).toBe(false);
  });
});

describe('estimateCropQuality', () => {
  it('returns 0 for tiny crops', () => {
    const data = new Uint8ClampedArray(10 * 10 * 4).fill(128);
    const quality = estimateCropQuality(new ImageData(data, 10, 10));
    expect(quality).toBe(0);
  });

  it('returns higher quality for high-contrast crops', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < data.length; i += 4) {
      const val = Math.floor(i / 4) % 100 < 50 ? 0 : 255;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
      data[i + 3] = 255;
    }
    const quality = estimateCropQuality(new ImageData(data, 100, 100));
    expect(quality).toBeGreaterThan(0.5);
  });
});

describe('calibrateConfidence', () => {
  it('returns insufficient-quality for empty probabilities', () => {
    const result = calibrateConfidence({
      probabilities: [],
      cropQuality: 0.8,
      isInCatalogue: true,
    });
    expect(result.category).toBe('insufficient-quality');
  });

  it('categorizes high-confidence in-catalogue as likely-match', () => {
    const result = calibrateConfidence({
      probabilities: [0.85, 0.1, 0.05],
      cropQuality: 0.9,
      isInCatalogue: true,
    });
    expect(result.category).toBe('likely-match');
    expect(result.matchType).toBe('exact-installed');
  });

  it('downgrades out-of-catalogue predictions', () => {
    const result = calibrateConfidence({
      probabilities: [0.95, 0.03, 0.02],
      cropQuality: 0.9,
      isInCatalogue: false,
    });
    expect(result.category).toBe('out-of-catalogue');
    expect(result.matchType).toBe('proprietary-unavailable');
  });

  it('downgrades low-confidence predictions', () => {
    const result = calibrateConfidence({
      probabilities: [0.05, 0.04, 0.03, 0.03, 0.02, 0.02, 0.01],
      cropQuality: 0.4,
      isInCatalogue: true,
    });
    expect(result.category).toBe('low-confidence');
  });

  it('penalizes low crop quality', () => {
    const result = calibrateConfidence({
      probabilities: [0.8, 0.1, 0.1],
      cropQuality: 0.1,
      isInCatalogue: true,
    });
    expect(result.category).not.toBe('likely-match');
  });
});

describe('combineScores', () => {
  it('returns classifier score when no render score', () => {
    expect(combineScores(0.8, undefined)).toBeCloseTo(0.8, 5);
  });

  it('weights classifier more when confident', () => {
    const combined = combineScores(0.8, 0.4);
    expect(combined).toBeGreaterThan(0.5);
  });

  it('weights render more when classifier is uncertain', () => {
    const combined = combineScores(0.3, 0.9);
    expect(combined).toBeGreaterThan(0.5);
  });
});

describe('compositeRenderScore', () => {
  it('combines component scores with correct weights', () => {
    const score = compositeRenderScore({
      silhouetteOverlap: 0.8,
      strokeWidthSimilarity: 0.6,
      xHeightDelta: 0.2,
      charWidthRatio: 0.7,
      compositeScore: 0,
    });
    const expected = 0.8 * 0.35 + 0.6 * 0.25 + (1 - 0.2) * 0.2 + 0.7 * 0.2;
    expect(score).toBeCloseTo(expected, 5);
  });
});

describe('rankCandidates', () => {
  it('sorts candidates by confidence score descending', () => {
    const candidates: FontCandidate[] = [
      { rank: 0, family: 'B', style: 'Regular', confidenceScore: 0.3 } as FontCandidate,
      { rank: 0, family: 'A', style: 'Regular', confidenceScore: 0.9 } as FontCandidate,
      { rank: 0, family: 'C', style: 'Regular', confidenceScore: 0.5 } as FontCandidate,
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0]!.family).toBe('A');
    expect(ranked[1]!.family).toBe('C');
    expect(ranked[2]!.family).toBe('B');
  });

  it('updates rank positions after sorting', () => {
    const candidates: FontCandidate[] = [
      { rank: 0, family: 'B', style: 'Regular', confidenceScore: 0.3 } as FontCandidate,
      { rank: 0, family: 'A', style: 'Regular', confidenceScore: 0.9 } as FontCandidate,
    ];
    const ranked = rankCandidates(candidates);
    expect(ranked[0]!.rank).toBe(0);
    expect(ranked[1]!.rank).toBe(1);
  });
});
