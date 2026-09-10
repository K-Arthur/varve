/**
 * Quality metrics for background-removal benchmark masks.
 *
 * Binary masks and alpha mattes are deliberately represented separately in
 * the result. A binary segmentation target can measure IoU/Dice and boundary
 * quality, but it must not be presented as evidence of true alpha matting.
 */

export interface MaskQualityMetrics {
  /** Binary metrics use this threshold on both masks. */
  threshold: number;
  iou: number;
  dice: number;
  precision: number;
  recall: number;
  fBeta: number;
  /** Mean absolute error over the full soft mask, normalised to [0, 1]. */
  mae: number;
  /** Boundary matching metrics, using the configured pixel tolerance. */
  boundaryPrecision: number;
  boundaryRecall: number;
  boundaryFScore: number;
  boundaryTolerance: number;
  /** Alpha-matting metrics are only populated when the target is an alpha matte. */
  alphaSAD?: number;
  alphaMSE?: number;
  alphaGradientError?: number;
  trimapBandMae?: number;
}

export interface MaskQualityOptions {
  threshold?: number;
  boundaryTolerance?: number;
  /** Optional 0–255 trimap; only unknown (neither 0 nor 255) pixels are scored. */
  trimap?: Uint8Array;
  /** Mark the target as a genuine alpha matte, not a binary segmentation mask. */
  alphaTarget?: boolean;
}

