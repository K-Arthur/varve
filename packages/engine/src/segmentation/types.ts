/**
 * Model-independent contract for promptable image segmentation.
 *
 * Object Selection is a product capability, not a model name. Consumers of
 * this contract must not depend on ONNX, Candle, SAM, or a particular model
 * family. Backend adapters own tensor/runtime details and return normalized
 * source-image masks to the editor.
 */

export type SegmentationPointLabel = 'foreground' | 'background';

export interface SegmentationPoint {
  /** Source-image pixel coordinates, not screen or world coordinates. */
  x: number;
  y: number;
  label: SegmentationPointLabel;
}

export interface SegmentationBox {
  /** Source-image pixel coordinates. Bounds may be supplied in either order. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SegmentationMaskPrompt {
  /** Low-resolution logits or a normalized mask supplied by the backend. */
  data: Float32Array | Uint8Array;
  width: number;
  height: number;
}

export interface SegmentationPrompt {
  points?: SegmentationPoint[];
  box?: SegmentationBox;
  mask?: SegmentationMaskPrompt;
}

export interface SegmentationCapabilities {
  pointPrompts: boolean;
  boxPrompts: boolean;
  maskPrompts: boolean;
  multipleCandidates: boolean;
  automaticProposals: boolean;
  embeddingCache: boolean;
  videoPropagation: boolean;
  acceleration: 'cpu' | 'gpu' | 'cpu-and-gpu';
}

export interface SegmentationImage {
  /** Stable source identity used to prevent cross-document cache leakage. */
  sourceKey: string;
  pixels: ImageData;
}

export interface ImageEmbedding {
  sourceKey: string;
  modelId: string;
  preprocessingVersion: string;
  width: number;
  height: number;
  /** Backend-owned data. The editor never interprets these tensors. */
  value: unknown;
}

export interface SegmentationCandidate {
  mask: Uint8Array;
  width: number;
  height: number;
  confidence: number;
  stability?: number;
  /** Optional score explaining how well prompts are contained by the mask. */
  promptContainment?: number;
}

export interface SegmentationPrediction {
  candidates: SegmentationCandidate[];
  selectedIndex: number;
  processingTimeMs: number;
  executionProvider: string;
}

export interface SegmentationBackend {
  readonly id: string;
  capabilities(): SegmentationCapabilities;
  loadModel(signal?: AbortSignal): Promise<void>;
  prepareImage(image: SegmentationImage, signal?: AbortSignal): Promise<ImageEmbedding>;
  predict(
    embedding: ImageEmbedding,
    prompt: SegmentationPrompt,
    signal?: AbortSignal,
  ): Promise<SegmentationPrediction>;
  unload(): Promise<void>;
}

export interface SegmentationCacheKey {
  sourceKey: string;
  sourceRevision: number;
  modelId: string;
  modelVersion: string;
  preprocessingVersion: string;
  cropKey?: string;
}

export function serializeSegmentationCacheKey(key: SegmentationCacheKey): string {
  return [
    key.sourceKey,
    key.sourceRevision,
    key.modelId,
    key.modelVersion,
    key.preprocessingVersion,
    key.cropKey ?? '',
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('|');
}

export function isUsableSegmentationPrompt(prompt: SegmentationPrompt): boolean {
  return Boolean(
    (prompt.points && prompt.points.length > 0) ||
      prompt.box ||
      (prompt.mask && prompt.mask.width > 0 && prompt.mask.height > 0),
  );
}
