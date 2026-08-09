/**
 * Unified thumbnail types for the Strata renderer.
 *
 * Supports multiple thumbnail sources: whole document, page, frame,
 * selection, or viewport. Every thumbnail result carries enough
 * metadata for cache keying, crop/fit, and source identification.
 */

/** Which content should the thumbnail show. */
export type ThumbnailSource =
  | { type: 'document' }
  | { type: 'page'; pageId: string }
  | { type: 'frame'; nodeId: string }
  | { type: 'selection'; nodeIds: string[] };

/** Fit mode – how the source content fills the output dimensions. */
export type ThumbnailFit = 'contain' | 'cover' | 'fill';

/** Background treatment for transparent areas. */
export type ThumbnailBackground =
  | { type: 'transparent' }
  | { type: 'solid'; color: string }
  | { type: 'checkerboard' }
  | { type: 'match-theme' };

/** Encoded output format. WebP is preferred when supported. */
export type ThumbnailFormat = 'png' | 'webp';

export interface ThumbnailOptions {
  /** Target output width in px (default 256). */
  maxWidth?: number;
  /** Target output height in px (default 192). */
  maxHeight?: number;
  /** How to fit source into output bounds (default 'contain'). */
  fit?: ThumbnailFit;
  /** Background for transparent areas (default 'transparent'). */
  background?: ThumbnailBackground;
  /** PNG quality 0-1 (default 0.92). */
  quality?: number;
  /**
   * Device-pixel ratio for HiDPI thumbnails (default 1). Renders at
   * maxWidth*dpr and reports the physical size in metadata; display code
   * downscales. Total pixels are hard-capped.
   */
  devicePixelRatio?: number;
  /** Encoded format (default 'png'; falls back to png when unsupported). */
  format?: ThumbnailFormat;
  /** Information about the thumbnail source, used for metadata. */
  sourceLabel?: string;
}

export interface ThumbnailMetadata {
  /** Canonical cache key: stable across runs for same content + settings. */
  cacheKey: string;
  /** Source label describing what was rendered (e.g., 'Document overview', 'Current page'). */
  sourceLabel?: string;
  /** Bounding box of source content in document coordinates. */
  sourceBounds: { x: number; y: number; w: number; h: number } | null;
  /** The scale factor applied to fit source into output size. */
  scaleFactor: number;
  /** Output dimensions after fitting. */
  outputWidth: number;
  /** Output height after fitting. */
  outputHeight: number;
  /** MIME type of the encoded output. */
  mimeType: string;
  /** Encoded byte size of the output (before base64). */
  byteSize: number;
  /** Epoch ms when the thumbnail was generated. */
  generatedAt: number;
  /** Document revision (contentHash) at generation time. */
  revisionId: string;
  /** Renderer version; participates in cache identity. */
  rendererVersion: string;
  /** True if the result is a fallback placeholder (e.g., empty doc). */
  isPlaceholder: boolean;
  /** True when raster sources were not ready at render time. */
  isProvisional: boolean;
  /** Warnings produced during generation. */
  warnings: string[];
}

export interface ThumbnailResult {
  /** Base-64 encoded PNG data URL. */
  dataUrl: string;
  /** Metadata for cache keying and display. */
  metadata: ThumbnailMetadata;
}

/** Default output dimensions. */
export const DEFAULT_THUMBNAIL_WIDTH = 256;
export const DEFAULT_THUMBNAIL_HEIGHT = 192;

/**
 * Renderer version — part of the canonical cache identity. Bump when the
 * thumbnail rendering pipeline changes semantics (new node kinds, changed
 * compositing), so stale images are naturally invalidated by the identity
 * rather than by migration.
 */
export const THUMBNAIL_RENDERER_VERSION = '1';

/** Default options used when no overrides supplied. */
export const DEFAULT_THUMBNAIL_OPTIONS: ThumbnailOptions = {
  maxWidth: DEFAULT_THUMBNAIL_WIDTH,
  maxHeight: DEFAULT_THUMBNAIL_HEIGHT,
  fit: 'contain',
  background: { type: 'transparent' },
  quality: 0.92,
  devicePixelRatio: 1,
  format: 'png',
};

export function thumbnailSourceLabel(source: ThumbnailSource): string {
  switch (source.type) {
    case 'document':
      return 'Document overview';
    case 'page':
      return 'Current page';
    case 'frame':
      return 'Selected frame';
    case 'selection':
      return 'Selection';
  }
}
