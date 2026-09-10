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

import { managedColorToNormalized, managedColorToRgba } from '@varve/shared';
import { gaussianBlurSeparable } from './blur';
import { mapBlendMode } from './compositeCanvas';
import type { ReplayTarget } from './replayTypes';
import type { EffectGradient, EngineColor, FillIR, RenderItem, Stroke } from './types';

export type EffectBuffer = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

/** Maximum per-side effect padding (guards against malformed parameter values). */
const MAX_EFFECT_PAD = 2048;

function effectCompositeMode(mode: string | undefined): GlobalCompositeOperation {
  try {
    return mapBlendMode(mode ?? 'normal') as GlobalCompositeOperation;
  } catch {
    return 'source-over';
  }
}

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
  // Compound paths may contain holes and non-zero/even-odd fill-rule changes
  // that a single geometric outline cannot preserve. Rasterise all authored
  // paths so shadows and inset effects follow the actual coverage.
  if (prim.kind === 'path') return true;
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

type InsetContour = 'linear' | 'smooth' | 'sharp';
type InsetOrigin = 'edge' | 'center';

function applyInsetContour(value: number, contour: InsetContour): number {
  const v = Math.max(0, Math.min(1, value));
  if (contour === 'sharp') return Math.sqrt(v);
  if (contour === 'smooth') return v * v * (3 - 2 * v);
  return v;
}

function sampleEffectGradient(
  gradient: EffectGradient | undefined,
  position: number,
  fallback: EngineColor,
): [number, number, number, number] {
  const stops = (gradient?.stops ?? [])
    .filter((stop) => stop?.color)
    .map((stop) => ({
      position: Math.max(0, Math.min(1, finiteOr(stop.position, 0))),
      rgba: managedColorToNormalized(stop.color),
    }))
    .sort((left, right) => left.position - right.position);
  if (stops.length === 0) return managedColorToNormalized(fallback);
  if (stops.length === 1) return stops[0]!.rgba;
  const t = Math.max(0, Math.min(1, position));
  if (t <= stops[0]!.position) return stops[0]!.rgba;
  for (let index = 1; index < stops.length; index++) {
    const before = stops[index - 1]!;
    const after = stops[index]!;
    if (t <= after.position) {
      const span = Math.max(1e-6, after.position - before.position);
      const local = Math.max(0, Math.min(1, (t - before.position) / span));
      return before.rgba.map(
        (channel, channelIndex) => channel + (after.rgba[channelIndex]! - channel) * local,
      ) as [number, number, number, number];
    }
  }
  return stops[stops.length - 1]!.rgba;
}

/**
 * Build a colourised inner-glow ring from rendered alpha, not geometry.
 *
 * Edge origin is A × (1 − blur(A)); center origin is A × blur(A). The first
 * term is deliberately multiplicative: it preserves transparent pixels and
 * antialiased glyph/vector edges while avoiding the old
 * `R × (1 − A) × A` canvas-composite ordering bug.
 */
