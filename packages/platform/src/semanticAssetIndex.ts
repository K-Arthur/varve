/**
 * Reconstructible local semantic index primitives.
 *
 * The index intentionally has no IndexedDB, SQLite, or engine dependency. A
 * web adapter can persist the snapshot in IndexedDB and a native adapter can
 * persist the same records as SQLite BLOBs. The source document remains the
 * authority; this is derived data that can always be rebuilt.
 */
import {
  type AssetEmbeddingIdentity,
  type AssetEmbeddingRecord,
  assetEmbeddingKey,
  decodeFloat32Embedding,
} from './assetEmbeddingIndex';

export const SEMANTIC_INDEX_SCHEMA_VERSION = 1;

export interface SemanticIndexSnapshot {
  schemaVersion: typeof SEMANTIC_INDEX_SCHEMA_VERSION;
  records: AssetEmbeddingRecord[];
}

export interface SemanticIndexHit {
  record: AssetEmbeddingRecord;
  score: number;
}

function embeddingSpaceKey(identity: AssetEmbeddingIdentity): string {
  return [
    identity.modelId,
    identity.modelVersion,
    identity.preprocessingVersion,
    identity.embeddingSchemaVersion,
  ].join(':');
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return Number.NaN;
  return dot / Math.sqrt(normA * normB);
}

function validateRecord(record: AssetEmbeddingRecord): void {
  if (!record || typeof record !== 'object') throw new Error('Invalid semantic index record');
  if (!record.key || record.key !== assetEmbeddingKey(record.identity)) {
    throw new Error('Semantic index record key does not match its identity');
  }
  if (!record.contentId || !record.sourceGeneration) {
    throw new Error('Semantic index record is missing content identity');
  }
  const values = decodeFloat32Embedding(record.bytes, record.dimension);
  for (const value of values) {
    if (!Number.isFinite(value))
      throw new Error('Semantic index contains a non-finite vector value');
  }
}

/** A deterministic exact-search index for small and medium local libraries. */
export class SemanticAssetIndex {
  private readonly records = new Map<string, AssetEmbeddingRecord>();

  constructor(snapshot?: SemanticIndexSnapshot) {
    if (snapshot) this.restore(snapshot);
  }

  get size(): number {
    return this.records.size;
  }

  upsert(record: AssetEmbeddingRecord): void {
    validateRecord(record);
    this.records.set(record.key, { ...record, bytes: record.bytes.slice(0) });
  }

  remove(identity: AssetEmbeddingIdentity): boolean {
    return this.records.delete(assetEmbeddingKey(identity));
  }

  removeContent(contentHash: string): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (record.identity.contentHash !== contentHash) continue;
      this.records.delete(key);
      removed += 1;
    }
    return removed;
  }

  list(): AssetEmbeddingRecord[] {
    return [...this.records.values()].map((record) => ({
      ...record,
      bytes: record.bytes.slice(0),
    }));
  }

  search(query: AssetEmbeddingRecord, topK = 10): SemanticIndexHit[] {
    validateRecord(query);
    const queryValues = decodeFloat32Embedding(query.bytes, query.dimension);
    return this.list()
      .filter((record) => record.key !== query.key)
      .filter((record) => embeddingSpaceKey(record.identity) === embeddingSpaceKey(query.identity))
      .map((record) => ({
        record,
        score: cosine(queryValues, decodeFloat32Embedding(record.bytes, record.dimension)),
      }))
      .filter((hit) => Number.isFinite(hit.score))
      .sort((a, b) => b.score - a.score || a.record.contentId.localeCompare(b.record.contentId))
      .slice(0, Math.max(0, topK));
  }

  snapshot(): SemanticIndexSnapshot {
    return {
      schemaVersion: SEMANTIC_INDEX_SCHEMA_VERSION,
      records: this.list(),
    };
  }

  restore(snapshot: SemanticIndexSnapshot): void {
    if (snapshot?.schemaVersion !== SEMANTIC_INDEX_SCHEMA_VERSION) {
      throw new Error('Unsupported semantic index schema version');
    }
    if (!Array.isArray(snapshot.records))
      throw new Error('Semantic index records must be an array');
    const next = new Map<string, AssetEmbeddingRecord>();
    for (const record of snapshot.records) {
      validateRecord(record);
      next.set(record.key, { ...record, bytes: record.bytes.slice(0) });
    }
    this.records.clear();
    for (const [key, record] of next) this.records.set(key, record);
  }
}
