/**
 * Reusable embedding entry points for semantic asset search.
 *
 * Every embedding path shares one canonical pipeline (preprocess.ts + the
 * inference worker) so vectors are comparable across callers. Model choice
 * is data, not code: a caller selects an `ImageEmbeddingRuntimeSpec` /
 * `TextEmbeddingRuntimeSpec` (model metadata + preprocessing + worker
 * contract); the generic cores below never hardcode a model.
 *
 *   image: decode (neutral matte, bounded) → preprocessSemanticInput
 *          (spec.preprocess) → worker (spec.workerModelType) → spec.extract
 *          → L2 normalize
 *   text:  spec.encode (tokenizer adapter) → worker (spec.workerModelType)
 *          → L2 normalize
 *
 * The worker only ever receives precomputed tensors here, never raw
 * image data — the worker's canvas letterbox path is deliberately NOT
 * used for embeddings because it diverges from the canonical pipeline
 * (no alpha matting, browser-dependent resampling).
 */

import type { WorkerModelType } from '../inference/inferenceWorker';
import { getInferenceWorkerHost } from '../inference/inferenceWorkerHost';
import {
  normalizeEmbedding,
  SIGLIP_TEXT_MAX_LENGTH,
  SIGLIP_TEXT_MODEL_ID,
} from '../inference/models/siglip';
import { loadSiglipTokenizer } from '../inference/models/siglipText';
import { DINOV2_SMALL_IMAGE_MODEL, SIGLIP_IMAGE_MODEL } from './models';
import type { SemanticResizeSpec } from './preprocess';
import {
  DINOV2_PREPROCESS_SPEC,
  preprocessSemanticInput,
  SIGLIP_PREPROCESS_SPEC,
} from './preprocess';
import type { EmbeddingModelSpec, EmbeddingVector } from './types';

/** Longest source edge fed to the embedding pipeline (bounded decode). */
export const SEMANTIC_SOURCE_MAX_DIMENSION = 2048;

export interface SemanticRgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Model + runtime wiring for one image embedding lane. */
export interface ImageEmbeddingRuntimeSpec {
  model: EmbeddingModelSpec;
  preprocess: SemanticResizeSpec;
  workerModelType: WorkerModelType;
  outputName: string;
  extract: (raw: { data: Float32Array; dims: number[] }) => Float32Array;
}

/** Model + runtime wiring for one text embedding lane. */
export interface TextEmbeddingRuntimeSpec {
  /** Space identity the vectors are stored under (must match the image lane
   * for cross-modal comparison — see embeddingSpaceKey). */
  model: EmbeddingModelSpec;
  workerModelType: WorkerModelType;
  outputName: string;
  maxLength: number;
  encode: (text: string, signal?: AbortSignal) => Promise<{ inputIds: BigInt64Array }>;
}

export const SIGLIP_IMAGE_EMBEDDING_SPEC: ImageEmbeddingRuntimeSpec = {
  model: SIGLIP_IMAGE_MODEL,
  preprocess: SIGLIP_PREPROCESS_SPEC,
  workerModelType: 'siglip-image',
  outputName: 'image_embeds',
  extract: (raw) => raw.data,
};

export const DINOV2_IMAGE_EMBEDDING_SPEC: ImageEmbeddingRuntimeSpec = {
  model: DINOV2_SMALL_IMAGE_MODEL,
  preprocess: DINOV2_PREPROCESS_SPEC,
  workerModelType: 'dinov2-image',
  outputName: 'last_hidden_state',
  extract: (raw) => raw.data.subarray(0, DINOV2_SMALL_IMAGE_MODEL.dimension),
};

export const SIGLIP_TEXT_EMBEDDING_SPEC: TextEmbeddingRuntimeSpec = {
  model: SIGLIP_IMAGE_MODEL,
  workerModelType: 'siglip-text',
  outputName: 'pooler_output',
  maxLength: SIGLIP_TEXT_MAX_LENGTH,
  encode: async (text, signal) => {
    const tokenizer = await loadSiglipTokenizer(signal);
    return tokenizer.encode(text, SIGLIP_TEXT_MAX_LENGTH);
  },
};

