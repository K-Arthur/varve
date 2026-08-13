/**
 * SemanticAssetSearchService tests — bounded queue scheduling, dedup by
 * content hash, rank fusion input, model-gated behavior, and cleanup.
 */

import type { Asset } from '@varve/platform';
import {
  type AssetEmbeddingIdentity,
  type AssetEmbeddingRecord,
  MemorySemanticEmbeddingStore,
} from '@varve/platform';
import { describe, expect, it } from 'vitest';
import {
  createSemanticAssetSearchService,
  SEMANTIC_EMBEDDING_SCHEMA_VERSION,
  type SemanticSearchDeps,
  type SemanticSearchStatus,
} from './semanticAssetSearch';

const MODEL = {
  modelId: 'siglip-base-patch16-224',
  modelVersion: 'xenova-onnx-2026-07-21',
  preprocessingVersion: 'semantic-rgb-letterbox-neutral-v2',
};

function makeAsset(partial: Partial<Asset> & { id: string }): Asset {
  return {
    workspaceId: 'ws-1',
    name: `${partial.id}.png`,
    kind: 'image',
    mimeType: 'image/png',
    size: 4,
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

function fakeEmbedding(seed: number): Float32Array {
  const values = new Float32Array(768);
  for (let i = 0; i < 768; i++) values[i] = Math.sin(seed * 1000 + i);
  let norm = 0;
  for (let i = 0; i < 768; i++) norm += values[i]! * values[i]!;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < 768; i++) values[i] = values[i]! / norm;
  return values;
}

function makeDeps(overrides: Partial<SemanticSearchDeps> = {}): SemanticSearchDeps {
  const store = new MemorySemanticEmbeddingStore();
  const statuses: SemanticSearchStatus[] = [];
  return {
    store,
    getAssetBytes: (id) => Promise.resolve(new Uint8Array([1, 2, 3, id.length])),
    isImageModelAvailable: () => Promise.resolve(true),
    isTextModelAvailable: () => Promise.resolve(true),
    getImageModelPath: () => Promise.resolve('/models/siglip.onnx'),
    getTextModelPath: () => Promise.resolve('/models/siglip-text.onnx'),
    onStatus: (status) => statuses.push(status),
    decodeImage: async () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }),
    embedImage: async (_image, _path, _signal) => ({
      modelId: MODEL.modelId,
      modelRevision: MODEL.modelVersion,
      embeddingSpaceVersion: 'siglip-image-pooler-v1',
      preprocessingVersion: MODEL.preprocessingVersion,
      dimension: 768,
      dtype: 'fp32',
      normalized: true,
      values: fakeEmbedding(1),
    }),
    embedText: async (query, _path, _signal) => ({
      modelId: MODEL.modelId,
      modelRevision: MODEL.modelVersion,
      embeddingSpaceVersion: 'siglip-image-pooler-v1',
      preprocessingVersion: MODEL.preprocessingVersion,
      dimension: 768,
      dtype: 'fp32',
      normalized: true,
      values: fakeEmbedding(query.length),
    }),
    ...overrides,
  };
}

