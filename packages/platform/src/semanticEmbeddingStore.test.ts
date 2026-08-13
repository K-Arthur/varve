import { describe, expect, it } from 'vitest';
import { type AssetEmbeddingIdentity, makeAssetEmbeddingRecord } from './assetEmbeddingIndex';
import { MemorySemanticEmbeddingStore } from './semanticEmbeddingStore';

function makeRecord(
  contentHash: string,
  modelVersion = 'siglip-base-patch16-224@xenova-2026-07-21',
  values = new Float32Array([0.6, 0.8, 0, 1]),
): ReturnType<typeof makeAssetEmbeddingRecord> {
  const identity: AssetEmbeddingIdentity = {
    contentHash,
    modelId: 'siglip-base-patch16-224',
    modelVersion,
    preprocessingVersion: 'semantic-rgb-letterbox-neutral-v2',
    embeddingSchemaVersion: 'siglip-image-pooler-v1',
  };
  return makeAssetEmbeddingRecord(identity, values, {
    contentId: `content-${contentHash}`,
    assetId: `asset-${contentHash}`,
    sourceGeneration: 'test',
    createdAt: 1,
  });
}

describe('MemorySemanticEmbeddingStore', () => {
  it('round-trips records and returns copies', async () => {
    const store = new MemorySemanticEmbeddingStore();
    const record = makeRecord('abc');
    await store.put(record);
    const got = await store.get(record.key);
    expect(got).not.toBeNull();
    expect(got!.key).toBe(record.key);
    expect(Array.from(new Uint8Array(got!.bytes))).toEqual(
      Array.from(new Uint8Array(record.bytes)),
    );
    // Mutating the returned record must not affect the store.
    new Uint8Array(got!.bytes)[0] = 0;
    const again = await store.get(record.key);
    expect(new Uint8Array(again!.bytes)[0]).toBe(new Uint8Array(record.bytes)[0]);
  });

  it('returns null for a miss', async () => {
    const store = new MemorySemanticEmbeddingStore();
    expect(await store.get('nope')).toBeNull();
  });

  it('overwrites on the same key and deletes', async () => {
    const store = new MemorySemanticEmbeddingStore();
    const a = makeRecord('abc', 'v1', new Float32Array([1, 0, 0, 0]));
    await store.put(a);
    const b = makeRecord('abc', 'v1', new Float32Array([0, 1, 0, 0]));
    await store.put(b);
    const afterOverwrite = await store.get(a.key);
    expect(Array.from(new Float32Array(afterOverwrite!.bytes))).toEqual([0, 1, 0, 0]);
    await store.delete(a.key);
    expect(await store.get(a.key)).toBeNull();
  });

  it('keys differ when the content or model version changes', () => {
    const a = makeRecord('abc');
    const b = makeRecord('abd');
    const c = makeRecord('abc', 'dinov2-small@reg');
    const keys = new Set([a.key, b.key, c.key]);
    expect(keys.size).toBe(3);
  });

  it('lists and clears all records', async () => {
    const store = new MemorySemanticEmbeddingStore();
    await store.put(makeRecord('x'));
    await store.put(makeRecord('y'));
    expect((await store.listAll()).length).toBe(2);
    await store.clear();
    expect((await store.listAll()).length).toBe(0);
  });
});