/** Registered image embedding lanes, keyed by model id. */
export const IMAGE_EMBEDDING_SPECS: Record<string, ImageEmbeddingRuntimeSpec> = {
  [SIGLIP_IMAGE_MODEL.id]: SIGLIP_IMAGE_EMBEDDING_SPEC,
  [DINOV2_SMALL_IMAGE_MODEL.id]: DINOV2_IMAGE_EMBEDDING_SPEC,
};

export function imageEmbeddingSpecFor(modelId: string): ImageEmbeddingRuntimeSpec | undefined {
  return IMAGE_EMBEDDING_SPECS[modelId];
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

/** Embed an image through any registered lane (canonical pipeline). */
export async function embedImageForSearchWith(
  image: SemanticRgbaImage,
  spec: ImageEmbeddingRuntimeSpec,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  const { tensor } = preprocessSemanticInput(
    { width: image.width, height: image.height, data: image.data },
    spec.preprocess,
  );
  if (signal?.aborted) throw new Error('cancelled');
  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: spec.workerModelType,
      modelPath,
      modelId: spec.model.id,
      tensors: {
        pixel_values: {
          data: tensor,
          dims: [1, 3, spec.model.inputResolution, spec.model.inputResolution],
          dtype: 'float32',
        },
      },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );
  if (signal?.aborted) throw new Error('cancelled');
  const outputs = result.outputs as Record<string, { data: Float32Array; dims: number[] }>;
  const raw = outputs[spec.outputName];
  if (!raw) throw new Error(`Embedding did not produce a '${spec.outputName}' tensor`);
  return {
    modelId: spec.model.id,
    modelRevision: spec.model.revision,
    embeddingSpaceVersion: spec.model.embeddingSpaceVersion,
    preprocessingVersion: spec.model.preprocessingVersion,
    dimension: spec.model.dimension,
    dtype: 'fp32',
    normalized: true,
    values: normalizeEmbedding(spec.extract(raw)),
  };
}

/** Embed an image through the SigLIP lane (default). */
export async function embedImageForSearch(
  image: SemanticRgbaImage,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  return embedImageForSearchWith(image, SIGLIP_IMAGE_EMBEDDING_SPEC, modelPath, signal);
}

/** Embed a natural-language query through any registered text lane. */
export async function embedTextForSearchWith(
  query: string,
  spec: TextEmbeddingRuntimeSpec,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  const encoded = await spec.encode(query, signal);
  if (signal?.aborted) throw new Error('cancelled');
  const host = getInferenceWorkerHost();
  const result = await host.infer(
    {
      type: 'infer',
      modelType: spec.workerModelType,
      modelPath,
      modelId: SIGLIP_TEXT_MODEL_ID,
      tensors: {
        input_ids: {
          data: encoded.inputIds,
          dims: [1, spec.maxLength],
          dtype: 'int64',
        },
      },
      reuseSession: true,
    },
    { signal, timeoutMs: 60_000 },
  );
  if (signal?.aborted) throw new Error('cancelled');
  const outputs = result.outputs as Record<string, { data: Float32Array; dims: number[] }>;
  const raw = outputs[spec.outputName];
  if (!raw) throw new Error(`Text embedding did not produce a '${spec.outputName}' tensor`);
  return {
    modelId: spec.model.id,
    modelRevision: spec.model.revision,
    embeddingSpaceVersion: spec.model.embeddingSpaceVersion,
    preprocessingVersion: spec.model.preprocessingVersion,
    dimension: spec.model.dimension,
    dtype: 'fp32',
    normalized: true,
    values: normalizeEmbedding(raw.data),
  };
}

/** Embed a natural-language query through the SigLIP text tower (default). */
export async function embedTextForSearch(
  query: string,
  modelPath: string,
  signal?: AbortSignal,
): Promise<EmbeddingVector> {
  return embedTextForSearchWith(query, SIGLIP_TEXT_EMBEDDING_SPEC, modelPath, signal);
}