async function flushQueue(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SemanticAssetSearchService', () => {
  it('indexes image assets without records through bounded jobs', async () => {
    const deps = makeDeps();
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    const asset = makeAsset({ id: 'a1', contentHash: 'hash-a1' });
    await svc.sync([asset]);
    await flushQueue();
    expect(await deps.store.listAll()).toHaveLength(1);
    const records = await deps.store.listAll();
    expect(records[0]!.identity.contentHash).toBe('hash-a1');
    expect(records[0]!.assetId).toBe('a1');
  });

  it('never embeds the same content twice (dedup across duplicates)', async () => {
    let embedCalls = 0;
    const deps = makeDeps({
      embedImage: async () => {
        embedCalls += 1;
        return {
          modelId: MODEL.modelId,
          modelRevision: MODEL.modelVersion,
          embeddingSpaceVersion: 'siglip-image-pooler-v1',
          preprocessingVersion: MODEL.preprocessingVersion,
          dimension: 768,
          dtype: 'fp32',
          normalized: true,
          values: fakeEmbedding(7),
        };
      },
    });
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    const first = makeAsset({ id: 'copy-1', contentHash: 'same-bytes' });
    const second = makeAsset({ id: 'copy-2', contentHash: 'same-bytes' });
    await svc.sync([first, second]);
    await flushQueue();
    expect(embedCalls).toBe(1);
    const records = await deps.store.listAll();
    expect(records).toHaveLength(1);
  });

  it('skips jobs when the image model is unavailable', async () => {
    const deps = makeDeps({ isImageModelAvailable: () => Promise.resolve(false) });
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    await svc.sync([makeAsset({ id: 'a1', contentHash: 'hash-a1' })]);
    await flushQueue();
    expect(await deps.store.listAll()).toHaveLength(0);
  });

  it('returns null ranks when the text model is missing', async () => {
    const deps = makeDeps({ isTextModelAvailable: () => Promise.resolve(false) });
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    await svc.sync([makeAsset({ id: 'a1', contentHash: 'hash-a1' })]);
    await flushQueue();
    const ranks = await svc.search('orange sunset', new AbortController().signal);
    expect(ranks).toBeNull();
  });

  it('ranks assets for a natural-language query', async () => {
    const deps = makeDeps();
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    const first = makeAsset({ id: 'a1', contentHash: 'hash-a1' });
    const second = makeAsset({ id: 'a2', contentHash: 'hash-a2' });
    await svc.sync([first, second]);
    await flushQueue();
    const ranks = await svc.search('orange sunset over mountains', new AbortController().signal);
    expect(ranks).not.toBeNull();
    expect(ranks!.size).toBe(2);
    for (const rank of ranks!.values()) expect(rank).toBeGreaterThan(0);
  });

  it('maps one record to every asset sharing its content hash', async () => {
    const deps = makeDeps();
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    const first = makeAsset({ id: 'copy-1', contentHash: 'same-bytes' });
    const second = makeAsset({ id: 'copy-2', contentHash: 'same-bytes' });
    await svc.sync([first, second]);
    await flushQueue();
    const ranks = await svc.search('anything', new AbortController().signal);
    expect(ranks!.has('copy-1')).toBe(true);
    expect(ranks!.has('copy-2')).toBe(true);
  });

  it('reuses existing records after a rename (same content hash)', async () => {
    let embedCalls = 0;
    const deps = makeDeps({
      embedImage: async () => {
        embedCalls += 1;
        return {
          modelId: MODEL.modelId,
          modelRevision: MODEL.modelVersion,
          embeddingSpaceVersion: 'siglip-image-pooler-v1',
          preprocessingVersion: MODEL.preprocessingVersion,
          dimension: 768,
          dtype: 'fp32',
          normalized: true,
          values: fakeEmbedding(1),
        };
      },
    });
    const svc = createSemanticAssetSearchService(deps);
    const original = makeAsset({ id: 'a1', contentHash: 'same-bytes' });
    await svc.sync([original]);
    await flushQueue();
    expect(embedCalls).toBe(1);
    const renamed = makeAsset({ id: 'a1', name: 'renamed.png', contentHash: 'same-bytes' });
    await svc.sync([renamed]);
    await flushQueue();
    expect(embedCalls).toBe(1);
  });

  it('clear() drops all derived records', async () => {
    const deps = makeDeps();
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    await svc.sync([makeAsset({ id: 'a1', contentHash: 'hash-a1' })]);
    await flushQueue();
    expect(await deps.store.listAll()).toHaveLength(1);
    await svc.clear();
    expect(await deps.store.listAll()).toHaveLength(0);
    expect(svc.status.indexedCount).toBe(0);
  });

  it('publishes status including indexing progress', async () => {
    const statuses: SemanticSearchStatus[] = [];
    const deps = makeDeps({ onStatus: (s) => statuses.push(s) });
    const svc = createSemanticAssetSearchService(deps);
    await svc.start();
    await svc.sync([makeAsset({ id: 'a1', contentHash: 'hash-a1' })]);
    await flushQueue();
    const latest = statuses[statuses.length - 1]!;
    expect(latest.indexedCount).toBe(1);
    expect(latest.imageModelAvailable).toBe(true);
    expect(latest.textModelAvailable).toBe(true);
  });

  it('skips corrupt records from the persistent store without breaking search', async () => {
    const store = new MemorySemanticEmbeddingStore();
    const bad = {
      key: 'not-a-real-key',
      contentId: 'x',
      identity: {
        contentHash: 'x',
        ...MODEL,
        embeddingSchemaVersion: SEMANTIC_EMBEDDING_SCHEMA_VERSION,
      } as AssetEmbeddingIdentity,
      dtype: 'float32' as const,
      dimension: 768,
      bytes: new ArrayBuffer(4),
      sourceGeneration: 'x',
      createdAt: 0,
    } satisfies AssetEmbeddingRecord;
    await store.put(bad);
    const deps = makeDeps({ store });
    const svc = createSemanticAssetSearchService(deps);
    await expect(svc.start()).resolves.toBeUndefined();
    // The valid record that follows the corrupt one is still usable.
    const good = makeAsset({ id: 'good', contentHash: 'good-hash' });
    await svc.sync([good]);
    await flushQueue();
    const records = await deps.store.listAll();
    expect(records).toHaveLength(2);
    expect(records.some((r) => r.identity.contentHash === 'good-hash')).toBe(true);
  });
});
