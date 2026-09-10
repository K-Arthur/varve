export type ContentAwareFillQuality = 'fast' | 'ai';
export const QUALITY_LABELS: Record<ContentAwareFillQuality, string> = {
  fast: 'Fast (heuristic, no download)',
  ai: 'AI (LaMa, ~208 MB model)',
};
export const QUALITY_DESCRIPTIONS: Record<ContentAwareFillQuality, string> = {
  fast: 'PatchMatch heuristic — fast, works offline, best for small regions on textured/repeating backgrounds',
  ai: 'LaMa big-lama (Apache-2.0) — mask-guided inpainting, best overall quality, requires one-time model download',
};

export type ContentAwareFillOutputMode = 'new-layer' | 'replace-pixels' | 'update-mask';

export interface ContentAwareFillOptions {
  /** Source image data (full resolution, no transforms applied). */
  imageData: ImageData;
  /** Mask (0 = keep, 255 = fill this region). Same dimensions as imageData. */
  mask: Uint8Array;
  /** Mask width and height (may differ from imageData if region is bounded). */
  maskWidth: number;
  maskHeight: number;
  /** Offset of the mask region within the full image (for bounded extraction). */
  maskOffsetX: number;
  maskOffsetY: number;
  /** Quality / model mode. */
  quality: ContentAwareFillQuality;
  /** Output mode. */
  outputMode: ContentAwareFillOutputMode;
  /** Context padding in pixels around the mask bounding box. Default: auto. */
  contextPadding?: number;
  /** Random seed for reproducibility (PatchMatch). */
  seed?: number;
  /** Abort signal. */
  signal?: AbortSignal;
  /** Progress callback (0-1). */
  onProgress?: (progress: number) => void;
  /** Model path for LaMa (required for balanced/quality modes). */
  modelPath?: string;
  /** Model ID for session caching. */
  modelId?: string;
}

export interface ContentAwareFillResult {
  /** Filled image data at full source resolution. */
  imageData: ImageData;
  /** Width of the result. */
  width: number;
  /** Height of the result. */
  height: number;
  /** Bounding box of the filled region (may be smaller than full image). */
  filledBounds: { x: number; y: number; w: number; h: number };
  /** Quality mode used. */
  quality: ContentAwareFillQuality;
  /** Which execution provider ran the inference. */
  executionProvider?: string;
  /** Model ID that produced the result. */
  modelId?: string;
  /** Processing time in ms. */
  processingTimeMs: number;
  /** Warnings about the result quality. */
  warnings: string[];
}

export interface FillTransform {
  crop?: { x: number; y: number; w: number; h: number };
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  imageNaturalWidth: number;
  imageNaturalHeight: number;
}

export interface BoundedContext {
  /** The bounded image data (source region cropped to mask bounds + padding). */
  imageData: ImageData;
  /** The bounded mask (aligned with imageData). */
  mask: Uint8Array;
  /** X offset of this region within the full image. */
  offsetX: number;
  /** Y offset of this region within the full image. */
  offsetY: number;
  /** Width of the bounded region. */
  width: number;
  /** Height of the bounded region. */
  height: number;
}
