/**
 * Versioned, binary embedding records for local asset search.
 *
 * This module has no database dependency. Web uses the returned ArrayBuffer in
 * IndexedDB and native adapters can store the same bytes as a SQLite BLOB.
 * The identity includes content, model, preprocessing, and schema versions so
 * a rename can reuse work while an edit or model change cannot silently reuse
 * stale vectors.
 */

export type AssetEmbeddingDtype = 'float32';

export interface AssetEmbeddingIdentity {
  contentHash: string;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  embeddingSchemaVersion: string;
}

export interface AssetEmbeddingRecord {
  key: string;
  contentId: string;
  assetId?: string;
  identity: AssetEmbeddingIdentity;
  dtype: AssetEmbeddingDtype;
  dimension: number;
  bytes: ArrayBuffer;
  sourceGeneration: string;
  createdAt: number;
}

export function assetEmbeddingKey(identity: AssetEmbeddingIdentity): string {
  return [
    identity.contentHash,
    identity.modelId,
    identity.modelVersion,
    identity.preprocessingVersion,
    identity.embeddingSchemaVersion,
  ].join(':');
}

export function encodeFloat32Embedding(values: Float32Array): ArrayBuffer {
  return values.slice().buffer;
}

export function decodeFloat32Embedding(bytes: ArrayBuffer, dimension: number): Float32Array {
  if (!Number.isInteger(dimension) || dimension < 1) throw new Error('Invalid embedding dimension');
  if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('Embedding byte length does not match its dimension');
  }
  return new Float32Array(bytes.slice(0));
}

export function makeAssetEmbeddingRecord(
  identity: AssetEmbeddingIdentity,
  values: Float32Array,
  input: Omit<AssetEmbeddingRecord, 'key' | 'identity' | 'dtype' | 'dimension' | 'bytes'>,
): AssetEmbeddingRecord {
  return {
    ...input,
    key: assetEmbeddingKey(identity),
    identity,
    dtype: 'float32',
    dimension: values.length,
    bytes: encodeFloat32Embedding(values),
  };
}