export function buildInnerGlowImage(
  source: ImageData,
  blurred: ImageData,
  color: EngineColor,
  origin: InsetOrigin = 'edge',
  choke = 0,
  contour: InsetContour = 'smooth',
  gradient?: EffectGradient,
): ImageData {
  const data = new Uint8ClampedArray(source.data.length);
  const [solidR, solidG, solidB, solidAlpha] = managedColorToRgba(color);
  const chokeAmount = Math.max(0, Math.min(0.99, finiteOr(choke, 0)));
  const width = Math.min(source.data.length, blurred.data.length);
  for (let index = 0; index < width; index += 4) {
    const sourceAlpha = (source.data[index + 3] ?? 0) / 255;
    const blurAlpha = (blurred.data[index + 3] ?? 0) / 255;
    const raw = origin === 'center' ? sourceAlpha * blurAlpha : sourceAlpha * (1 - blurAlpha);
    const choked = chokeAmount > 0 ? Math.max(0, (raw - chokeAmount) / (1 - chokeAmount)) : raw;
    const effectAlpha = applyInsetContour(choked, contour);
    const [r, g, b, colorAlpha] = gradient
      ? sampleEffectGradient(gradient, raw, color)
      : [solidR / 255, solidG / 255, solidB / 255, solidAlpha / 255];
    const alpha = effectAlpha * colorAlpha;
    data[index] = Math.round(r * 255);
    data[index + 1] = Math.round(g * 255);
    data[index + 2] = Math.round(b * 255);
    data[index + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  }
  return new ImageData(data, source.width, source.height);
}

/** Build an outside-only glow from the rendered alpha silhouette. */
export function buildOuterGlowImage(
  source: ImageData,
  blurred: ImageData,
  color: EngineColor,
  choke = 0,
  contour: InsetContour = 'smooth',
  gradient?: EffectGradient,
): ImageData {
  const data = new Uint8ClampedArray(source.data.length);
  const [solidR, solidG, solidB, solidAlpha] = managedColorToRgba(color);
  const chokeAmount = Math.max(0, Math.min(0.99, finiteOr(choke, 0)));
  const width = Math.min(source.data.length, blurred.data.length);
  for (let index = 0; index < width; index += 4) {
    const sourceAlpha = (source.data[index + 3] ?? 0) / 255;
    const blurAlpha = (blurred.data[index + 3] ?? 0) / 255;
    const raw = blurAlpha * (1 - sourceAlpha);
    const choked = chokeAmount > 0 ? Math.max(0, (raw - chokeAmount) / (1 - chokeAmount)) : raw;
    const effectAlpha = applyInsetContour(choked, contour);
    const [r, g, b, colorAlpha] = gradient
      ? sampleEffectGradient(gradient, raw, color)
      : [solidR / 255, solidG / 255, solidB / 255, solidAlpha / 255];
    const alpha = effectAlpha * colorAlpha;
    data[index] = Math.round(r * 255);
    data[index + 1] = Math.round(g * 255);
    data[index + 2] = Math.round(b * 255);
    data[index + 3] = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  }
  return new ImageData(data, source.width, source.height);
}

/** Multiply an effect surface by the item's original rendered alpha. */
function clipImageToAlpha(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  mask: ImageData,
): void {
  try {
    const image = ctx.getImageData(0, 0, mask.width, mask.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const maskAlpha = (mask.data[index + 3] ?? 0) / 255;
      image.data[index + 3] = Math.round((image.data[index + 3] ?? 0) * maskAlpha);
    }
    ctx.putImageData(image, 0, 0);
  } catch {
    // Cross-origin image surfaces can reject readback. The caller still has a
    // valid effect buffer; skipping the optional alpha refinement is safer
    // than replacing a visible artwork with a rectangular fallback.
  }
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
    blendMode?: string;
  },
  ops: ShadowOps,
): void {
  const bounds = ops.primitiveBounds(item.primitive);
  const pad = Math.min(
    MAX_EFFECT_PAD,
    Math.ceil(
      finiteOr(effect.blur, 0) * 3 +
        Math.max(Math.abs(finiteOr(effect.x, 0)), Math.abs(finiteOr(effect.y, 0))),
    ),
  );
  const ow = Math.ceil(bounds.w + pad * 2);
  const oh = Math.ceil(bounds.h + pad * 2);
  if (ow <= 0 || oh <= 0) return;

  const buffer = ops.createEffectBuffer(ow, oh);
  if (!buffer) return;
  const bufferCtx = buffer.ctx;
  const localTarget = bufferCtx as unknown as ReplayTarget;
  const drawGeometry = (): void => {
    localTarget.beginPath();
    ops.traceOutline(localTarget, item.primitive);
    localTarget.fill();
    for (const stroke of item.strokes?.filter((s) => s.visible) ?? []) {
      localTarget.lineWidth = stroke.weight;
      localTarget.lineCap = stroke.cap as CanvasLineCap;
      localTarget.lineJoin = stroke.join as CanvasLineJoin;
      localTarget.lineDashOffset = stroke.dashOffset ?? 0;
      localTarget.setLineDash(stroke.dashPattern ?? []);
      localTarget.beginPath();
      ops.traceOutline(localTarget, item.primitive);
      localTarget.stroke();
    }
  };

  // Produce a shadow-only surface. A direct destination-over draw disappears
  // against an opaque backdrop; a direct source-over draw would repaint the
  // shape with the shadow colour. Erasing the source after the shadow draw
  // gives source-over the correct visibility without covering the item.
  bufferCtx.save();
  bufferCtx.translate(pad - bounds.x, pad - bounds.y);
  bufferCtx.shadowColor = ops.rgba(effect.color);
  bufferCtx.shadowBlur = finiteOr(effect.blur, 0);
  bufferCtx.shadowOffsetX = finiteOr(effect.x, 0);
  bufferCtx.shadowOffsetY = finiteOr(effect.y, 0);
  bufferCtx.fillStyle = ops.rgba(effect.color);
  bufferCtx.strokeStyle = ops.rgba(effect.color);
  drawGeometry();
  bufferCtx.globalCompositeOperation = 'destination-out';
  bufferCtx.shadowColor = 'transparent';
  bufferCtx.shadowBlur = 0;
  bufferCtx.shadowOffsetX = 0;
  bufferCtx.shadowOffsetY = 0;
  drawGeometry();
  bufferCtx.restore();

  target.save();
  target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
  target.globalCompositeOperation = effectCompositeMode(effect.blendMode);
  target.drawImage?.(
    buffer.canvas as unknown as CanvasImageSource,
    bounds.x - pad,
    bounds.y - pad,
    ow,
    oh,
  );
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
 *  3. Composite that shadow-only canvas over the existing backdrop using the
 *     effect blend mode. The source silhouette has already been removed, so
 *     this remains behind the item's visible pixels even though the target
 *     operation is source-over.
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
    blendMode?: string;
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
    target.globalCompositeOperation = effectCompositeMode(effect.blendMode);
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
    blendMode?: string;
    choke?: number;
    contour?: InsetContour;
    origin?: InsetOrigin;
    colorMode?: 'solid' | 'gradient';
    gradient?: EffectGradient;
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
  let originalSource: ImageData;
  try {
    originalSource = ctx.getImageData(0, 0, ow, oh);
  } catch {
    return;
  }
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
    try {
      const spreadSource = ctx.getImageData(0, 0, ow, oh);
      const blurred =
        blur > 0 ? gaussianBlurSeparable(spreadSource, Math.max(1, Math.ceil(blur))) : spreadSource;
      const ringImage = buildInnerGlowImage(
        originalSource,
        blurred,
        effect.color,
        effect.origin,
        effect.choke,
        effect.contour,
        effect.colorMode === 'gradient' ? effect.gradient : undefined,
      );
      ring.ctx.putImageData(ringImage, 0, 0);
    } catch {
      return;
    }

    target.save();
    target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
    target.globalCompositeOperation = effectCompositeMode(effect.blendMode);
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
  clipImageToAlpha(ctx, originalSource);

  // Composite onto main target. The rendered alpha mask above handles text
  // counters, transparent image pixels, and compound vector holes; clipping
  // to traceOutline would reintroduce rectangular/outline coverage errors.
  target.save();
  target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
  target.globalCompositeOperation = effectCompositeMode(effect.blendMode);
  target.drawImage?.(
    offscreen as unknown as CanvasImageSource,
    bounds.x - pad,
    bounds.y - pad,
    ow,
    oh,
  );
  target.restore();
}

