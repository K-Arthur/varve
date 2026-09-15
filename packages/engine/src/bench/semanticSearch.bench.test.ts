/** Exact-search scale baseline for the local semantic index decision. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { searchSemantic } from '../semanticSimilarity/search';
import type { EmbeddingVector, SimilarityCandidate } from '../semanticSimilarity/types';

function vector(index: number, dimension = 32): EmbeddingVector {
  const values = new Float32Array(dimension);
  values[index % dimension] = 1;
  const noiseIndex = (index * 7 + 3) % dimension;
  values[noiseIndex] = (values[noiseIndex] ?? 0) + 0.01;
  return {
    modelId: 'bench',
    modelRevision: 'r1',
    embeddingSpaceVersion: 'bench-v1',
    preprocessingVersion: 'bench-prep-v1',
    dimension,
    dtype: 'fp32',
    normalized: false,
    values,
  };
}

function candidates(count: number): SimilarityCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `asset-${index.toString().padStart(6, '0')}`,
    contentId: `content-${index}`,
    embedding: vector(index),
  }));
}

describe('semantic exact-search scale baseline', () => {
  it('records 100/1k/10k/50k candidate scans without changing ranking semantics', () => {
    const timings: Record<number, number> = {};
    const query = vector(7);
    for (const size of [100, 1_000, 10_000, 50_000]) {
      const items = candidates(size);
      const started = performance.now();
      const results = searchSemantic(query, items, 10);
      timings[size] = performance.now() - started;
      expect(results).toHaveLength(10);
      expect(results[0]?.candidate.id).toBe('asset-000007');
    }
    console.info(`SEMANTIC_EXACT_SEARCH_BENCH ${JSON.stringify(timings)}`);
    expect(Object.values(timings).every(Number.isFinite)).toBe(true);
  }, 30_000);
});
