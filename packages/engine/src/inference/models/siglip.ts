/**
 * SigLIP vision encoder — image embeddings for "find similar assets"
 * search. Scoped to image-to-image similarity only for this pass: the
 * text encoder needs a SentencePiece tokenizer (vocab + merges assets)
 * that isn't wired up yet, so text-to-image search ("find photos of a
 * dog") is a documented follow-up, not implemented here.
 *
 * Model: google/siglip-base-patch16-224 (Apache-2.0). ONNX export:
 * Xenova/siglip-base-patch16-224 (Transformers.js-compatible rehost,
 * same license). Verified 2026-07-21 by downloading the real graph:
 *   input: pixel_values [B,3,H,W] float32
 *   outputs: last_hidden_state [B,196,768] (per-patch features, unused
 *     here), pooler_output [B,768] (the single embedding vector used
 *     for similarity comparison)
 * Opset 13, no custom ops. SigLIP normalizes to [-1,1] (mean=0.5,
 * std=0.5 per channel) — NOT ImageNet mean/std, a common mixup with
 * CLIP-family models that use different normalization per variant.
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
