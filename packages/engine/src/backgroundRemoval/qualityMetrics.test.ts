import { describe, expect, it } from 'vitest';
import { aggregateMetrics, computeMaskQualityMetrics } from './qualityMetrics';

describe('computeMaskQualityMetrics', () => {
  it('reports perfect binary segmentation and boundary quality', () => {
    const mask = new Uint8Array([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0]);
    const metrics = computeMaskQualityMetrics(mask, mask, 4, 4);
    expect(metrics.iou).toBe(1);
    expect(metrics.dice).toBe(1);
    expect(metrics.boundaryFScore).toBe(1);
    expect(metrics.mae).toBe(0);
    expect(metrics.alphaSAD).toBeUndefined();
  });

  it('separates soft alpha metrics from binary segmentation metrics', () => {
    const expected = new Uint8Array([0, 64, 192, 255]);
    const predicted = new Uint8Array([0, 96, 160, 255]);
    const trimap = new Uint8Array([0, 128, 128, 255]);
    const metrics = computeMaskQualityMetrics(predicted, expected, 4, 1, {
      threshold: 128,
      trimap,
      alphaTarget: true,
    });
    expect(metrics.iou).toBe(1);
    expect(metrics.alphaSAD).toBeGreaterThan(0);
    expect(metrics.alphaMSE).toBeGreaterThan(0);
    expect(metrics.alphaGradientError).toBeGreaterThan(0);
    expect(metrics.trimapBandMae).toBeCloseTo(32 / 255, 6);
  });

  it('matches boundaries within the configured tolerance', () => {
    const expected = new Uint8Array([0, 255, 255, 255, 0, 0]);
    const predicted = new Uint8Array([0, 0, 255, 255, 255, 0]);
    const exact = computeMaskQualityMetrics(predicted, expected, 6, 1, {
      boundaryTolerance: 0,
    });
    const tolerant = computeMaskQualityMetrics(predicted, expected, 6, 1, {
      boundaryTolerance: 2,
    });
    expect(tolerant.boundaryFScore).toBeGreaterThan(exact.boundaryFScore);
  });
});

describe('aggregateMetrics', () => {
  it('aggregates independently by category', () => {
    const perfect = computeMaskQualityMetrics(
      new Uint8Array([0, 255]),
      new Uint8Array([0, 255]),
      2,
      1,
    );
    const poor = computeMaskQualityMetrics(new Uint8Array([0, 0]), new Uint8Array([0, 255]), 2, 1);
    const result = aggregateMetrics([
      { category: 'hair', metrics: perfect },
      { category: 'hair', metrics: poor },
      { category: 'product', metrics: perfect },
    ]);
    expect(result.product?.iou).toBe(1);
    expect(result.hair?.iou).toBeCloseTo(0.5);
  });
});
