import { describe, expect, it } from 'vitest';
import { assetEmbeddingKey, makeAssetEmbeddingRecord } from './assetEmbeddingIndex';
import { SemanticAssetIndex } from './semanticAssetIndex';

const identity = (contentHash: string) => ({
  contentHash,
  modelId: 'siglip',
  modelVersion: 'r1',
  preprocessingVersion: 'prep-v1',
  embeddingSchemaVersion: 'embedding-v1',
});
const assetKey = assetEmbeddingKey;

function record(contentHash: string, values: number[]) {
  return makeAssetEmbeddingRecord(identity(contentHash), new Float32Array(values), {
    contentId: contentHash,
    sourceGeneration: 'generation-1',
    createdAt: 1,
  });
}

describe('SemanticAssetIndex', () => {
  it('searches compatible vectors deterministically and excludes the query', () => {
    const index = new SemanticAssetIndex();
    const query = record('query', [1, 0]);
    index.upsert(query);
    index.upsert(record('close', [0.99, 0.01]));
    index.upsert(record('far', [0, 1]));

    expect(index.search(query, 2).map((hit) => hit.record.contentId)).toEqual(['close', 'far']);
  });

  it('does not compare incompatible model identities', () => {
    const index = new SemanticAssetIndex();
    const query = record('query', [1, 0]);
    index.upsert(query);
    const other = record('other', [1, 0]);
    const otherIdentity = { ...identity('other'), modelVersion: 'r2' };
    index.upsert({ ...other, identity: otherIdentity, key: assetKey(otherIdentity) });
    expect(index.search(query)).toHaveLength(0);
  });

  it('round-trips snapshots and rejects corrupt records', () => {
    const index = new SemanticAssetIndex();
    index.upsert(record('one', [1, 0]));
    const restored = new SemanticAssetIndex(index.snapshot());
    expect(restored.list()[0]?.contentId).toBe('one');
    expect(() => new SemanticAssetIndex({ schemaVersion: 999 as 1, records: [] })).toThrow(
      /schema version/,
    );
  });

  it('removes all model records for replaced content', () => {
    const index = new SemanticAssetIndex();
    index.upsert(record('same', [1, 0]));
    const secondIdentity = { ...identity('same'), modelVersion: 'r2' };
    index.upsert({
      ...record('same', [0, 1]),
      identity: secondIdentity,
      key: assetKey(secondIdentity),
    });
    expect(index.removeContent('same')).toBe(2);
    expect(index.size).toBe(0);
  });
});
