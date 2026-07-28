/**
 * Confidence calibration and open-set rejection for font classification.
 *
 * A classifier trained on a fixed catalogue will always choose one of its known
 * classes, even when the actual font is absent. This module converts raw
 * probabilities into honest confidence categories and rejects out-of-distribution
 * inputs rather than producing false precision.
 */

import type {
  ConfidenceCategory,
  FontCandidate,
  RenderCompareScores,
  TypographyFeatures,
} from './fontDetectionTypes';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = {
  likelyThreshold: 0.6,
  plausibleThreshold: 0.35,
  similarThreshold: 0.15,
  strongMargin: 0.3,
  weakMargin: 0.05,
  highEntropy: 2.5,
  temperature: 1.5,
  minQualityScore: 0.3,
};

export type ConfidenceConfig = typeof DEFAULT_CONFIG;

// ---------------------------------------------------------------------------
// Temperature scaling
// ---------------------------------------------------------------------------

/**
 * Apply temperature scaling to raw probabilities. Higher temperature flattens
 * the distribution (reduces overconfidence); lower sharpens it.
 */
export function temperatureScale(
  probabilities: number[],
  temperature: number = DEFAULT_CONFIG.temperature,
): number[] {
  if (probabilities.length === 0) return [];
  if (temperature <= 0) return [...probabilities];

  const scaled = probabilities.map((p) => Math.max(p, 1e-10) ** (1 / temperature));
  const sum = scaled.reduce((a, b) => a + b, 0);
  if (sum === 0) return probabilities.map(() => 1 / probabilities.length);
  return scaled.map((s) => s / sum);
}

// ---------------------------------------------------------------------------
// Entropy
// ---------------------------------------------------------------------------

/**
 * Shannon entropy of a probability distribution, in bits.
 */
export function distributionEntropy(probabilities: number[]): number {
  let entropy = 0;
  for (const p of probabilities) {
    if (p > 1e-10) {
      entropy -= p * Math.log2(p);
    }
  }
  return entropy;
}

// ---------------------------------------------------------------------------
// Margin computation
// ---------------------------------------------------------------------------

export interface MarginAnalysis {
  top1Prob: number;
  top2Prob: number;
  margin: number;
  isConfident: boolean;
}

export function analyzeMargin(sortedProbabilities: number[]): MarginAnalysis {
  const top1 = sortedProbabilities[0] ?? 0;
  const top2 = sortedProbabilities[1] ?? 0;
  const margin = top1 - top2;
  return {
    top1Prob: top1,
    top2Prob: top2,
    margin,
    isConfident: margin >= DEFAULT_CONFIG.strongMargin,
  };
}

// ---------------------------------------------------------------------------
// Quality score
// ---------------------------------------------------------------------------

/**
 * Estimate crop quality from simple image statistics. Returns 0-1.
 */
export function estimateCropQuality(imageData: ImageData): number {
  const { width, height, data } = imageData;

  const minDim = Math.min(width, height);
  if (minDim < 20) return 0;
  const sizeScore = Math.min(1, minDim / 64);

  let sum = 0;
  let sumSq = 0;
  const pixelCount = width * height;
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / pixelCount;
  const variance = sumSq / pixelCount - mean * mean;
  const stdDev = Math.sqrt(Math.max(0, variance));
  const contrastScore = Math.min(1, stdDev / 60);

  return sizeScore * 0.4 + contrastScore * 0.6;
}

// ---------------------------------------------------------------------------
// Calibrated confidence categorization
// ---------------------------------------------------------------------------

export interface CalibrationInput {
  probabilities: number[];
  classIndices?: number[];
  cropQuality: number;
  renderAgreement?: number;
  isInCatalogue: boolean;
  features?: TypographyFeatures | null;
}

export interface CalibrationResult {
  category: ConfidenceCategory;
  calibratedScore: number;
  matchType: FontCandidate['matchType'];
  margin: number;
  entropy: number;
  reasons: string[];
}

/**
 * Convert raw classifier output into a calibrated confidence category.
 */
