/**
 * Perspective image decoration — non-destructive four-corner (projective)
 * transform for ordinary image nodes.
 *
 * An image fill carrying `perspective` is rendered through the engine's
 * canonical `warpedImage` primitive. The source pixels and crop are never
 * baked away: the *framed content* (crop + fit + rotation + flip, exactly as
 * `computeImagePlacement` positions it within the node box) is baked once
 * into a node-box-sized surface, cached by source revision, and mapped onto
 * the perspective quad. Dragging a corner only changes the quad, so the
 * expensive source raster is reused, not re-decoded.
 *
 * This deliberately reuses the mockup `warpedImage` primitive and the shared
 * homography solver rather than introducing a second projective rasterizer.
 */

import {
  computeImagePlacement,
  getImageCache,
  type ImagePlacement,
  type RenderItem,
} from '@varve/engine';
import {
  type Document,
  defaultPerspectiveQuad,
  type ImageFillData,
  type ImageFillPerspective,
  isPerspectiveQuadValid,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { MockupSurfaceCache } from './mockup/mockupIr';

const MAX_SURFACE_PX = 4096;

/** Byte-bounded LRU of baked perspective surfaces (one per node+revision). */
export const perspectiveSurfaceCache = new MockupSurfaceCache(32 * 1024 * 1024);

export function clearPerspectiveSurfaceCache(): void {
  perspectiveSurfaceCache.clear();
}

interface PerspectiveDecorateInput {
  doc: Document;
  nodeIds: readonly NodeId[];
  items: RenderItem[];
  /** Surface resolution scale (preview ~1, export higher). */
  qualityScale: number;
  /** True when baking for export/thumbnail (full resolution, no proxy). */
  forExport?: boolean;
}

function imageFillOf(node: SceneNode): ImageFillData | null {
  if (node.kind !== 'shape') return null;
  const inline = node.fills?.find((f) => f.type === 'image')?.image;
  // Paint-refs resolution happens before this step; check inline fills only.
  return inline ?? null;
}

function sourceDataUrl(doc: Document, fill: ImageFillData): string | null {
  if (fill.assetId) {
    const asset = doc.assets?.[fill.assetId];
    if (asset?.dataUrl) return asset.dataUrl;
  }
  return fill.src ?? null;
}

/** Bake the framed content (crop/fit/rotation/flip) into a node-box surface. */
function bakePerspectiveSurface(
  doc: Document,
  node: SceneNode,
  fill: ImageFillData,
  w: number,
  h: number,
  qualityScale: number,
): string | null {
  // The worker replay path cannot allocate DOM canvases. The caller disables
  // worker rendering for perspective scenes, but keep this helper safe when
  // it is used by a non-DOM render target or a test harness.
  if (typeof document === 'undefined') return null;
  const src = sourceDataUrl(doc, fill);
  if (!src) return null;

  const outW = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(w * qualityScale)));
  const outH = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(h * qualityScale)));
  const bucket = qualityScale !== 1 ? qualityScale.toFixed(3) : '1';

  const crop = fill.crop;
  const cropKey = crop ? `${crop.x},${crop.y},${crop.w},${crop.h}` : 'none';
  const sourceRevision = fill.assetId ?? `${src.length}:${src.slice(-64)}`;
  const cacheKey = `${node.id}|${sourceRevision}|${cropKey}|${fill.fit}|${fill.rotation ?? 0}|${fill.flipH ? 1 : 0}|${fill.flipV ? 1 : 0}|${fill.scale}|${fill.x},${fill.y}|${fill.imageWidth}x${fill.imageHeight}|${outW}x${outH}|${bucket}`;
  const cached = perspectiveSurfaceCache.get(cacheKey);
  if (cached) return cached;

  const imageCache = getImageCache();
  const entry = imageCache.get(src);
  if (!entry || entry.state !== 'loaded' || !entry.image) {
    if (!entry || entry.state === 'idle') imageCache.load(src).catch(() => undefined);
    return null; // not loaded yet: placeholder this frame, reframe on load
  }
  const source = entry.image;

  const placement = computeImagePlacement({
    fit: fill.fit,
    sourceWidth: fill.imageWidth ?? (source as { width?: number }).width ?? w,
    sourceHeight: fill.imageHeight ?? (source as { height?: number }).height ?? h,
    bounds: { x: 0, y: 0, w, h },
    x: fill.x,
    y: fill.y,
    scale: fill.scale ?? 1,
    sourceCrop: crop,
    rotation: fill.rotation ?? 0,
    flipH: fill.flipH,
    flipV: fill.flipV,
  });
  if (!placement) return null;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.save();
  ctx.scale(qualityScale, qualityScale);
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  if (placement.fit === 'tile') {
    for (let y = placement.drawRect.y; y < h; y += placement.drawRect.h) {
      for (let x = placement.drawRect.x; x < w; x += placement.drawRect.w) {
        drawPlacedImage(ctx, source, placement, {
          x,
          y,
          w: placement.drawRect.w,
          h: placement.drawRect.h,
        });
      }
    }
  } else {
    drawPlacedImage(ctx, source, placement);
  }
  ctx.restore();

  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL('image/png');
  } catch {
    return null;
  }
  perspectiveSurfaceCache.set(cacheKey, dataUrl);
  return dataUrl;
}