function assertCompatible(
  predicted: Uint8Array,
  expected: Uint8Array,
  width: number,
  height: number,
) {
  const expectedLength = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Mask dimensions must be positive integers, received ${width}x${height}`);
  }
  if (predicted.length !== expectedLength || expected.length !== expectedLength) {
    throw new Error(
      `Mask length mismatch for ${width}x${height}: predicted=${predicted.length}, expected=${expected.length}`,
    );
  }
}

function isForeground(value: number, threshold: number): boolean {
  return value >= threshold;
}

function isBoundary(
  mask: Uint8Array,
  index: number,
  width: number,
  height: number,
  threshold: number,
) {
  const x = index % width;
  const y = Math.floor(index / width);
  const value = isForeground(mask[index] ?? 0, threshold);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (isForeground(mask[ny * width + nx] ?? 0, threshold) !== value) return true;
    }
  }
  return false;
}

function boundaryPixels(
  mask: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): number[] {
  const result: number[] = [];
  for (let index = 0; index < mask.length; index++) {
    if (isBoundary(mask, index, width, height, threshold)) result.push(index);
  }
  return result;
}

function hasNearbyPixel(
  index: number,
  candidates: Set<number>,
  width: number,
  height: number,
  radius: number,
) {
  const x = index % width;
  const y = Math.floor(index / width);
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && candidates.has(ny * width + nx)) {
        return true;
      }
    }
  }
  return false;
}

function safeRatio(numerator: number, denominator: number, emptyValue = 1): number {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function gradientError(
  predicted: Uint8Array,
  expected: Uint8Array,
  width: number,
  height: number,
): number {
  if (width < 2 && height < 2) return 0;
  let error = 0;
  let samples = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (x + 1 < width) {
        error += Math.abs(
          (predicted[index + 1]! - predicted[index]!) / 255 -
            (expected[index + 1]! - expected[index]!) / 255,
        );
        samples++;
      }
      if (y + 1 < height) {
        error += Math.abs(
          (predicted[index + width]! - predicted[index]!) / 255 -
            (expected[index + width]! - expected[index]!) / 255,
        );
        samples++;
      }
    }
  }
  return safeRatio(error, samples, 0);
}

/** Compare a predicted soft mask with a binary or alpha target. */
export function computeMaskQualityMetrics(
  predicted: Uint8Array,
  expected: Uint8Array,
  width: number,
  height: number,
  options: MaskQualityOptions = {},
): MaskQualityMetrics {
  assertCompatible(predicted, expected, width, height);
  if (options.trimap && options.trimap.length !== predicted.length) {
    throw new Error(
      `Trimap length mismatch: expected ${predicted.length}, received ${options.trimap.length}`,
    );
  }

  const threshold = Math.max(0, Math.min(255, options.threshold ?? 128));
  const boundaryTolerance = Math.max(0, Math.round(options.boundaryTolerance ?? 2));
  let intersection = 0;
  let union = 0;
  let predictedPositive = 0;
  let expectedPositive = 0;
  let absoluteError = 0;
  let squaredError = 0;
  let trimapError = 0;
  let trimapSamples = 0;

  for (let index = 0; index < predicted.length; index++) {
    const predictedValue = predicted[index] ?? 0;
    const expectedValue = expected[index] ?? 0;
    const predictedFg = isForeground(predictedValue, threshold);
    const expectedFg = isForeground(expectedValue, threshold);
    if (predictedFg) predictedPositive++;
    if (expectedFg) expectedPositive++;
    if (predictedFg && expectedFg) intersection++;
    if (predictedFg || expectedFg) union++;
    const difference = Math.abs(predictedValue - expectedValue) / 255;
    absoluteError += difference;
    squaredError += difference * difference;
    if (options.trimap && (options.trimap[index] ?? 0) > 0 && (options.trimap[index] ?? 0) < 255) {
      trimapError += difference;
      trimapSamples++;
    }
  }

  const predictedBoundary = boundaryPixels(predicted, width, height, threshold);
  const expectedBoundary = boundaryPixels(expected, width, height, threshold);
  const predictedBoundarySet = new Set(predictedBoundary);
  const expectedBoundarySet = new Set(expectedBoundary);
  const matchedPredicted = predictedBoundary.filter((index) =>
    hasNearbyPixel(index, expectedBoundarySet, width, height, boundaryTolerance),
  ).length;
  const matchedExpected = expectedBoundary.filter((index) =>
    hasNearbyPixel(index, predictedBoundarySet, width, height, boundaryTolerance),
  ).length;
  const boundaryPrecision = safeRatio(matchedPredicted, predictedBoundary.length);
  const boundaryRecall = safeRatio(matchedExpected, expectedBoundary.length);

  const metrics: MaskQualityMetrics = {
    threshold,
    iou: safeRatio(intersection, union),
    dice: safeRatio(2 * intersection, predictedPositive + expectedPositive),
    precision: safeRatio(intersection, predictedPositive),
    recall: safeRatio(intersection, expectedPositive),
    // F0.3 weights precision more heavily, which is useful for cutouts where
    // a visible background halo is usually worse than a small edge omission.
    fBeta: safeRatio(1.09 * intersection, 0.09 * predictedPositive + expectedPositive),
    mae: absoluteError / predicted.length,
    boundaryPrecision,
    boundaryRecall,
    boundaryFScore: safeRatio(
      2 * boundaryPrecision * boundaryRecall,
      boundaryPrecision + boundaryRecall,
    ),
    boundaryTolerance,
  };

  if (options.alphaTarget) {
    metrics.alphaSAD = absoluteError;
    metrics.alphaMSE = squaredError / predicted.length;
    metrics.alphaGradientError = gradientError(predicted, expected, width, height);
  }
  if (options.trimap) metrics.trimapBandMae = safeRatio(trimapError, trimapSamples, 0);
  return metrics;
}

export interface BenchmarkMetricSample {
  category: string;
  metrics: MaskQualityMetrics;
}

/** Aggregate a metric without allowing a large category to hide a small one. */
export function aggregateMetrics(
  samples: BenchmarkMetricSample[],
): Record<string, MaskQualityMetrics> {
  const byCategory = new Map<string, MaskQualityMetrics[]>();
  for (const sample of samples) {
    const values = byCategory.get(sample.category) ?? [];
    values.push(sample.metrics);
    byCategory.set(sample.category, values);
  }
  const aggregate: Record<string, MaskQualityMetrics> = {};
  for (const [category, values] of byCategory) {
    const keys = Object.keys(values[0]!) as Array<keyof MaskQualityMetrics>;
    const result = { ...values[0]! };
    for (const key of keys) {
      if (key === 'threshold' || key === 'boundaryTolerance') continue;
      const present = values
        .map((value) => value[key])
        .filter((value): value is number => value !== undefined);
      if (present.length > 0)
        (result[key] as number | undefined) =
          present.reduce((sum, value) => sum + value, 0) / present.length;
    }
    aggregate[category] = result;
  }
  return aggregate;
}
