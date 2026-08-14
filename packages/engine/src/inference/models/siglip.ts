/**
 * SigLIP vision encoder — image embeddings for "find similar assets"
 * search. The paired text encoder and tokenizer live in siglipText.ts and
 * emit vectors in the same embedding space for local text-to-image search.
 *
 * Model: google/siglip-base-patch16-224 (Apache-2.0). ONNX export:
 * Xenova/siglip-base-patch16-224 (Transformers.js-compatible rehost,
 * same license). The graph contract was re-verified 2026-08-13 against
 * the exact pinned artifact (sha256 9171eb00…c9a99):
 *   input: pixel_values [B,3,224,224] float32
 *   input: input_ids [B,T] int64 — REQUIRED by the graph even for
 *     image-only inference; the worker feeds a constant zero token.
 *   output: image_embeds [B,768] — the single embedding vector used
 *     for similarity comparison (the earlier `pooler_output` note was
 *     wrong; that tensor does not exist in this export).
 * SigLIP normalizes to [-1,1] (mean=0.5, std=0.5 per channel) — NOT
 * ImageNet mean/std, a common mixup with CLIP-family models that use
 * different normalization per variant.
 */
import type { TensorSpec } from '../imageTensor';

export const SIGLIP_IMAGE_SIZE = 224;

export const SIGLIP_IMAGE_TENSOR_SPEC: TensorSpec = {
  inputWidth: SIGLIP_IMAGE_SIZE,
  inputHeight: SIGLIP_IMAGE_SIZE,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  paddingRgb: [128, 128, 128],
};

/** Graph output carrying the normalized image embedding. */
export const SIGLIP_EMBEDDING_OUTPUT_NAME = 'image_embeds';

/** Output carrying the text-side embedding from the matching SigLIP graph. */
export const SIGLIP_TEXT_EMBEDDING_OUTPUT_NAME = 'pooler_output';

/** The tokenizer/model contract uses a fixed 64-token sequence. */
export const SIGLIP_TEXT_MAX_LENGTH = 64;

/** Model id for the separately downloadable text encoder graph. */
export const SIGLIP_TEXT_MODEL_ID = 'siglip-base-patch16-224-text';

/** Graph input name for the token sequence the worker feeds as zeros. */
export const SIGLIP_TEXT_INPUT_NAME = 'input_ids';

/** Dummy token-sequence feed the graph requires even for image-only runs. */
export function siglipConstantFeeds(): {
  input_ids: { dtype: 'int64'; data: BigInt64Array; dims: number[] };
} {
  return {
    input_ids: {
      dtype: 'int64',
      data: new BigInt64Array(1),
      dims: [1, 1],
    },
  };
}

/** L2-normalize an embedding vector so cosine similarity reduces to a dot product. */
export function normalizeEmbedding(data: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) sumSq += data[i]! * data[i]!;
  const norm = Math.sqrt(sumSq) || 1;
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) result[i] = data[i]! / norm;
  return result;
}

/** Cosine similarity between two embeddings of the same dimension. Callers
 * should pass already-normalized vectors (normalizeEmbedding) for this to
 * reduce to a cheap dot product; falls back to full cosine math otherwise. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export interface SimilarityMatch<T> {
  item: T;
  similarity: number;
}

/** Rank a set of candidate embeddings by similarity to a query embedding. */
export function rankBySimilarity<T>(
  query: Float32Array,
  candidates: Array<{ item: T; embedding: Float32Array }>,
  topK = 10,
): SimilarityMatch<T>[] {
  const scored = candidates.map(({ item, embedding }) => ({
    item,
    similarity: cosineSimilarity(query, embedding),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}