/** Paint the exact crop/fit/rotation/flip placement into the bake surface. */
function drawPlacedImage(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  placement: ImagePlacement,
  drawRect = placement.drawRect,
): void {
  const sourceScale = {
    x:
      (source as { naturalWidth?: number; width?: number }).naturalWidth ??
      (source as { width?: number }).width ??
      placement.sourceWidth,
    y:
      (source as { naturalHeight?: number; height?: number }).naturalHeight ??
      (source as { height?: number }).height ??
      placement.sourceHeight,
  };
  const sample = placement.sourceRect;
  const sx = sample.x * (sourceScale.x / placement.sourceWidth);
  const sy = sample.y * (sourceScale.y / placement.sourceHeight);
  const sw = sample.w * (sourceScale.x / placement.sourceWidth);
  const sh = sample.h * (sourceScale.y / placement.sourceHeight);
  const dest = {
    x: placement.sampleDrawRect.x + drawRect.x - placement.drawRect.x,
    y: placement.sampleDrawRect.y + drawRect.y - placement.drawRect.y,
    w: placement.sampleDrawRect.w,
    h: placement.sampleDrawRect.h,
  };
  const transformed = placement.rotation !== 0 || placement.flipH || placement.flipV;
  if (!transformed) {
    ctx.drawImage(source, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h);
    return;
  }
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((placement.rotation * Math.PI) / 180);
  ctx.scale(placement.flipH ? -1 : 1, placement.flipV ? -1 : 1);
  ctx.drawImage(source, sx, sy, sw, sh, dest.x - cx, dest.y - cy, dest.w, dest.h);
  ctx.restore();
}

/**
 * Replace image items whose fill carries a perspective transform with a
 * `warpedImage` primitive. Mutates `items` in place (the perspective item
 * stands in for the original image item, preserving its transform).
 */
export function decoratePerspectiveImages(input: PerspectiveDecorateInput): void {
  const { doc, nodeIds, items, qualityScale } = input;

  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i]!;
    const node = doc.nodes[nodeId];
    if (!node || node.kind !== 'shape') continue;
    const fill = imageFillOf(node);
    if (!fill?.perspective || !isPerspectiveQuadValid(fill.perspective.quad)) continue;
    const item = items[i];
    if (!item) continue;

    const shape = node.shape;
    const w = 'w' in shape ? shape.w : 100;
    const h = 'h' in shape ? shape.h : 100;
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) continue;

    const quad = fill.perspective.quad;
    const surface = bakePerspectiveSurface(doc, node, fill, w, h, qualityScale);
    // If the surface is not yet baked (source still decoding), keep the
    // original image item for this frame; interactive reframes, export
    // pre-loads sources so this should not occur on the export path.
    if (!surface) continue;
    const src = surface;
    const outW = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(w * qualityScale)));
    const outH = Math.max(1, Math.min(MAX_SURFACE_PX, Math.round(h * qualityScale)));

    const warpedItem: RenderItem = {
      ...item,
      primitive: {
        kind: 'warpedImage',
        src,
        sourceW: outW,
        sourceH: outH,
        fit: 'stretch',
        alignX: 'center',
        alignY: 'center',
        quad: [
          [quad[0][0], quad[0][1]],
          [quad[1][0], quad[1][1]],
          [quad[2][0], quad[2][1]],
          [quad[3][0], quad[3][1]],
        ],
      },
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      fills: [],
      strokes: [],
      effects: [],
      opacity: 1,
    };
    items[i] = warpedItem;
  }
}

/** True when a document contains a perspective image that needs DOM replay. */
export function documentHasPerspectiveImage(doc: Document): boolean {
  return Object.values(doc.nodes).some(
    (node) =>
      node?.kind === 'shape' &&
      node.fills?.some((fill) => fill.type === 'image' && fill.image?.perspective !== undefined),
  );
}

/** Convenience: build the default (identity) perspective for a box. */
export function makeDefaultPerspective(w: number, h: number): ImageFillPerspective {
  return { quad: defaultPerspectiveQuad(w, h) };
}

/**
 * Ensure baked perspective surfaces are decoded before a one-shot export
 * paint (the live path relies on async reframe instead). Awaits the global
 * image cache load for every warpedImage src in the items.
 */
export async function settlePerspectiveSurfaces(items: RenderItem[]): Promise<void> {
  const loads: Promise<unknown>[] = [];
  for (const item of items) {
    const p = item.primitive;
    if (p && p.kind === 'warpedImage' && p.src) {
      loads.push(
        getImageCache()
          .load(p.src)
          .catch(() => undefined),
      );
    }
  }
  await Promise.all(loads);
}
