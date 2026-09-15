import { describe, expect, it } from 'vitest';
import { searchNearDuplicates, searchSemantic } from './search';
import type { EmbeddingVector, SimilarityCandidate } from './types';

const vector = (modelId: string, values: number[]): EmbeddingVector => ({
  modelId,
  modelRevision: 'r1',
  embeddingSpaceVersion: 'space-v1',
  preprocessingVersion: 'prep-v1',
  dimension: values.length,
  dtype: 'fp32',
  normalized: false,
  values: new Float32Array(values),
});

const candidate = (
  id: string,
  embedding: EmbeddingVector,
  extra: Partial<SimilarityCandidate> = {},
): SimilarityCandidate => ({
  id,
  contentId: `content-${id}`,
  embedding,
  ...extra,
});

describe('semantic similarity lanes', () => {
  it('searches semantic candidates without a perceptual-hash prefilter', () => {
    const query = vector('model', [1, 0]);
    const results = searchSemantic(query, [
      candidate('semantic', vector('model', [0.9, 0.1]), { pHash: 'ffff' }),
      candidate('hash-dissimilar', vector('model', [0.8, 0.2]), { pHash: '0000' }),
    ]);

    expect(results.map((result) => result.candidate.id)).toEqual(['semantic', 'hash-dissimilar']);
  });

  it('does not compare incompatible embedding spaces', () => {
    const results = searchSemantic(vector('model-a', [1, 0]), [
      candidate('other', vector('model-b', [1, 0])),
    ]);
    expect(results).toEqual([]);
  });

  it('keeps exact content ahead of semantic similarity in duplicate mode', () => {
    const queryEmbedding = vector('model', [1, 0]);
    const results = searchNearDuplicates(
      {
        id: 'query',
        contentId: 'q',
        exactContentHash: 'same',
        pHash: '0000',
        embedding: queryEmbedding,
      },
      [
        candidate('semantic-only', vector('model', [1, 0]), {
          exactContentHash: 'different',
          pHash: 'ffff',
        }),
        candidate('exact', vector('model', [0, 1]), { exactContentHash: 'same', pHash: 'ffff' }),
      ],
    );

    expect(results[0]!.candidate.id).toBe('exact');
    expect(results[0]!.signals.exactContent).toBe(true);
  });
});
