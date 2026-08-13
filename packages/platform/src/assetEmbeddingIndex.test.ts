import { describe, expect, it } from 'vitest';
import {
  assetEmbeddingKey,
  decodeFloat32Embedding,
  makeAssetEmbeddingRecord,
} from './assetEmbeddingIndex';

const identity = {
  contentHash: 'sha256:abc',
  modelId: 'model',
  modelVersion: 'revision-1',
  preprocessingVersion: 'rgb-letterbox-v1',
  embeddingSchemaVersion: 'asset-embedding-v1',
};

describe('asset embedding index contract', () => {
  it('keys vectors by content and all model identity fields', () => {
    expect(assetEmbeddingKey(identity)).toBe(
      'sha256:abc:model:revision-1:rgb-letterbox-v1:asset-embedding-v1',
    );
  });

  it('round-trips vectors as binary data', () => {
    const record = makeAssetEmbeddingRecord(identity, new Float32Array([1, 0.5, -1]), {
      contentId: 'content-1',
      sourceGeneration: 'import-1',
      createdAt: 1,
    });
    expect(record.bytes).toBeInstanceOf(ArrayBuffer);
    expect([...decodeFloat32Embedding(record.bytes, record.dimension)]).toEqual([1, 0.5, -1]);
  });

  it('rejects stale or malformed byte lengths', async () => {
    const { decodeFloat32Embedding } = await import('./assetEmbeddingIndex');
    expect(() => decodeFloat32Embedding(new ArrayBuffer(4), 2)).toThrow(
      /does not match its dimension/,
    );
  });
});
