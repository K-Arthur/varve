import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  normalizeEmbedding,
  rankBySimilarity,
  SIGLIP_EMBEDDING_OUTPUT_NAME,
  SIGLIP_IMAGE_TENSOR_SPEC,
  SIGLIP_TEXT_EMBEDDING_OUTPUT_NAME,
  SIGLIP_TEXT_INPUT_NAME,
  siglipConstantFeeds,
} from './siglip';

describe('siglip', () => {
  it('uses SigLIP-specific normalization (mean=0.5/std=0.5), not ImageNet stats', () => {
    expect(SIGLIP_IMAGE_TENSOR_SPEC.mean).toEqual([0.5, 0.5, 0.5]);
    expect(SIGLIP_IMAGE_TENSOR_SPEC.std).toEqual([0.5, 0.5, 0.5]);
  });

  it('reads the embedding from image_embeds, the real graph output', () => {
    expect(SIGLIP_EMBEDDING_OUTPUT_NAME).toBe('image_embeds');
  });

  it('reads the text embedding from pooler_output in the matching graph', () => {
    expect(SIGLIP_TEXT_EMBEDDING_OUTPUT_NAME).toBe('pooler_output');
  });

  it('feeds a constant zero token for the graph-required input_ids', () => {
    const feeds = siglipConstantFeeds();
    const text = feeds[SIGLIP_TEXT_INPUT_NAME]!;
    expect(text).toBeDefined();
    expect(text.dtype).toBe('int64');
    expect(text.dims).toEqual([1, 1]);
    expect(Array.from(text.data)).toEqual([0n]);
  });

  describe('normalizeEmbedding', () => {
    it('scales a vector to unit L2 norm', () => {
      const result = normalizeEmbedding(new Float32Array([3, 4]));
      expect(result[0]).toBeCloseTo(0.6, 5);
      expect(result[1]).toBeCloseTo(0.8, 5);
      const norm = Math.sqrt(result[0]! ** 2 + result[1]! ** 2);
      expect(norm).toBeCloseTo(1, 5);
    });

    it('handles an all-zero vector without dividing by zero', () => {
      const result = normalizeEmbedding(new Float32Array([0, 0, 0]));
      expect(Array.from(result)).toEqual([0, 0, 0]);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const v = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(
        0,
        5,
      );
    });

    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(
        -1,
        5,
      );
    });

    it('returns 0 when either vector has zero magnitude', () => {
      expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    });
  });

  describe('rankBySimilarity', () => {
    it('ranks candidates by descending similarity to the query, capped at topK', () => {
      const query = new Float32Array([1, 0]);
      const candidates = [
        { item: 'orthogonal', embedding: new Float32Array([0, 1]) },
        { item: 'identical', embedding: new Float32Array([1, 0]) },
        { item: 'close', embedding: new Float32Array([0.9, 0.1]) },
      ];
      const ranked = rankBySimilarity(query, candidates, 2);
      expect(ranked).toHaveLength(2);
      expect(ranked[0]!.item).toBe('identical');
      expect(ranked[1]!.item).toBe('close');
    });
  });
});
