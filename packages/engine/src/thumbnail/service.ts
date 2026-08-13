/**
 * Low-level thumbnail generation service.
 *
 * Accepts an array of engine `SceneNode`s (world transforms pre-computed)
 * and renders them to a PNG data URL using the full IR pipeline.
 *
 * The caller is responsible for source resolution (which nodes to render).
 * High-level source selection (page, frame, selection) lives in
 * `@varve/editor/src/thumbnail/`.
 */

import { createEngine } from '../engine';
import { type CachedImage, getImageCache } from '../imageCache';
import { resolveImageResourceHandle } from '../imageResourceRegistry';
import { createRasterSurface, encodeRasterSurface } from '../rasterSurface';
import type { ReplayTarget } from '../replay';
import { replayIr } from '../replay';
import type { Affine, RenderItem, SceneNode } from '../types';
import { hasAnyCanvas, hasImageEncoding } from './capabilities';
import {
  DEFAULT_THUMBNAIL_HEIGHT,
  DEFAULT_THUMBNAIL_OPTIONS,
  DEFAULT_THUMBNAIL_WIDTH,
  THUMBNAIL_RENDERER_VERSION,
  type ThumbnailBackground,
  type ThumbnailFit,
  type ThumbnailFormat,
  type ThumbnailMetadata,
  type ThumbnailOptions,
  type ThumbnailResult,
} from './types';

/**
 * Maximum thumbnail dimension per side. Output is clamped so that no render
 * surface can exceed the pixel budget below.
 */
const MAX_THUMBNAIL_DIMENSION = 2048;

/** Total pixel budget for one thumbnail surface (2048x2048). */
const MAX_THUMBNAIL_PIXELS = 2048 * 2048;

/**
 * Encoded byte cap for one thumbnail. Generation never fails on size — when
 * the first encode exceeds the cap, quality is reduced once; when it still
 * exceeds, the image is kept and a warning is recorded.
 */
const MAX_THUMBNAIL_BYTES = 768 * 1024;

/** Bound on how long we wait for raster sources to decode. */
const IMAGE_PRELOAD_TIMEOUT_MS = 1500;

function mimeTypeFor(format: ThumbnailFormat): string {
  return format === 'webp' ? 'image/webp' : 'image/png';
}

// ─── Bounds computation ───────────────────────────────────────────────

function nodeLocalBounds(node: SceneNode): { x: number; y: number; w: number; h: number } | null {
  const shape = node.shape;
  if (!shape) return null;

  switch (shape.kind) {
    case 'rect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'ellipse':
      return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
    case 'circle':
      return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
    case 'line': {
      const tolerance = shape.tolerance ?? 1;
      return {
        x: Math.min(shape.from[0], shape.to[0]) - tolerance,
        y: Math.min(shape.from[1], shape.to[1]) - tolerance,
        w: Math.abs(shape.to[0] - shape.from[0]) + tolerance * 2,
        h: Math.abs(shape.to[1] - shape.from[1]) + tolerance * 2,
      };
    }
    case 'polygon':
      return {
        x: shape.cx - shape.radius,
        y: shape.cy - shape.radius,
        w: shape.radius * 2,
        h: shape.radius * 2,
      };
    case 'star':
      return {
        x: shape.cx - shape.outerRadius,
        y: shape.cy - shape.outerRadius,
        w: shape.outerRadius * 2,
        h: shape.outerRadius * 2,
      };
    default:
      return null;
  }
}

function transformBounds(
  b: { x: number; y: number; w: number; h: number },
  t: Affine,
): { x: number; y: number; w: number; h: number } {
  const points = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ] as const;
  const xs = points.map(([x, y]) => t[0] * x + t[2] * y + t[4]);
  const ys = points.map(([x, y]) => t[1] * x + t[3] * y + t[5]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function computeNodesBounds(
  nodes: SceneNode[],
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const node of nodes) {
    const local = nodeLocalBounds(node);
    if (!local) continue;
    const t = node.transform ?? [1, 0, 0, 1, 0, 0];
    const tb = transformBounds(local, t);
    minX = Math.min(minX, tb.x);
    minY = Math.min(minY, tb.y);
    maxX = Math.max(maxX, tb.x + tb.w);
    maxY = Math.max(maxY, tb.y + tb.h);
    found = true;
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function computeScale(
  boundsW: number,
  boundsH: number,
  outW: number,
  outH: number,
  fit: ThumbnailFit,
): number {
  if (boundsW <= 0 || boundsH <= 0) return 1;
  const scaleX = outW / boundsW;
  const scaleY = outH / boundsH;
  switch (fit) {
    case 'fill':
      return 1;
    case 'cover':
      return Math.max(scaleX, scaleY);
    default:
      return Math.min(scaleX, scaleY, 1);
  }
}

function applyBackground(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  bg: ThumbnailBackground,
): void {
  switch (bg.type) {
    case 'transparent':
      break;
    case 'solid':
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, w, h);
      break;
    case 'checkerboard': {
      const size = 8;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#cccccc';
      for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) {
          if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
            ctx.fillRect(x, y, size, size);
          }
        }
      }
      break;
    }
    case 'match-theme':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      break;
  }
}

