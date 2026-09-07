/**
 * Alpha-aware shadow rendering — contour-following drop, inner, and glow
 * effects for the Canvas2D replay pipeline.
 *
 * The fast geometric shadow path casts a shadow from `traceOutline` — the
 * primitive's bounding outline. That is wrong whenever the item's visible
 * alpha differs from its outline: transparent PNGs, background-removal masks,
 * text glyphs, and stroke-only primitives. These functions instead rasterize
 * the item's true alpha silhouette and cast the shadow from that.
 *
 * This module is a leaf: it never imports runtime symbols from `replay.ts`.
 * The rendering primitives it needs (`traceOutline`, `paintShapeFill`,
 * `paintImageFill`, `paintStroke`, …) are injected via `ShadowOps`, which
 * keeps the module free of import cycles and keeps `replay.ts` complexity in
 * check (see AGENTS.md "Module instability ceiling" and the complexity
 * gates).
 */

import type { ReplayTarget } from './replay';
import type { EngineColor, FillIR, RenderItem, Stroke } from './types';

export type EffectBuffer = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

/** Maximum per-side effect padding (guards against malformed parameter values). */
const MAX_EFFECT_PAD = 2048;

/** Return a finite number, falling back to `fallback` for NaN/Infinity/absent. */
function finiteOr(v: number | undefined, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Apply true alpha morphology for effect spread. Canvas shadowBlur is a blur
 * radius, not a dilation/erosion radius; folding spread into it makes a
 * positive spread softer and a negative spread effectively disappear.
 *
 * The two separable passes keep this bounded to O(width × height), which is
 * important for raster layers whose shadow source can be substantially larger
 * than a vector primitive.
 */
export function applyAlphaSpread(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  spread: number,
): void {
  const radius = Math.min(MAX_EFFECT_PAD, Math.ceil(Math.abs(finiteOr(spread, 0))));
  if (radius <= 0 || width <= 0 || height <= 0) return;
  let image: ImageData;
  try {
    image = ctx.getImageData(0, 0, width, height);
  } catch {
    return;
  }

  const pixelCount = width * height;
  const source = new Uint8ClampedArray(pixelCount);
  for (let index = 0; index < pixelCount; index++) source[index] = image.data[index * 4 + 3]!;
  const horizontal = new Uint8ClampedArray(pixelCount);
  const output = new Uint8ClampedArray(pixelCount);
  const dilate = spread > 0;

  const morphLine = (
    input: Uint8ClampedArray,
    result: Uint8ClampedArray,
    start: number,
    stride: number,
    length: number,
  ): void => {
    const deque = new Int32Array(length);
    let head = 0;
    let tail = 0;
    const better = (left: number, right: number) =>
      dilate
        ? (input[left] ?? 0) >= (input[right] ?? 0)
        : (input[left] ?? 0) <= (input[right] ?? 0);
    for (let cursor = 0; cursor < length + radius; cursor++) {
      if (cursor < length) {
        const valueIndex = start + cursor * stride;
        while (tail > head && better(valueIndex, start + deque[tail - 1]! * stride)) tail--;
        deque[tail++] = cursor;
      }
      const removeBefore = cursor - radius * 2 - 1;
      if (head < tail && deque[head]! <= removeBefore) head++;
      const outputIndex = cursor - radius;
      if (outputIndex >= 0 && outputIndex < length && head < tail) {
        result[start + outputIndex * stride] = input[start + deque[head]! * stride]!;
      }
    }
  };

  for (let y = 0; y < height; y++) morphLine(source, horizontal, y * width, 1, width);
  for (let x = 0; x < width; x++) morphLine(horizontal, output, x, width, height);
  for (let index = 0; index < pixelCount; index++) image.data[index * 4 + 3] = output[index]!;
  try {
    ctx.putImageData(image, 0, 0);
  } catch {
    // An unavailable readback surface should leave the un-morphed silhouette;
    // the caller still has a valid shadow source and can render it safely.
  }
}

/** Rendering primitives provided by the replay module (dependency injection). */
export interface ShadowOps {
  traceOutline(target: ReplayTarget, p: RenderItem['primitive']): void;
  paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void;
  paintShapeFill(target: ReplayTarget, item: RenderItem): void;
  paintImageFill(
    target: ReplayTarget,
    fill: Extract<FillIR, { type: 'image' }>,
    item: RenderItem,
  ): void;
  paintStroke(target: ReplayTarget, stroke: Stroke, item: RenderItem): void;
  primitiveBounds(p: RenderItem['primitive']): { x: number; y: number; w: number; h: number };
  rgba(
    c: EngineColor | readonly [number, number, number, number],
    opacityOverride?: number,
  ): string;
  createEffectBuffer(w: number, h: number): EffectBuffer | null;
}

/**
 * Decide whether an item needs alpha-silhouette shadow rendering instead of
 * the fast geometric shadow path.
 *
 * The fast path casts the shadow from `traceOutline(item.primitive)` — the
 * geometric outline. That is wrong whenever the visible alpha of the item
 * differs from its outline:
 *
 *  - Raster content (image fills) may carry transparency, a background-
 *    removal alpha mask, a crop, rotation, or flips.
 *  - Text glyphs are not the text box (counters, descenders, irregular
 *    shapes).
 *  - Stroke-only primitives (lines, arrows) have zero fill area, so a fill
 *    of the outline casts no shadow at all.
 *  - Gradients, patterns, and translucent solid fills have non-uniform or
 *    reduced coverage that the geometric outline cannot represent.
 *
 * Solid/gradient/pattern fills on a shape (no image fill, no text) keep the
 * fast path: their visible alpha equals the shape outline.
 */
export function itemNeedsAlphaShadow(item: RenderItem): boolean {
  const prim = item.primitive;
  if (prim.kind === 'rasterLayer') return true;
  if (prim.kind === 'text') return true;
  if ((item.fill.a ?? 255) < 255) return true;
  if (
    item.fills?.some(
      (fill) =>
        fill.visible && (fill.type !== 'solid' || fill.opacity < 1 || (fill.color?.a ?? 255) < 255),
    )
  )
    return true;
  const hasVisibleFill = item.fills?.some((f) => f.visible) ?? false;
  const hasVisibleStroke = item.strokes?.some((s) => s.visible) ?? false;
  return !hasVisibleFill && hasVisibleStroke;
}

/**
 * Paint the item's visible alpha silhouette into `target` at local
 * coordinates, in opaque black. This is the canonical shadow source: the
 * Canvas shadow API reads the drawn content's alpha, so the shadow follows
 * the silhouette rather than the bounding rectangle.
 *
 * Coverage rules (documented, deterministic):
 *  - Image fills draw their true alpha (transparent PNG pixels, internal
 *    holes, feathered edges), honouring crop, rotation, flips, and the
 *    background-removal `alphaMask`.
 *  - Solid/gradient/pattern fills contribute the shape outline at full alpha
 *    (internal uniform fill alpha is already carried by the item's opacity
 *    during compositing).
 *  - Text glyphs contribute their rendered alpha (antialiased edges,
 *    counters, decorations).
 *  - Visible strokes contribute their stroked silhouette, so stroke-only
 *    objects still cast shadows.
 */
export function renderShadowSource(target: ReplayTarget, item: RenderItem, ops: ShadowOps): void {
  const fills = item.fills && item.fills.length > 0 ? item.fills : [];
  if (fills.length > 0) {
    for (const fill of fills) {
      if (!fill.visible) continue;
      target.save();
      target.globalAlpha = fill.opacity ?? 1;
      ops.paintFill(target, fill, item);
      target.restore();
    }
  } else {
    target.save();
    target.fillStyle = ops.rgba(item.fill);
    ops.paintShapeFill(target, item);
    target.restore();
  }

  const strokes = item.strokes?.filter((s) => s.visible) ?? [];
  if (strokes.length > 0) {
    const black: EngineColor = { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
    for (const stroke of strokes) {
      ops.paintStroke(target, { ...stroke, color: black }, item);
    }
  }
}

/** Fast geometric drop shadow: casts from `traceOutline` via the shadow API. */
export function paintGeometricDropShadow(
  target: ReplayTarget,
  item: RenderItem,
  effect: {
    blur: number;
    spread: number;
    x: number;
    y: number;
    color: EngineColor;
    opacity?: number;
  },
  ops: ShadowOps,
): void {
  target.save();
  target.shadowColor = ops.rgba(effect.color);
  target.shadowBlur = finiteOr(effect.blur, 0);
  target.shadowOffsetX = finiteOr(effect.x, 0);
  target.shadowOffsetY = finiteOr(effect.y, 0);
  target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
  target.globalCompositeOperation = 'destination-over';
  target.fillStyle = ops.rgba(effect.color);
  target.beginPath();
  ops.traceOutline(target, item.primitive);
  target.fill();

  const strokes = item.strokes?.filter((s) => s.visible) ?? [];
  if (strokes.length > 0) {
    for (const stroke of strokes) {
      target.save();
      target.strokeStyle = ops.rgba(effect.color);
      target.lineWidth = stroke.weight;
      target.lineCap = stroke.cap as CanvasLineCap;
      target.lineJoin = stroke.join as CanvasLineJoin;
      target.lineDashOffset = stroke.dashOffset ?? 0;
      if (stroke.dashPattern && stroke.dashPattern.length > 0) {
        target.setLineDash(stroke.dashPattern);
      }
      target.beginPath();
      ops.traceOutline(target, item.primitive);
      target.stroke();
      target.restore();
    }
  }
  target.restore();
}

/**
 * Render a drop shadow from the item's rendered alpha silhouette instead of
 * its geometric bounding shape. Transparent PNGs, background-removal masks,
 * text glyphs, and stroke-only primitives all cast shadows that follow their
 * visible contour.
 *
 * Strategy:
 *  1. Rasterize the alpha silhouette into `buffer` (see `renderShadowSource`).
 *  2. Draw `buffer` with the Canvas shadow API onto a second canvas, then
 *     erase the source pixels (`destination-out`) — leaving only the shadow.
 *  3. Composite that shadow-only canvas behind the item (`destination-over`).
 *
 * Composing shadow-only keeps semi-transparent items correct: the silhouette
 * is never re-drawn over the item's already-composited pixels.
 */
export function paintAlphaAwareDropShadow(
  target: ReplayTarget,
  item: RenderItem,
  effect: {
    blur: number;
    spread: number;
    x: number;
    y: number;
    color: EngineColor;
    opacity?: number;
  },
  ops: ShadowOps,
): void {
  const bounds = ops.primitiveBounds(item.primitive);
  const pad = Math.min(
    MAX_EFFECT_PAD,
    Math.ceil(
      finiteOr(effect.blur, 0) * 3 +
        Math.abs(finiteOr(effect.spread, 0)) +
        Math.max(Math.abs(finiteOr(effect.x, 0)), Math.abs(finiteOr(effect.y, 0))),
    ),
  );
  const ow = Math.ceil(bounds.w + pad * 2);
  const oh = Math.ceil(bounds.h + pad * 2);
  if (ow <= 0 || oh <= 0) return;

  const buffer = ops.createEffectBuffer(ow, oh);
  if (!buffer) {
    // A geometric fallback can expose a raster layer's transparent bounds.
    // Skipping the optional shadow preserves the artwork and is safer under
    // memory pressure than painting a visibly wrong rectangle.
    return;
  }

  const { canvas: offscreen, ctx } = buffer;
  ctx.save();
  ctx.translate(pad - bounds.x, pad - bounds.y);
  renderShadowSource(ctx as unknown as ReplayTarget, item, ops);
  ctx.restore();
  applyAlphaSpread(ctx, ow, oh, effect.spread);

  const shadowCanvas = ops.createEffectBuffer(ow, oh);
  if (shadowCanvas) {
    const sctx = shadowCanvas.ctx;
    sctx.save();
    sctx.shadowColor = ops.rgba(effect.color);
    sctx.shadowBlur = finiteOr(effect.blur, 0);
    sctx.shadowOffsetX = finiteOr(effect.x, 0);
    sctx.shadowOffsetY = finiteOr(effect.y, 0);
    sctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
    sctx.globalCompositeOperation = 'destination-out';
    sctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
    sctx.restore();

    target.save();
    target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
    target.globalCompositeOperation = 'destination-over';
    target.drawImage?.(
      shadowCanvas.canvas as unknown as CanvasImageSource,
      bounds.x - pad,
      bounds.y - pad,
      ow,
      oh,
    );
    target.restore();
  } else {
    // A second buffer is required to erase the source silhouette. Do not
    // redraw it behind the item: that fallback double-paints semi-transparent
    // content and can leak a rectangular raster footprint.
    return;
  }
}

/**
 * Render an inner shadow/glow from the item's rendered alpha silhouette.
 *
 * Inner shadow: cut a hole where the offset silhouette falls (leaving the
 * far-side band), blur, tint, composite clipped to the shape.
 *
 * Inner glow: blurred silhouette minus the crisp silhouette, kept only
 * inside the silhouette — a ring that hugs the inner contour of arbitrary
 * alpha (glyph counters, holes, feathered masks) rather than a shrunk
 * bounding rectangle.
 */
export function paintAlphaAwareInsetEffect(
  target: ReplayTarget,
  item: RenderItem,
  effect: {
    blur: number;
    spread: number;
    color: EngineColor;
    opacity?: number;
    x?: number;
    y?: number;
  },
  mode: 'shadow' | 'glow',
  ops: ShadowOps,
): void {
  const bounds = ops.primitiveBounds(item.primitive);
  const blur = finiteOr(effect.blur, 0);
  const offsetX = mode === 'shadow' ? finiteOr(effect.x, 0) : 0;
  const offsetY = mode === 'shadow' ? finiteOr(effect.y, 0) : 0;
  const pad = Math.min(
    MAX_EFFECT_PAD,
    Math.ceil(blur * 3) +
      Math.abs(finiteOr(effect.spread, 0)) +
      Math.max(Math.abs(offsetX), Math.abs(offsetY)),
  );
  const ow = Math.ceil(bounds.w + pad * 2);
  const oh = Math.ceil(bounds.h + pad * 2);

  const buffer = ops.createEffectBuffer(ow, oh);
  if (!buffer) return;

  const { canvas: offscreen, ctx } = buffer;
  const ox = pad - bounds.x;
  const oy = pad - bounds.y;

  // Render the item's true alpha silhouette (image fills honour crop, flips,
  // and the background-removal mask; text contributes glyph contours).
  ctx.save();
  ctx.translate(ox, oy);
  renderShadowSource(ctx as unknown as ReplayTarget, item, ops);
  ctx.restore();
  applyAlphaSpread(ctx, ow, oh, effect.spread);

  // Tint helper: replace buffer content with the effect colour, scaled by the
  // effect's own alpha channel.
  const tint = (c: typeof ctx): void => {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = ops.rgba(effect.color);
    c.fillRect(0, 0, ow, oh);
    c.restore();
  };

  if (mode === 'glow') {
    const ring = ops.createEffectBuffer(ow, oh);
    if (!ring) return;
    const rctx = ring.ctx;
    rctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
    if (blur > 0) {
      rctx.save();
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.filter = `blur(${blur}px)`;
      rctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
      rctx.restore();
    }
    rctx.save();
    rctx.globalCompositeOperation = 'destination-out';
    rctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
    rctx.globalCompositeOperation = 'destination-in';
    rctx.drawImage(offscreen as unknown as CanvasImageSource, 0, 0);
    rctx.restore();
    tint(rctx);

    target.save();
    target.beginPath();
    ops.traceOutline(target, item.primitive);
    if (target.clip) target.clip();
    target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
    target.globalCompositeOperation = 'source-over';
    target.drawImage?.(
      ring.canvas as unknown as CanvasImageSource,
      bounds.x - pad,
      bounds.y - pad,
      ow,
      oh,
    );
    target.restore();
    return;
  }

  // Inner shadow: cut a hole where the offset silhouette falls, leaving the
  // far-side band; blur; tint.
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.translate(-offsetX, -offsetY);
  ctx.translate(ox, oy);
  renderShadowSource(ctx as unknown as ReplayTarget, item, ops);
  ctx.restore();

  if (blur > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  tint(ctx);

  // Composite onto main target, clipped to shape.
  target.save();
  target.beginPath();
  ops.traceOutline(target, item.primitive);
  if (target.clip) target.clip();
  target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
  target.globalCompositeOperation = 'source-over';
  target.drawImage?.(
    offscreen as unknown as CanvasImageSource,
    bounds.x - pad,
    bounds.y - pad,
    ow,
    oh,
  );
  target.restore();
}
