import type { EmbeddingModelSpec } from './types';
import { DINOV2_PREPROCESSING_VERSION } from './preprocess';

export const SEMANTIC_PREPROCESSING_VERSION = 'semantic-rgb-letterbox-neutral-v1';

/** SigLIP image encoder: the text lane's image side (same embedding space). */
export const SIGLIP_IMAGE_MODEL: EmbeddingModelSpec = {
  id: 'siglip-base-patch16-224',
  family: 'SigLIP',
  variant: 'base-patch16-224',
  revision: 'xenova-onnx-2026-07-21',
  task: 'image-to-image',
  source: 'https://huggingface.co/Xenova/siglip-base-patch16-224',
  license: 'Apache-2.0',
  redistribution: 'allowed',
  dimension: 768,
  dtype: 'int8',
  inputResolution: 224,
  preprocessingVersion: SEMANTIC_PREPROCESSING_VERSION,
  embeddingSpaceVersion: 'siglip-image-pooler-v1',
  pooling: 'pooler',
  normalized: true,
  runtime: 'onnx-worker',
  sizeBytes: 210_977_441,
  notes:
    'Image-side encoder for the paired local text/image lane. The matching text graph and tokenizer are separate explicit downloads.',
};

/**
 * DINOv2-small, the evidence-backed image-to-image lane default. Selected
 * from the 2026-08-13 Varve corpus evaluation: statistically equivalent
 * retrieval to SigLIP (mAP 69.1 vs 68.7), ~1.8x faster CPU inference,
 * 2.4x smaller download (88 MB vs 211 MB), half the vector dimension
 * (384 vs 768), and a higher UI-domain score. Preprocessing is the
 * canonical shortest-side-256 + center-crop-224 pipeline; reference-vector
 * parity is verified against the independent onnxruntime-python build.
 */
export const DINOV2_SMALL_IMAGE_MODEL: EmbeddingModelSpec = {
  id: 'dinov2-small',
  family: 'DINOv2',
  variant: 'small',
  revision: 'xenova-onnx-2026-08-13',
  task: 'image-to-image',
  source: 'https://huggingface.co/Xenova/dinov2-small',
  license: 'Apache-2.0',
  redistribution: 'allowed',
  dimension: 384,
  dtype: 'fp32',
  inputResolution: 224,
  preprocessingVersion: DINOV2_PREPROCESSING_VERSION,
  embeddingSpaceVersion: 'dinov2-small-cls-v1',
  pooling: 'cls',
  normalized: true,
  runtime: 'onnx-worker',
  sizeBytes: 88_459_888,
  notes:
    'CLS-token embedding of the 224x224 center crop. fp32 Xenova ONNX export of facebook/dinov2-small (Apache-2.0), SHA-256 pinned.',
};

/**
 * Evaluation-only candidates. They are intentionally not download entries:
 * no checkpoint is shipped or fetched until a Varve corpus benchmark proves
 * a product-level win and the complete redistribution path is approved.
 */
export const EMBEDDING_EVALUATION_CANDIDATES: readonly EmbeddingModelSpec[] = [
  {
    id: 'dinov2-base-eval',
    family: 'DINOv2',
    variant: 'base',
    revision: 'facebookresearch-dinov2',
    task: 'image-to-image',
    source: 'https://huggingface.co/facebook/dinov2-base',
    license: 'Apache-2.0',
    redistribution: 'allowed',
    dimension: 768,
    dtype: 'fp32',
    inputResolution: 224,
    preprocessingVersion: 'dinov2-rgb-imagenet-v1',
    embeddingSpaceVersion: 'dinov2-base-reg-v1',
    pooling: 'cls',
    normalized: true,
    runtime: 'unavailable',
    notes: 'Quality baseline candidate; not selected without Varve-corpus evidence.',
  },
  {
    id: 'dinov3-small-eval',
    family: 'DINOv3',
    variant: 'small',
    revision: 'meta-dinov3-2025',
    task: 'image-to-image',
    source: 'https://ai.meta.com/resources/models-and-libraries/dinov3-downloads/',
    license: 'DINOv3 License',
    redistribution: 'gated',
    dimension: 384,
    dtype: 'fp32',
    inputResolution: 224,
    preprocessingVersion: 'dinov3-rgb-v1',
    embeddingSpaceVersion: 'dinov3-small-reg-v1',
    pooling: 'cls',
    normalized: true,
    runtime: 'unavailable',
    notes:
      'Access requires accepting Meta terms; do not build an automatic download flow around it.',
  },
];