function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function computeCacheKey(nodes: SceneNode[], opts: ThumbnailOptions): string {
  const contentKey = nodes
    .map(
      (n) =>
        `${n.id}:${n.kind}:${JSON.stringify(n.shape)}:${JSON.stringify(n.fill)}:${JSON.stringify(n.fills)}`,
    )
    .join('|');
  const hash = simpleHash(contentKey);
  const optsKey = `${opts.maxWidth ?? DEFAULT_THUMBNAIL_WIDTH}x${opts.maxHeight ?? DEFAULT_THUMBNAIL_HEIGHT}-${opts.fit ?? 'contain'}`;
  return `thumb:${hash}:${optsKey}`;
}

// ─── Main entry point ──────────────────────────────────────────────────

/**
 * Collect image-fill sources used by the nodes so they can be decoded
 * before the single render pass. Missing/unloaded images render as
 * placeholders; generation never blocks forever.
 */
async function preloadImageFills(
  nodes: SceneNode[],
  maxDim: number,
  warnings: string[],
  signal?: AbortSignal,
): Promise<Map<string, CanvasImageSource>> {
  const sources = new Map<string, { width?: number; height?: number }>();
  for (const node of nodes) {
    for (const fill of node.fills ?? []) {
      if (fill.type === 'image' && fill.image?.src) {
        const src = resolveImageResourceHandle(fill.image.src);
        const prior = sources.get(src);
        sources.set(src, {
          width: Math.max(prior?.width ?? 0, fill.image.imageWidth ?? 0) || undefined,
          height: Math.max(prior?.height ?? 0, fill.image.imageHeight ?? 0) || undefined,
        });
      }
    }
  }
  if (sources.size === 0) return new Map();

  const resolved = new Map<string, CanvasImageSource>();
  const cache = getImageCache();
  const preload = Promise.allSettled(
    [...sources].map(async ([src, dimensions]) => {
      const source =
        dimensions.width && dimensions.height
          ? { width: dimensions.width, height: dimensions.height }
          : undefined;
      const image = await cache.loadAtSize(src, maxDim, source);
      resolved.set(src, image as CachedImage as CanvasImageSource);
    }),
  );
  await Promise.race([
    preload,
    new Promise<void>((resolve) => setTimeout(resolve, IMAGE_PRELOAD_TIMEOUT_MS)),
  ]);

  if (signal?.aborted) return resolved;
  for (const src of sources.keys()) {
    if (!resolved.has(src)) {
      warnings.push('image-not-ready');
    }
  }
  return resolved;
}

/**
 * Generate a thumbnail from a flat array of engine SceneNodes.
 *
 * Callers must pre-compute world transforms on each node and handle
 * source selection (which nodes to render). This function only
 * renders the given nodes and returns a PNG data URL.
 *
 * @param nodes - Engine SceneNodes with pre-computed world transforms
 * @param revisionId - Document revision for cache keying (e.g. content hash)
 * @param options - Output dimensions, fit, background, quality
 * @param signal - Optional AbortSignal for cancellation
 */
