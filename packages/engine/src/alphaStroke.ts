/**
 * Alpha-silhouette strokes for text and raster-backed content.
 *
 * A text primitive's geometry is its layout box, an image fill's geometry is
 * its host shape, and a raster layer's geometry is its tile extent. Strokes on
 * those objects must follow rendered alpha instead of tracing that enclosing
 * rectangle. The renderer is injected so this leaf shares the exact visible
 * fill path without importing the replay hub.
 */

import type { ReplayTarget } from './replayTypes';
import type { EffectBuffer } from './shadowSource';
import { applyAlphaSpread } from './shadowSource';
import type { RenderItem, Stroke } from './types';

export interface AlphaStrokeOps {
  createEffectBuffer(width: number, height: number): EffectBuffer | null;
  primitiveBounds(primitive: RenderItem['primitive']): {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  renderSource(target: ReplayTarget, item: RenderItem): void;
  strokeStyle(
    target: ReplayTarget,
    stroke: Stroke,
    item: RenderItem,
    bounds: { x: number; y: number; w: number; h: number },
  ): ReplayTarget['fillStyle'];
}

/** True when the visible alpha is not the primitive's enclosing geometry. */
export function needsAlphaSilhouetteStroke(item: RenderItem): boolean {
  const primitive = item.primitive;
  if (primitive.kind === 'text' || primitive.kind === 'rasterLayer') return true;
  if (primitive.kind === 'warpedImage') return true;
  return item.fills?.some((fill) => fill.visible && fill.type === 'image') ?? false;
}

/**
 * Paint a stroke around rendered alpha using a bounded morphology pass.
 *
 * Canvas2D has no primitive for "stroke this image/text alpha". Render the
 * source into a padded alpha buffer, dilate/erode that buffer to construct the
 * requested inside/center/outside band, then tint the band with the authored
 * stroke paint. Weight, color, alignment, transparency, holes and disconnected
 * components are preserved. Dash/cap/join remain vector-centerline settings;
 * raster-backed silhouettes do not have a centerline to dash or cap.
 */
export function paintAlphaSilhouetteStroke(
  target: ReplayTarget,
  stroke: Stroke,
  item: RenderItem,
  ops: AlphaStrokeOps,
): void {
  const bounds = ops.primitiveBounds(item.primitive);
  const weight = Number.isFinite(stroke.weight) ? Math.max(0, stroke.weight) : 0;
  if (weight <= 0 || bounds.w <= 0 || bounds.h <= 0 || !target.drawImage) return;

  // Inside/outside alignments put the full authored weight on one side of the
  // visible alpha. Center splits the width between the two sides.
  const outerRadius =
    stroke.align === 'inside' ? 0 : stroke.align === 'outside' ? weight : weight / 2;
  const innerRadius =
    stroke.align === 'outside' ? 0 : stroke.align === 'inside' ? weight : weight / 2;
  const pad = Math.min(2048, Math.max(2, Math.ceil(Math.max(outerRadius, innerRadius)) + 2));
  const width = Math.ceil(bounds.w + pad * 2);
  const height = Math.ceil(bounds.h + pad * 2);
  if (width <= 0 || height <= 0) return;

  const source = ops.createEffectBuffer(width, height);
  if (!source) return;

  // Text has a transparent/irrelevant fill in some legacy documents. The
  // alpha source needs an opaque paint color because only coverage matters.
  const sourceItem: RenderItem =
    item.primitive.kind === 'text'
      ? {
          ...item,
          fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          fills: [],
          strokes: [],
        }
      : { ...item, strokes: [] };

  source.ctx.save();
  source.ctx.translate(pad - bounds.x, pad - bounds.y);
  ops.renderSource(source.ctx as unknown as ReplayTarget, sourceItem);
  source.ctx.restore();

  const base = ops.createEffectBuffer(width, height);
  if (!base) return;

  if (stroke.align === 'inside') {
    base.ctx.drawImage(source.canvas as unknown as CanvasImageSource, 0, 0);
  } else {
    base.ctx.drawImage(source.canvas as unknown as CanvasImageSource, 0, 0);
    applyAlphaSpread(base.ctx, width, height, outerRadius);
  }

  if (innerRadius > 0) {
    const inner = ops.createEffectBuffer(width, height);
    if (!inner) return;
    inner.ctx.drawImage(source.canvas as unknown as CanvasImageSource, 0, 0);
    applyAlphaSpread(inner.ctx, width, height, -innerRadius);
    inner.ctx.save();
    inner.ctx.globalCompositeOperation = 'source-in';
    inner.ctx.fillStyle = 'rgba(0, 0, 0, 1)';
    inner.ctx.fillRect(0, 0, width, height);
    inner.ctx.restore();

    base.ctx.save();
    base.ctx.globalCompositeOperation = 'destination-out';
    base.ctx.drawImage(inner.canvas as unknown as CanvasImageSource, 0, 0);
    base.ctx.restore();
  } else if (stroke.align === 'outside') {
    // Outside alignment removes the original silhouette, leaving only the
    // dilated band. `innerRadius` is zero in this branch by construction.
    base.ctx.save();
    base.ctx.globalCompositeOperation = 'destination-out';
    base.ctx.drawImage(source.canvas as unknown as CanvasImageSource, 0, 0);
    base.ctx.restore();
  }

  const baseTarget = base.ctx as unknown as ReplayTarget;
  baseTarget.save();
  baseTarget.globalCompositeOperation = 'source-in';
  baseTarget.fillStyle = ops.strokeStyle(baseTarget, stroke, item, bounds);
  baseTarget.fillRect(0, 0, width, height);
  baseTarget.restore();

  target.drawImage(base.canvas as unknown as CanvasImageSource, bounds.x - pad, bounds.y - pad);
}