/**
 * Paint an outside-only glow from rendered alpha. This is deliberately
 * separate from drop shadow: the glow has no offset and its alpha is
 * `blur(A) × (1 − A)`, so it cannot repaint opaque source pixels.
 */
export function paintAlphaAwareOuterGlow(
  target: ReplayTarget,
  item: RenderItem,
  effect: {
    blur: number;
    spread: number;
    color: EngineColor;
    opacity?: number;
    blendMode?: string;
    choke?: number;
    contour?: InsetContour;
    colorMode?: 'solid' | 'gradient';
    gradient?: EffectGradient;
  },
  ops: ShadowOps,
): void {
  const bounds = ops.primitiveBounds(item.primitive);
  const blur = finiteOr(effect.blur, 0);
  const pad = Math.min(MAX_EFFECT_PAD, Math.ceil(blur * 3) + Math.abs(finiteOr(effect.spread, 0)));
  const ow = Math.ceil(bounds.w + pad * 2);
  const oh = Math.ceil(bounds.h + pad * 2);
  if (ow <= 0 || oh <= 0) return;

  const buffer = ops.createEffectBuffer(ow, oh);
  if (!buffer) return;
  const { ctx } = buffer;
  ctx.save();
  ctx.translate(pad - bounds.x, pad - bounds.y);
  renderShadowSource(ctx as unknown as ReplayTarget, item, ops);
  ctx.restore();

  let originalSource: ImageData;
  try {
    originalSource = ctx.getImageData(0, 0, ow, oh);
  } catch {
    return;
  }
  applyAlphaSpread(ctx, ow, oh, effect.spread);

  const ring = ops.createEffectBuffer(ow, oh);
  if (!ring) return;
  try {
    const spreadSource = ctx.getImageData(0, 0, ow, oh);
    const blurred =
      blur > 0 ? gaussianBlurSeparable(spreadSource, Math.max(1, Math.ceil(blur))) : spreadSource;
    ring.ctx.putImageData(
      buildOuterGlowImage(
        originalSource,
        blurred,
        effect.color,
        effect.choke,
        effect.contour,
        effect.colorMode === 'gradient' ? effect.gradient : undefined,
      ),
      0,
      0,
    );
  } catch {
    return;
  }

  target.save();
  target.globalAlpha = (item.opacity ?? 1) * (effect.opacity ?? 1);
  target.globalCompositeOperation = effectCompositeMode(effect.blendMode);
  target.drawImage?.(
    ring.canvas as unknown as CanvasImageSource,
    bounds.x - pad,
    bounds.y - pad,
    ow,
    oh,
  );
  target.restore();
}