export async function generateThumbnail(
  nodes: SceneNode[],
  revisionId: string,
  options: Partial<ThumbnailOptions> = {},
  signal?: AbortSignal,
): Promise<ThumbnailResult | null> {
  const opts: ThumbnailOptions = { ...DEFAULT_THUMBNAIL_OPTIONS, ...options };
  const dpr = opts.devicePixelRatio ?? 1;
  const outW = Math.min(opts.maxWidth ?? DEFAULT_THUMBNAIL_WIDTH, MAX_THUMBNAIL_DIMENSION) * dpr;
  const outH = Math.min(opts.maxHeight ?? DEFAULT_THUMBNAIL_HEIGHT, MAX_THUMBNAIL_DIMENSION) * dpr;
  const format = opts.format ?? 'png';

  if (signal?.aborted) return null;
  if (nodes.length === 0) return null;

  // Early exit when no canvas rendering path is available — avoids
  // deployment-specific errors (e.g., OffscreenCanvas in older WebKit,
  // or jsdom test environments).
  if (!hasAnyCanvas() || !hasImageEncoding()) {
    const metadata: ThumbnailMetadata = {
      cacheKey: '',
      sourceBounds: null,
      scaleFactor: 1,
      outputWidth: 1,
      outputHeight: 1,
      mimeType: 'image/png',
      byteSize: 0,
      generatedAt: Date.now(),
      revisionId,
      rendererVersion: THUMBNAIL_RENDERER_VERSION,
      isPlaceholder: true,
      isProvisional: false,
      warnings: ['Canvas or image encoding not available in this environment'],
    };
    return { dataUrl: '', metadata };
  }

  const bounds = computeNodesBounds(nodes);
  const frame = opts.frame && opts.frame.w > 0 && opts.frame.h > 0 ? opts.frame : null;
  const renderBounds = frame ?? bounds;
  if (!renderBounds || renderBounds.w <= 0 || renderBounds.h <= 0) return null;

  if (signal?.aborted) return null;

  // Preload raster fills before the single render pass so images (not
  // placeholders) appear when they are ready in the shared image cache.
  const warnings: string[] = [];
  const imageMaxDim = Math.max(1, Math.ceil(Math.max(outW, outH)));
  const thumbnailImages = await preloadImageFills(nodes, imageMaxDim, warnings, signal);

  if (signal?.aborted) return null;

  const scale = computeScale(renderBounds.w, renderBounds.h, outW, outH, opts.fit ?? 'contain');
  let cw = Math.max(1, Math.round(renderBounds.w * scale));
  let ch = Math.max(1, Math.round(renderBounds.h * scale));

  // Clamp to the pixel budget after DPR scaling.
  if (cw * ch > MAX_THUMBNAIL_PIXELS) {
    const shrink = Math.sqrt(MAX_THUMBNAIL_PIXELS / (cw * ch));
    cw = Math.max(1, Math.round(cw * shrink));
    ch = Math.max(1, Math.round(ch * shrink));
    warnings.push('pixel-budget-clamped');
  }

  if (signal?.aborted) return null;

  const surface = createRasterSurface(cw, ch);
  const ctx = surface.context;

  applyBackground(ctx, cw, ch, opts.background ?? { type: 'transparent' });

  ctx.save();
  ctx.translate(-renderBounds.x * scale, -renderBounds.y * scale);
  ctx.scale(scale, scale);
  // Clip to the frame so content outside a page/region never bleeds in.
  ctx.beginPath();
  ctx.rect(renderBounds.x, renderBounds.y, renderBounds.w, renderBounds.h);
  ctx.clip();

  if (signal?.aborted) return null;

  const engine = await createEngine('stub');
  const ir: RenderItem[] = await engine.buildIr({ nodes });
  replayIr(ctx as unknown as ReplayTarget, ir, (src) => {
    const loadable = resolveImageResourceHandle(src);
    return thumbnailImages.get(loadable);
  });

  ctx.restore();

  if (signal?.aborted) return null;

  let blob = await encodeRasterSurface(surface, mimeTypeFor(format), opts.quality ?? 0.92);
  let mimeType = mimeTypeFor(format);
  // WebP may be unsupported by some encoders — fall back to PNG.
  if (format === 'webp' && blob.size === 0 && !blob.type.includes('webp')) {
    blob = await encodeRasterSurface(surface, 'image/png', opts.quality ?? 0.92);
    mimeType = 'image/png';
  }
  // Byte cap: reduce quality once, then keep the image with a warning.
  if (blob.size > MAX_THUMBNAIL_BYTES) {
    blob = await encodeRasterSurface(surface, mimeType, 0.6);
    if (blob.size > MAX_THUMBNAIL_BYTES) warnings.push('byte-cap-exceeded');
  }

  const dataUrl = await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(blob);
  });

  if (!dataUrl) return null;

  const metadata: ThumbnailMetadata = {
    cacheKey: computeCacheKey(nodes, opts),
    sourceLabel: opts.sourceLabel ?? 'Document',
    sourceBounds: renderBounds,
    scaleFactor: scale,
    outputWidth: cw,
    outputHeight: ch,
    mimeType,
    byteSize: blob.size,
    generatedAt: Date.now(),
    revisionId,
    rendererVersion: THUMBNAIL_RENDERER_VERSION,
    isPlaceholder: false,
    isProvisional: warnings.some((w) => w === 'image-not-ready'),
    warnings,
  };

  return { dataUrl, metadata };
}
