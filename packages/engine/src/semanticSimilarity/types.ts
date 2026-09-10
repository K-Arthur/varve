/**
 * Backend-neutral contracts for local visual similarity.
 *
 * The search layer deliberately knows nothing about SigLIP, DINO, ONNX, or
 * Candle. A model adapter produces an `EmbeddingVector`; the index only
 * accepts vectors whose space identity matches the query.
 */

export type SimilaritySearchMode = 'semantic' | 'near-duplicates';
export type EmbeddingDtype = 'fp32' | 'fp16' | 'int8';

export interface EmbeddingModelSpec {
  id: string;
  family: string;
  variant: string;
  revision: string;
  task: 'image-to-image';
  source: string;
  license: string;
  redistribution: 'allowed' | 'gated' | 'unknown';
  dimension: number;
  dtype: EmbeddingDtype;
  inputResolution: number;
  preprocessingVersion: string;
  embeddingSpaceVersion: string;
  pooling: 'pooler' | 'mean' | 'cls';
  normalized: boolean;
  runtime: 'onnx-worker' | 'candle' | 'unavailable';
  sizeBytes?: number;
  notes?: string;
}

export interface EmbeddingVector {
  modelId: string;
  modelRevision: string;
  embeddingSpaceVersion: string;
  preprocessingVersion: string;
  dimension: number;
  dtype: EmbeddingDtype;
  normalized: boolean;
  values: Float32Array;
}

export interface SemanticEmbeddingRecord extends EmbeddingVector {
  contentId: string;
  assetId?: string;
  sourceGeneration: string;
  createdAt: number;
}

export interface SimilarityCandidate {
  id: string;
  contentId: string;
  assetId?: string;
  name?: string;
  mediaType?: string;
  width?: number;
  height?: number;
  exactContentHash?: string;
  dHash?: string;
  pHash?: string;
  embedding?: EmbeddingVector;
}

export interface SimilaritySignals {
  semantic?: number;
  dHashDistance?: number;
  pHashDistance?: number;
  exactContent: boolean;
}

export interface SimilarityResult<T extends SimilarityCandidate = SimilarityCandidate> {
  candidate: T;
  score: number;
  signals: SimilaritySignals;
  lane: SimilaritySearchMode;
}

export function embeddingSpaceKey(
  vector: Pick<
    EmbeddingVector,
    'modelId' | 'modelRevision' | 'embeddingSpaceVersion' | 'preprocessingVersion' | 'dimension'
  >,
): string {
  return [
    vector.modelId,
    vector.modelRevision,
    vector.embeddingSpaceVersion,
    vector.preprocessingVersion,
    vector.dimension,
  ].join(':');
}

export function compatibleEmbeddingSpaces(
  a: Pick<
    EmbeddingVector,
    'modelId' | 'modelRevision' | 'embeddingSpaceVersion' | 'preprocessingVersion' | 'dimension'
  >,
  b: Pick<
    EmbeddingVector,
    'modelId' | 'modelRevision' | 'embeddingSpaceVersion' | 'preprocessingVersion' | 'dimension'
  >,
): boolean {
  return embeddingSpaceKey(a) === embeddingSpaceKey(b);
}
