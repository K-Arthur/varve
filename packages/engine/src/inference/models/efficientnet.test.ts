import { describe, expect, it } from 'vitest';
import {
  decodeEfficientNetOutput,
  EFFICIENTNET_INPUT_SIZE,
  EFFICIENTNET_TENSOR_SPEC,
} from './efficientnet';
import { IMAGENET_LABELS } from './imagenetLabels';

describe('efficientnet', () => {
  it('exposes the verified fixed input size', () => {
    expect(EFFICIENTNET_INPUT_SIZE).toBe(224);
  });

  it('uses the verified (pixel-127)/128 normalization, not ImageNet stats', () => {
    expect(EFFICIENTNET_TENSOR_SPEC.mean[0]).toBeCloseTo(127 / 255, 5);
    expect(EFFICIENTNET_TENSOR_SPEC.std[0]).toBeCloseTo(128 / 255, 5);
  });

  describe('decodeEfficientNetOutput', () => {
    it('returns the top-K classes sorted by descending confidence', () => {
      const data = new Float32Array(1000).fill(0);
      data[5] = 0.7;
      data[10] = 0.9;
      data[999] = 0.5;
      const results = decodeEfficientNetOutput(data, 3);
      expect(results).toHaveLength(3);
      expect(results[0]!.classId).toBe(10);
      expect(results[0]!.confidence).toBeCloseTo(0.9, 5);
      expect(results[1]!.classId).toBe(5);
      expect(results[2]!.classId).toBe(999);
    });

    it('maps class ids to real ImageNet labels', () => {
      const data = new Float32Array(1000).fill(0);
      data[0] = 1; // 'tench' per canonical ImageNet-1k ordering
      const results = decodeEfficientNetOutput(data, 1);
      expect(results[0]!.label).toBe(IMAGENET_LABELS[0]);
      expect(results[0]!.label).toBe('tench');
    });

    it('defaults to top-5 when topK is not specified', () => {
      const data = new Float32Array(1000).fill(0).map((_, i) => i / 1000);
      const results = decodeEfficientNetOutput(data);
      expect(results).toHaveLength(5);
    });

    it('falls back to a synthetic label if the class id has no mapping', () => {
      const data = new Float32Array(1000).fill(0);
      data[500] = 1;
      const results = decodeEfficientNetOutput(data, 1);
      expect(results[0]!.label).toBe(IMAGENET_LABELS[500] ?? 'class_500');
    });
  });
});