export function calibrateConfidence(input: CalibrationInput): CalibrationResult {
  const reasons: string[] = [];
  const { probabilities, cropQuality, renderAgreement, isInCatalogue, features } = input;

  if (probabilities.length === 0) {
    return {
      category: 'insufficient-quality',
      calibratedScore: 0,
      matchType: 'unknown',
      margin: 0,
      entropy: 0,
      reasons: ['No classification output'],
    };
  }

  const scaled = temperatureScale(probabilities);
  const top1 = scaled[0] ?? 0;
  const top2 = scaled[1] ?? 0;
  const margin = top1 - top2;
  const entropy = distributionEntropy(scaled);

  let combinedScore = top1;
  if (renderAgreement !== undefined) {
    combinedScore = combinedScore * 0.6 + renderAgreement * 0.4;
    if (renderAgreement < 0.3) {
      reasons.push('Low render-comparison agreement');
    }
  }

  if (cropQuality < DEFAULT_CONFIG.minQualityScore) {
    reasons.push('Low crop quality');
    combinedScore *= cropQuality;
  }

  if (entropy > DEFAULT_CONFIG.highEntropy) {
    reasons.push('High prediction entropy');
    combinedScore *= 0.7;
  }

  if (margin < DEFAULT_CONFIG.weakMargin) {
    reasons.push('Ambiguous top candidates');
  }

  let category: ConfidenceCategory;
  let matchType: FontCandidate['matchType'];

  if (!isInCatalogue) {
    category = 'out-of-catalogue';
    matchType = 'proprietary-unavailable';
    reasons.push('Font not in supported catalogue');
  } else if (
    combinedScore >= DEFAULT_CONFIG.likelyThreshold &&
    margin >= DEFAULT_CONFIG.strongMargin
  ) {
    category = 'likely-match';
    matchType = 'exact-installed';
  } else if (combinedScore >= DEFAULT_CONFIG.plausibleThreshold) {
    category = 'plausible-match';
    matchType = margin >= DEFAULT_CONFIG.strongMargin ? 'exact-installed' : 'style-variant';
  } else if (combinedScore >= DEFAULT_CONFIG.similarThreshold) {
    category = 'similar-candidate';
    matchType = 'similar-installed';
  } else {
    category = 'low-confidence';
    matchType = 'unknown';
    reasons.push('Low confidence score');
  }

  if (features && category === 'likely-match') {
    const featureConfidence = assessFeatureAgreement(features);
    if (featureConfidence < 0.3) {
      category = 'plausible-match';
      reasons.push('Typography features disagree with prediction');
    }
  }

  return {
    category,
    calibratedScore: Math.round(combinedScore * 1000) / 1000,
    matchType,
    margin: Math.round(margin * 1000) / 1000,
    entropy: Math.round(entropy * 1000) / 1000,
    reasons,
  };
}

function assessFeatureAgreement(features: TypographyFeatures): number {
  let score = 0.5;
  if (features.serif !== 'unknown') score += 0.15;
  if (features.monospace !== null) score += 0.15;
  if (features.category !== 'unknown') score += 0.1;
  if (features.weightEstimate >= 100 && features.weightEstimate <= 900) score += 0.1;
  return Math.min(1, score);
}

// ---------------------------------------------------------------------------
// Score combination
// ---------------------------------------------------------------------------

/**
 * Combine classifier probability with render-comparison score.
 */
export function combineScores(
  classifierProb: number,
  renderScore: number | undefined,
  classifierWeight: number = 0.6,
): number {
  if (renderScore === undefined) return classifierProb;
  const effectiveWeight = classifierProb > 0.5 ? classifierWeight : 0.4;
  return classifierProb * effectiveWeight + renderScore * (1 - effectiveWeight);
}

/**
 * Compute composite score from render-compare components.
 */
export function compositeRenderScore(scores: RenderCompareScores): number {
  return (
    scores.silhouetteOverlap * 0.35 +
    scores.strokeWidthSimilarity * 0.25 +
    (1 - Math.min(1, scores.xHeightDelta)) * 0.2 +
    scores.charWidthRatio * 0.2
  );
}

/**
 * Sort and re-rank candidates by their final scores.
 */
export function rankCandidates(candidates: FontCandidate[]): FontCandidate[] {
  candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
  for (let i = 0; i < candidates.length; i++) {
    candidates[i]!.rank = i;
  }
  return candidates;
}
