/**
 * Reusable embedding entry points for semantic asset search.
 *
 * Both the Similar panel and the asset library indexer must produce
 * vectors through these functions so every embedding shares the exact
 * parity-verified pipeline (preprocess.ts + the inference worker):
 *
 *   image: decode (neutral matte, bounded) → preprocessSemanticInput
 *          → worker (siglip-image) → L2 normalize
 *   text:  SiglipTokenizer (reference-parity) → worker (siglip-text)
 *          → L2 normalize
 *
 * The worker only ever receives precomputed tensors here, never raw
 * image data — the worker's canvas letterbox path is deliberately NOT
 * used for embeddings because it diverges from the canonical pipeline
 * (no alpha matting, browser-dependent resampling).
 */
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import {
  normalizeEmbedding,
  SIGLIP_IMAGE_SIZE,
  SIGLIP_TEXT_MAX_LENGTH,
  SIGLIP_TEXT_MODEL_ID,
} from '../inference/models/siglip';
import { loadSiglipTokenizer } from '../inference/models/siglipText';
import { SIGLIP_IMAGE_MODEL } from './models';
import { preprocessSemanticInput, SIGLIP_PREPROCESS_SPEC } from './preprocess';
import type { EmbeddingVector } from './types';

/** Longest source edge fed to the embedding pipeline (bounded decode). */
export const SEMANTIC_SOURCE_MAX_DIMENSION = 2048;

export interface SemanticRgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Decode image bytes on the main thread into a bounded RGBA buffer with a
 * deterministic neutral matte (transparent pixels composite onto 128,128,128
 * instead of browser-dependent transparent black).
 */
export async function decodeSemanticImageBytes(
  bytes: Uint8Array,
  mimeType: string,
): Promise<SemanticRgbaImage> {
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to decode image'));
      image.src = url;
    });
    const scale = Math.min(
      1,
      SEMANTIC_SOURCE_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.fillStyle = 'rgb(128 128 128)';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const data = ctx.getImageData(0, 0, width, height).data;
    return { width, height, data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Embed an image through the canonical pipeline. */
export async function embedImageForSearch(
  image: SemanticRgbaImage,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  const { tensor } = preprocessSemanticInput(
    { width: image.width, height: image.height, data: image.data },
    SIGLIP_PREPROCESS_SPEC,
  );
  if (signal?.aborted) throw new Error('cancelled');
  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: 'siglip-image',
      modelPath,
      modelId: SIGLIP_IMAGE_MODEL.id,
      tensors: {
        pixel_values: {
          data: tensor,
          dims: [1, 3, SIGLIP_IMAGE_SIZE, SIGLIP_IMAGE_SIZE],
          dtype: 'float32',
        },
      },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );
  if (signal?.aborted) throw new Error('cancelled');
  const outputs = result.outputs as {
    image_embeds?: { data: Float32Array; dims: number[] };
  };
  const raw = outputs.image_embeds;
  if (!raw) throw new Error('Embedding did not produce an image_embeds tensor');
  return {
    modelId: SIGLIP_IMAGE_MODEL.id,
    modelRevision: SIGLIP_IMAGE_MODEL.revision,
    embeddingSpaceVersion: SIGLIP_IMAGE_MODEL.embeddingSpaceVersion,
    preprocessingVersion: SIGLIP_IMAGE_MODEL.preprocessingVersion,
    dimension: raw.data.length,
    dtype: 'fp32',
    normalized: true,
    values: normalizeEmbedding(raw.data),
  };
}

/** Embed a natural-language query through the reference-parity text tower. */
export async function embedTextForSearch(
  query: string,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  const tokenizer = await loadSiglipTokenizer(signal);
  const encoded = tokenizer.encode(query, SIGLIP_TEXT_MAX_LENGTH);
  if (signal?.aborted) throw new Error('cancelled');
  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: 'siglip-text',
      modelPath,
      modelId: SIGLIP_TEXT_MODEL_ID,
      tensors: {
        input_ids: {
          data: encoded.inputIds,
          dims: [1, SIGLIP_TEXT_MAX_LENGTH],
          dtype: 'int64',
        },
      },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );
  if (signal?.aborted) throw new Error('cancelled');
  const outputs = result.outputs as {
    pooler_output?: { data: Float32Array; dims: number[] };
  };
  const raw = outputs.pooler_output;
  if (!raw) throw new Error('Text embedding did not produce an output tensor');
  return {
    modelId: SIGLIP_IMAGE_MODEL.id,
    modelRevision: SIGLIP_IMAGE_MODEL.revision,
    embeddingSpaceVersion: SIGLIP_IMAGE_MODEL.embeddingSpaceVersion,
    preprocessingVersion: SIGLIP_IMAGE_MODEL.preprocessingVersion,
    dimension: raw.data.length,
    dtype: 'fp32',
    normalized: true,
    values: normalizeEmbedding(raw.data),
  };
}
