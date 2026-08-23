// COMPLEXITY: 650 cyclo — replayIr is a hot path; see AGENTS.md §"The clean version is not always the fast version"
/**
 * Canvas2D replay of the render IR (the webview side of ADR-0001).
 *
 * This is the exact strategy the task-0.2 spike measured at 86 fps: native Rust
 * computes the scene and emits a compact IR; the webview replays it to a canvas.
 * `ReplayTarget` is a structural slice of CanvasRenderingContext2D so tests can
 * pass a recorder without a real DOM/canvas.
 *
 * F6 (Phase 2): opacity, blend modes, per-fill compositing, stacked strokes
 * and effects, plus arrow/path/image primitive rendering.
 */

import {
  type BlendEvaluationSpace,
  expandGradientStops,
  managedColorToNormalized,
  managedColorToRgba,
} from '@varve/shared';
import { blendPixels, CompositeCanvas, mapBlendMode } from './compositeCanvas';
import { deserializeDepthMap, resizeDepthMap } from './depthMap';
import { compositeMaskedEffectPixels, type PixelImageData } from './effectMaskCompositor';
import {
  applyChromaticAberration,
  applyGlassMaterialBackdrop,
  applyGlitch,
  clampByte,
  computeScreenBounds,
} from './effectPipeline';
import { applyFilterWithCompositing } from './filterCompositor';
import { applyFilterChain, filterChainToCss, filterToCss, supportsCanvasFilter } from './filters';
import { FrameCache } from './frameCache';
import { getImageCache } from './imageCache';
import { imagePlaceholderFill } from './imagePlaceholder';
import {
  computeImagePlacement,
  type ImagePlacement,
  type ImagePlacementRect,
} from './imagePlacement';
import { applyDepthBlur } from './lensBlur';
import {
  paintWarpedImage,
  quadBoundsOf,
  type ReplayImagePolicy,
  resolveReplayImage,
} from './mockup/warpReplay';
import { pathFillRule, pathRings } from './pathCompound';
import { flattenShapedRuns, placeLinesOnPath } from './pathText';
import { getRasterLayerCache } from './rasterLayerCache';
import {
  decideRasterStrategy,
  drawRasterLayerLod,
  effectiveScaleFromTransform,
  getPyramidResidency,
  getPyramidViewport,
  isRasterPyramidEnabled,
  layerVisibleRect,
  type PyramidLayerSource,
  registerPyramidSource,
} from './rasterPyramid/renderTiles';
import { emitRasterReplaySample, isRasterReplayMeasured } from './rasterReplayMetrics';
import { createRasterSurface } from './rasterSurface';
import { layoutRichTextSnapshot } from './richTextLayout';
import {
  itemNeedsAlphaShadow,
  paintAlphaAwareDropShadow,
  paintAlphaAwareInsetEffect,
  paintGeometricDropShadow,
  type ShadowOps,
} from './shadowSource';
import { shapeText } from './shaping';
import { layoutRichText } from './textLayout';
import { buildTextLayoutSnapshot, type TextLayoutSnapshot } from './textLayoutSnapshot';
import type { ArrowheadStyle, EngineColor, FillIR, Primitive, RenderItem, Stroke } from './types';
import { splitGraphemes } from './unicode/grapheme';

type GlassMaterialEffect = Extract<import('./types').Effect, { type: 'glassMaterial' }>;

export interface ReplayTarget {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  rect(x: number, y: number, w: number, h: number): void;
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    rot: number,
    start: number,
    end: number,
  ): void;
  arc(x: number, y: number, r: number, start: number, end: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  /** Rounded-rect path (Canvas2D `roundRect`); radii mirror the CSS shorthand forms. */
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void;
  fill(fillRule?: CanvasFillRule): void;
  stroke(): void;
  closePath(): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
  /** Optional measurement hook used to derive a canonical browser snapshot. */
  measureText?(text: string): TextMetrics;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  textAlign: CanvasTextAlign;
  lineJoin: CanvasLineJoin;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  /** F6: opacity for the item layer. */
  globalAlpha: number;
  /** F6: blend mode compositing. */
  globalCompositeOperation: string;
  /** F6: CSS filter for effects. */
  filter: string;
  lineDashOffset: number;
  setLineDash(segments: number[]): void;
  /**
   * Draw an image. Supports Canvas2D overloads:
   *   3-arg: drawImage(image, dx, dy)
   *   5-arg: drawImage(image, dx, dy, dw, dh)
   *   9-arg: drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
   */
  drawImage?(
    image: CanvasImageSource | string,
    a1: number,
    a2: number,
    a3?: number,
    a4?: number,
    a5?: number,
    a6?: number,
    a7?: number,
    a8?: number,
  ): void;
  /** P2: create a linear gradient for gradient fills. */
  createLinearGradient?(x0: number, y0: number, x1: number, y1: number): ReplayGradient;
  /** P2: create a radial gradient for gradient fills. */
  createRadialGradient?(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ): ReplayGradient;
  /** P2: create a conic gradient for angular gradient fills. */
  createConicGradient?(angle: number, cx: number, cy: number): ReplayGradient;
  /** P2: create a pattern from a canvas/image for tiling fills. */
  createPattern?(image: CanvasImageSource, repetition: string): CanvasPattern | null;
  /** P2: for shadow effects (replay clips shadow pass). */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Create a pattern from an image source. */
  createPattern?(image: CanvasImageSource | string, repetition: string): ReplayPattern | null;
  /** Canvas element reference for offscreen compositing (filter compositor, background blur). */
  canvas?: { width: number; height: number };
  /** Reset the current transform matrix (Canvas2D setTransform). */
  setTransform?(a: number, b: number, c: number, d: number, e: number, f: number): void;
  /** Read the current transform matrix (Canvas2D getTransform). */
  getTransform?(): { a: number; b: number; c: number; d: number; e: number; f: number };
  getImageData?(x: number, y: number, width: number, height: number): ImageData;
  putImageData?(data: ImageData, x: number, y: number): void;
}

export interface ReplayColorOptions {
  /** Artistic blend formula evaluation; defaults to legacy encoded sRGB. */
  blendEvaluationSpace?: BlendEvaluationSpace;
}

/** Resolve non-raster effect masks in a structural scene replay. */
export type EffectMaskResolver = (
  binding: NonNullable<NonNullable<RenderItem['effects']>[number]['mask']>,
  item: RenderItem,
  target: ReplayTarget,
  width: number,
  height: number,
) => PixelImageData | undefined;

export interface ReplayPattern {
  /** Transform the pattern's coordinate system. */
  setTransform(transform: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  }): void;
}

export interface ReplayGradient {
  addColorStop(offset: number, color: string): void;
}

/**
 * Render alpha mask compositing using offscreen canvas double-buffering.
 *
 * Creates two offscreen canvases at the main canvas size:
 *   1. Mask canvas — renders the mask source content (alpha channel = opacity)
 *   2. Content canvas — renders the masked content
 *
 * Then composites content onto the content canvas using `destination-in`,
 * which keeps content pixels only where the mask canvas has non-zero alpha.
 * The composited result is drawn onto the main canvas.
 *
 * If the main canvas has zero dimensions, this is a no-op.
 */
export function renderAlphaMask(
  ctx: CanvasRenderingContext2D,
  maskSource: { draw: (ctx: CanvasRenderingContext2D) => void },
  content: { draw: (ctx: CanvasRenderingContext2D) => void },
): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  if (w === 0 || h === 0) return;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d');
  if (!maskCtx) return;

  const contentCanvas = document.createElement('canvas');
  contentCanvas.width = w;
  contentCanvas.height = h;
  const contentCtx = contentCanvas.getContext('2d');
  if (!contentCtx) return;

  // Render mask source content to mask canvas
  maskSource.draw(maskCtx);

  // Render masked content to content canvas
  content.draw(contentCtx);

  // Composite: destination-in keeps content only where mask has alpha
  contentCtx.globalCompositeOperation = 'destination-in';
  contentCtx.drawImage(maskCanvas, 0, 0);

  // Draw the composited result onto the main canvas
  ctx.drawImage(contentCanvas, 0, 0);
}

function rgba(
  c: EngineColor | readonly [number, number, number, number],
  opacityOverride?: number,
): string {
  if (c == null) {
    return 'rgba(0, 0, 0, 0)';
  }
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    const alpha = opacityOverride !== undefined ? opacityOverride : arr[3] / 255;
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${alpha})`;
  }
  const [r, g, b, a] = managedColorToRgba(c as EngineColor);
  const alpha = opacityOverride !== undefined ? opacityOverride : a / 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Format a working gradient color without rounding channels before Canvas2D. */
function rgbaWorking(c: EngineColor | readonly [number, number, number, number]): string {
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${arr[3] / 255})`;
  }
  const [r, g, b, a] = managedColorToNormalized(c as EngineColor);
  return `rgba(${r * 255}, ${g * 255}, ${b * 255}, ${a})`;
}

const TAU = Math.PI * 2;

type BackgroundBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'backgroundBlur' }
>;
type LayerBlurEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'layerBlur' }>;
type DepthBlurEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'depthBlur' }>;
type ChromaticAberrationEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'chromaticAberration' }
>;
type GlitchEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'glitch' }>;
type InnerShadowEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'innerShadow' }
>;
type InnerGlowEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'innerGlow' }>;

/** Create an offscreen 2D buffer, falling back to HTMLCanvasElement when needed. */
function createEffectBuffer(
  w: number,
  h: number,
): {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
} | null {
  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(w, h);
    const ctx = oc.getContext('2d');
    if (ctx) return { canvas: oc, ctx };
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) return { canvas: c, ctx };
  }
  return null;
}

/**
 * Rendering primitives injected into the alpha-aware shadow pipeline
 * (see `shadowSource.ts`). Kept in `replay.ts` so shadow rendering reuses the
 * exact same tracing/fill/image code paths as the main fill pass, without an
 * import cycle.
 */
const shadowOps: ShadowOps = {
  traceOutline,
  paintShapeFill,
  paintImageFill,
  paintStroke,
  primitiveBounds,
  rgba,
  createEffectBuffer,
};

/** Maximum padding needed to keep content effects from being cropped. */
function contentEffectPadding(
  effects: readonly (
    | LayerBlurEffect
    | DepthBlurEffect
    | ChromaticAberrationEffect
    | GlitchEffect
  )[],
): number {
  let padding = 0;
  for (const e of effects) {
    if (e.type === 'layerBlur') {
      padding = Math.max(padding, Math.max(0, e.radius) * 3);
    } else if (e.type === 'depthBlur') {
      padding = Math.max(padding, Math.max(0, e.blurStrength) * 3);
    } else if (e.type === 'chromaticAberration') {
      const intensity = Math.max(0, e.intensity ?? 1);
      const o = e.offsets;
      const maxOff = Math.max(
        Math.abs(o.redX),
        Math.abs(o.redY),
        Math.abs(o.greenX),
        Math.abs(o.greenY),
        Math.abs(o.blueX),
        Math.abs(o.blueY),
      );
      padding = Math.max(padding, Math.ceil(maxOff * intensity));
    } else if (e.type === 'glitch') {
      const cs = e.channelShift;
      const maxChannel = Math.max(
        Math.abs(cs.redX),
        Math.abs(cs.redY),
        Math.abs(cs.greenX),
        Math.abs(cs.greenY),
        Math.abs(cs.blueX),
        Math.abs(cs.blueY),
      );
      padding = Math.max(
        padding,
        Math.ceil(Math.max(Math.max(0, e.strength), Math.max(0, e.blockStrength), maxChannel)),
      );
    }
  }
  return padding;
}

/** Apply an effect-local raster mask to the current local effect surface. */
function applyRasterEffectMask(
  canvas: CompositeCanvas,
  input: ImageData,
  effect: NonNullable<RenderItem['effects']>[number],
  item: RenderItem,
  effectMaskResolver?: EffectMaskResolver,
): void {
  const binding = effect.mask;
  const source = binding?.source;
  if (!binding || binding.visible === false) return;
  if (source?.kind !== 'raster-asset') {
    const mask = effectMaskResolver?.(
      binding,
      item,
      canvas.ctx as unknown as ReplayTarget,
      input.width,
      input.height,
    );
    if (!mask) return;
    const evaluated = canvas.getImageData(0, 0, canvas.width, canvas.height);
    const merged = compositeMaskedEffectPixels(input, evaluated, mask, binding);
    canvas.putImageData(merged as unknown as ImageData, 0, 0);
    return;
  }
  if (!source.src) {
    return;
  }
  const image = resolveReplayImage(source.src, imageLookupForCurrentReplay, getImageCache());
  if (!image) return;
  const maskBuffer = createEffectBuffer(canvas.canvas.width, canvas.canvas.height);
  if (!maskBuffer) return;
  const maskCtx = maskBuffer.ctx as CanvasRenderingContext2D;
  maskCtx.setTransform(1, 0, 0, 1, 0, 0);
  maskCtx.clearRect(0, 0, maskBuffer.canvas.width, maskBuffer.canvas.height);
  maskCtx.drawImage(
    image as CanvasImageSource,
    0,
    0,
    maskBuffer.canvas.width,
    maskBuffer.canvas.height,
  );
  const mask = maskCtx.getImageData(0, 0, maskBuffer.canvas.width, maskBuffer.canvas.height);
  const evaluated = canvas.getImageData(0, 0, canvas.width, canvas.height);
  const merged = compositeMaskedEffectPixels(input, evaluated, mask, binding);
  canvas.putImageData(merged as unknown as ImageData, 0, 0);
}

/** Paint fills and strokes to `target` (shared by direct and layerBlur offscreen paths). */
function paintFillsAndStrokes(
  target: ReplayTarget,
  item: RenderItem,
  itemAlpha: number,
  itemBlend: string,
): void {
  const fills = item.fills;
  if (fills && fills.length > 0) {
    const restoreBlend = target.globalCompositeOperation;
    for (const fill of fills) {
      if (!fill.visible) continue;
      target.globalAlpha = itemAlpha * (fill.opacity ?? 1);
      if (fill.blendMode && fill.blendMode !== 'normal') {
        target.globalCompositeOperation = mapBlendMode(fill.blendMode);
      } else if (itemBlend !== 'source-over') {
        target.globalCompositeOperation = itemBlend;
      } else {
        target.globalCompositeOperation = restoreBlend;
      }
      paintFill(target, fill, item);
    }
  } else {
    target.fillStyle = rgba(item.fill);
    paintShapeFill(target, item);
  }

  const visibleStrokes = item.strokes?.filter((s) => s.visible) ?? [];
  if (visibleStrokes.length > 0) {
    for (const stroke of visibleStrokes) {
      paintStroke(target, stroke, item);
    }
  } else if (item.primitive.kind === 'line' || item.primitive.kind === 'arrow') {
    // Backward-compat fallback: lines/arrows with no visible stroke still render
    // with a default stroke so they don't vanish after the fill-pass removal.
    const fallback: Stroke = {
      color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
      weight: item.primitive.kind === 'arrow' ? 2 : 2,
      align: 'center',
      dashPattern: [],
      dashOffset: 0,
      cap: 'round',
      join: 'miter',
      miterLimit: 4,
      visible: true,
      ...(item.primitive.kind === 'arrow' ? { arrowEnd: 'arrow' as const } : {}),
    };
    paintStroke(target, fallback, item);
  }
}

/**
 * Capture the canvas backdrop behind an item, blur it, and composite clipped to the shape.
 * Must run before the item's own fills are painted.
 */
function paintBackgroundBlur(
  target: ReplayTarget,
  item: RenderItem,
  effect: BackgroundBlurEffect,
): void {
  const canvas = target.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  if (!canvas || !target.drawImage || typeof OffscreenCanvas === 'undefined') return;
  if (!target.getTransform) return;

  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const pad = Math.ceil(effect.radius * 3);
  const lx = bounds.x - pad;
  const ly = bounds.y - pad;
  const lw = bounds.w + pad * 2;
  const lh = bounds.h + pad * 2;

  const m = target.getTransform();
  const screen = computeScreenBounds(m, lx, ly, lw, lh);
  const sw = screen.w;
  const sh = screen.h;

  // ── Backdrop cache lookup ─────────────────────────────────────
  const cacheKeyInput = backdropCacheKey(lx, ly, lw, lh, m, item.transform, effect.radius);
  const cached = getBackdropCache(cacheKeyInput);
  if (cached) {
    // Cache hit: composite the pre-blurred backdrop clipped to shape
    target.save();
    target.beginPath();
    traceOutline(target, item.primitive);
    if (target.clip) target.clip();
    target.drawImage(cached.canvas as CanvasImageSource, lx, ly, lw, lh);
    target.restore();
    return;
  }

  const cc = new CompositeCanvas({ width: sw, height: sh, devicePixelRatio: 1 });
  cc.captureSource(canvas, screen.x, screen.y, sw, sh, 0, 0);
  cc.applyBlur(effect.radius);

  // ── Store in cache ────────────────────────────────────────────
  setBackdropCache(cacheKeyInput, cc.canvas);

  target.save();
  target.beginPath();
  traceOutline(target, item.primitive);
  if (target.clip) target.clip();
  target.drawImage(cc.canvas as unknown as CanvasImageSource, lx, ly, lw, lh);
  target.restore();
}

/**
 * Glass material: captures backdrop, blurs, tints, adjusts saturation/brightness,
 * adds noise, and composites as the item's visual content. Optional edge highlight
 * renders a light inner edge for depth.
 *
 * Renders before fills (like backgroundBlur) so fills/strokes sit on top.
 * Call paintGlassMaterialEdgeHighlight in the effects pass for the edge highlight.
 *
 * Research basis: Figma Glass effect (2025), Apple NSVisualEffectView/UIVisualEffectView,
 * CSS backdrop-filter with tint overlay.
 */
function paintGlassMaterial(
  target: ReplayTarget,
  item: RenderItem,
  effect: GlassMaterialEffect,
): void {
  const canvas = target.canvas as HTMLCanvasElement | OffscreenCanvas | undefined;
  if (!canvas || !target.drawImage || typeof OffscreenCanvas === 'undefined') return;
  if (!target.getTransform) return;

  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  const pad = Math.ceil(effect.blur * 3 + 10);
  const lx = bounds.x - pad;
  const ly = bounds.y - pad;
  const lw = bounds.w + pad * 2;
  const lh = bounds.h + pad * 2;

  const m = target.getTransform();
  const screen = computeScreenBounds(m, lx, ly, lw, lh);
  const sw = screen.w;
  const sh = screen.h;

  const cc = new CompositeCanvas({ width: sw, height: sh, devicePixelRatio: 1 });
  cc.captureSource(canvas, screen.x, screen.y, sw, sh, 0, 0);

  // Step 1: Blur the backdrop
  cc.applyBlur(effect.blur);

  // Steps 2-5: tint, saturation, brightness, noise (shared pipeline)
  applyGlassMaterialBackdrop(cc, sw, sh, effect);

  // Composite the processed backdrop clipped to the shape
  target.save();
  target.beginPath();
  traceOutline(target, item.primitive);
  if (target.clip) target.clip();
  target.drawImage(cc.canvas as unknown as CanvasImageSource, lx, ly, lw, lh);
  target.restore();
}

/**
 * Paint the glass material edge highlight after fills/strokes.
 * Renders a light inner edge for depth cue.
 */
function paintGlassMaterialEdgeHighlight(
  target: ReplayTarget,
  item: RenderItem,
  effect: GlassMaterialEffect,
): void {
  if (!effect.edgeHighlight || effect.edgeHighlightWidth <= 0) return;
  target.save();
  target.globalAlpha = clampByte(effect.edgeHighlightOpacity * 255) / 255;
  target.strokeStyle = rgba(effect.edgeHighlightColor);
  target.lineWidth = effect.edgeHighlightWidth;
  target.beginPath();
  traceOutline(target, item.primitive);
  target.stroke();
  target.restore();
}

/**
 * Inset shadow/glow via offscreen silhouette-difference + blur.
 * Composites on top of existing content (source-over), clipped to shape.
 */
function paintInsetEffect(
  target: ReplayTarget,
  item: RenderItem,
  effect: InnerShadowEffect | InnerGlowEffect,
  mode: 'shadow' | 'glow',
): void {
  const bounds = primitiveBounds(item.primitive);
  const blur = effect.blur + Math.max(0, effect.spread) / 2;
  const offsetX = mode === 'shadow' && 'x' in effect ? effect.x : 0;
  const offsetY = mode === 'shadow' && 'y' in effect ? effect.y : 0;
  const pad = Math.ceil(blur * 3) + Math.max(Math.abs(offsetX), Math.abs(offsetY));
  const ow = Math.ceil(bounds.w + pad * 2);
  const oh = Math.ceil(bounds.h + pad * 2);

  const buffer = createEffectBuffer(ow, oh);
  if (!buffer) return;

  const { canvas: offscreen, ctx } = buffer;

  const offTarget = ctx as unknown as ReplayTarget;
  ctx.translate(pad - bounds.x, pad - bounds.y);

  // Full silhouette
  offTarget.fillStyle = 'rgba(0,0,0,1)';
  offTarget.beginPath();
  traceOutline(offTarget, item.primitive);
  offTarget.fill();

  // Cut hole for directional shadow or symmetric glow ring
  offTarget.globalCompositeOperation = 'destination-out';
  offTarget.beginPath();
  if (mode === 'shadow') {
    offTarget.save();
    offTarget.transform(1, 0, 0, 1, -offsetX, -offsetY);
    traceOutline(offTarget, item.primitive);
    offTarget.fill();
    offTarget.restore();
  } else {
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const maxDim = Math.max(bounds.w, bounds.h, 1);
    const shrink = Math.max(0.01, 1 - (blur + effect.spread) / maxDim);
    offTarget.save();
    offTarget.transform(1, 0, 0, 1, cx, cy);
    offTarget.transform(shrink, 0, 0, shrink, 0, 0);
    offTarget.transform(1, 0, 0, 1, -cx, -cy);
    traceOutline(offTarget, item.primitive);
    offTarget.fill();
    offTarget.restore();
  }

  // Blur the ring
  if (blur > 0) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(offscreen, 0, 0);
    ctx.restore();
  }

  // Tint to effect color
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = rgba(effect.color);
  ctx.globalAlpha = effect.opacity ?? 1;
  ctx.fillRect(0, 0, ow, oh);
  ctx.restore();

  // Composite onto main target, clipped to shape
  target.save();
  target.beginPath();
  traceOutline(target, item.primitive);
  if (target.clip) target.clip();
  target.globalAlpha = effect.opacity ?? 1;
  target.globalCompositeOperation = 'source-over';
  if (target.drawImage) {
    target.drawImage(
      offscreen as unknown as CanvasImageSource,
      bounds.x - pad,
      bounds.y - pad,
      ow,
      oh,
    );
  }
  target.restore();
}

/** Replay `ir` into `target` (a 2D context). Clears nothing; caller manages. */
/**
 * Module-level image lookup for the current replayIr call.
 * Set before calling internal paint functions, used by paintImageFill.
 * This avoids threading a parameter through 7 levels of function calls.
 */
let imageLookupForCurrentReplay: ((src: string) => CanvasImageSource | undefined) | null = null;
let effectMaskResolverForCurrentReplay: EffectMaskResolver | null = null;
let imagePolicyForCurrentReplay: ReplayImagePolicy | undefined;

function replayItemOnIsolatedSurface(
  target: ReplayTarget,
  item: RenderItem,
  imageLookup?: (src: string) => CanvasImageSource | undefined,
  effectMaskResolver?: EffectMaskResolver,
  imagePolicy?: ReplayImagePolicy,
  colorOptions?: ReplayColorOptions,
): boolean {
  const canvas = target.canvas;
  const needsLinearBlend =
    colorOptions?.blendEvaluationSpace === 'linear-srgb' &&
    item.blendMode !== undefined &&
    item.blendMode !== 'normal';
  if (
    !canvas ||
    !target.drawImage ||
    !target.getTransform ||
    !target.setTransform ||
    (!item.filters?.some(
      (filter) =>
        !supportsCanvasFilter(target) ||
        filter.blendMode !== 'normal' ||
        (filter.opacity ?? 1) < 1 ||
        !filterToCss(filter),
    ) &&
      !needsLinearBlend) ||
    (needsLinearBlend && (!target.getImageData || !target.putImageData))
  ) {
    return false;
  }

  let surface: ReturnType<typeof createRasterSurface>;
  try {
    surface = createRasterSurface(canvas.width, canvas.height);
  } catch {
    return false;
  }

  const matrix = target.getTransform();
  surface.context.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  replayIr(
    surface.context as unknown as ReplayTarget,
    [
      {
        ...item,
        opacity: 1,
        blendMode: 'normal',
        filters: undefined,
      },
    ],
    imageLookup,
    effectMaskResolver ?? effectMaskResolverForCurrentReplay ?? undefined,
    imagePolicy,
    colorOptions,
  );
  applyFilterWithCompositing(
    surface.context as CanvasRenderingContext2D,
    item.filters ?? [],
    canvas.width,
    canvas.height,
  );

  if (needsLinearBlend && target.getImageData && target.putImageData) {
    const backdrop = target.getImageData(0, 0, canvas.width, canvas.height);
    const source = surface.context.getImageData(0, 0, canvas.width, canvas.height);
    target.putImageData(
      blendPixels(backdrop, source, item.blendMode ?? 'normal', item.opacity ?? 1, 'linear-srgb'),
      0,
      0,
    );
    return true;
  }

  target.save();
  try {
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = item.opacity ?? 1;
    target.globalCompositeOperation =
      item.blendMode && item.blendMode !== 'normal' ? mapBlendMode(item.blendMode) : 'source-over';
    target.drawImage(surface.canvas as CanvasImageSource, 0, 0);
  } finally {
    target.restore();
  }
  return true;
}

/**
 * Replay a list of render items to the given canvas target.
 * @param imageLookup Optional callback for resolving image source URLs to
 *   CanvasImageSource (used by render workers that receive ImageBitmaps
 *   via Structured Clone and cannot use `new Image()`).
 * @param imagePolicy Optional interactive image representation policy. Export
 *   and print callers omit this argument and therefore always use full source
 *   fidelity.
 */
export function replayIr(
  target: ReplayTarget,
  ir: readonly RenderItem[],
  imageLookup?: (src: string) => CanvasImageSource | undefined,
  effectMaskResolver?: EffectMaskResolver,
  imagePolicy?: ReplayImagePolicy,
  colorOptions?: ReplayColorOptions,
): void {
  // Sweep expired backdrop cache entries (preserves recent entries across frames)
  sweepBackdropCache();
  // Frame-based gradient cache eviction
  gradientCache.nextFrame();
  gradientCache.sweep();
  const previousImageLookup = imageLookupForCurrentReplay;
  const previousEffectMaskResolver = effectMaskResolverForCurrentReplay;
  const previousImagePolicy = imagePolicyForCurrentReplay;
  imageLookupForCurrentReplay = imageLookup ?? previousImageLookup;
  effectMaskResolverForCurrentReplay = effectMaskResolver ?? previousEffectMaskResolver;
  imagePolicyForCurrentReplay = imagePolicy ?? previousImagePolicy;
  try {
    for (const item of ir) {
      if (
        replayItemOnIsolatedSurface(
          target,
          item,
          imageLookupForCurrentReplay ?? undefined,
          effectMaskResolverForCurrentReplay ?? undefined,
          imagePolicyForCurrentReplay ?? undefined,
          colorOptions,
        )
      ) {
        continue;
      }
      target.save();
      try {
        // Apply item-level transform
        target.transform(
          item.transform[0],
          item.transform[1],
          item.transform[2],
          item.transform[3],
          item.transform[4],
          item.transform[5],
        );

        // ── Item-level opacity and blend ─────────────────────────────
        const itemAlpha = item.opacity ?? 1;
        if (itemAlpha < 1) {
          target.globalAlpha = itemAlpha;
        }
        const itemBlend =
          item.blendMode && item.blendMode !== 'normal'
            ? mapBlendMode(item.blendMode)
            : 'source-over';
        if (itemBlend !== 'source-over') {
          target.globalCompositeOperation = itemBlend;
        }

        // ── Filters pass (nondestructive adjustments) ──────────────────
        // CSS-compatible filters with opacity=1 and blendMode=normal are applied
        // via ctx.filter for GPU-accelerated rendering of fills + strokes.
        // Non-CSS filters and filters requiring per-filter opacity/blendMode
        // are handled after rendering via offscreen canvas compositing.
        // Determine if any filter requires post-render offscreen compositing:
        // - Filters with non-normal blend mode
        // - Filters with opacity < 1
        // - Filters without a CSS equivalent (curves, levels, selectiveColor, etc.)
        const needsPostRenderFilters = item.filters?.some(
          (f) =>
            !f.blendMode || f.blendMode !== 'normal' || (f.opacity ?? 1) < 1 || !filterToCss(f),
        );
        if (item.filters && item.filters.length > 0) {
          if (needsPostRenderFilters) {
            // Simple CSS filters are applied before fills for GPU rendering.
            // Complex filters are deferred to post-render compositing.
            const simpleFilters = item.filters.filter(
              (f) => f.blendMode === 'normal' && (f.opacity ?? 1) >= 1,
            );
            const simpleCss = filterChainToCss(simpleFilters);
            if (simpleCss) target.filter = simpleCss;
          } else {
            applyFilterChain(target, item.filters);
          }
        }

        // Collect content effects that need to be applied to the rendered shape
        // (layerBlur, chromaticAberration, glitch) in the order they are listed.
        const contentEffects =
          item.effects?.filter(
            (
              e,
            ): e is LayerBlurEffect | DepthBlurEffect | ChromaticAberrationEffect | GlitchEffect =>
              e.visible &&
              (e.type === 'layerBlur' ||
                e.type === 'depthBlur' ||
                e.type === 'chromaticAberration' ||
                e.type === 'glitch'),
          ) ?? [];

        // ── Backdrop-based effects (before fills — captures true backdrop) ───
        // Both backgroundBlur and glassMaterial render the backdrop behind the item.
        // glassMaterial additionally applies tint, saturation, brightness, and noise.
        if (item.effects) {
          for (const effect of item.effects) {
            if (!effect.visible) continue;
            if (effect.type === 'backgroundBlur') {
              paintBackgroundBlur(target, item, effect);
            } else if (effect.type === 'glassMaterial') {
              paintGlassMaterial(target, item, effect);
            }
          }
        }

        // ── Fills + strokes pass (offscreen when content effects present) ───
        if (contentEffects.length > 0) {
          const bounds = primitiveBounds(item.primitive);
          if (bounds.w > 0 && bounds.h > 0) {
            const padding = contentEffectPadding(contentEffects);
            const surfaceWidth = Math.max(1, Math.ceil(bounds.w + padding * 2));
            const surfaceHeight = Math.max(1, Math.ceil(bounds.h + padding * 2));
            const cc = new CompositeCanvas({
              width: surfaceWidth,
              height: surfaceHeight,
              devicePixelRatio: 1,
            });
            cc.ctx.translate(-bounds.x + padding, -bounds.y + padding);
            paintFillsAndStrokes(cc.ctx as unknown as ReplayTarget, item, itemAlpha, itemBlend);

            for (const effect of contentEffects) {
              const input = cc.getImageData(0, 0, cc.width, cc.height);
              if (effect.type === 'layerBlur') {
                cc.applyBlur(Math.max(0, effect.radius));
              } else if (effect.type === 'depthBlur') {
                if (effect.depthMap) {
                  try {
                    const depthMap = resizeDepthMap(
                      deserializeDepthMap(effect.depthMap),
                      cc.width,
                      cc.height,
                    );
                    const blurred = applyDepthBlur(input, depthMap, {
                      blurAmount: effect.blurStrength,
                      focalDepth: effect.focusDepth,
                      transitionRange: effect.focusRange * Math.max(0, effect.falloff),
                      invert: effect.invert,
                      edgeProtection: effect.edgeProtection,
                    });
                    cc.putImageData(blurred, 0, 0);
                  } catch {
                    // A missing/corrupt persisted resource must not blank the
                    // document; keeping the input is the safe render fallback.
                  }
                }
              } else if (effect.type === 'chromaticAberration') {
                applyChromaticAberration(cc, cc.width, cc.height, effect);
              } else if (effect.type === 'glitch') {
                applyGlitch(cc, cc.width, cc.height, effect);
              }
              applyRasterEffectMask(
                cc,
                input,
                effect,
                item,
                effectMaskResolverForCurrentReplay ?? undefined,
              );
            }

            target.save();
            target.globalAlpha = 1;
            target.globalCompositeOperation = itemBlend;
            target.drawImage?.(
              cc.canvas as unknown as CanvasImageSource,
              bounds.x - padding,
              bounds.y - padding,
              surfaceWidth,
              surfaceHeight,
            );
            target.restore();
          }
        } else {
          paintFillsAndStrokes(target, item, itemAlpha, itemBlend);
        }

        // ── Effects pass (per-effect save/restore compositing) ────────
        if (item.effects && item.effects.length > 0) {
          for (const effect of item.effects) {
            if (!effect.visible) continue;
            if (
              effect.type === 'layerBlur' ||
              effect.type === 'depthBlur' ||
              effect.type === 'backgroundBlur' ||
              effect.type === 'chromaticAberration' ||
              effect.type === 'glitch'
            )
              continue;
            if (effect.type === 'glassMaterial') continue; // backdrop handled before fills
            if (effect.type === 'dropShadow') {
              // Alpha-aware shadow: derive the shadow silhouette from the
              // item's rendered alpha (image fills, background-removal masks,
              // text glyphs, stroke-only objects) instead of the geometric
              // outline. This makes transparent PNGs cast shadows that follow
              // their visible shape, not their bounding rectangle.
              if (itemNeedsAlphaShadow(item)) {
                paintAlphaAwareDropShadow(target, item, effect, shadowOps);
              } else {
                paintGeometricDropShadow(target, item, effect, shadowOps);
              }
            } else if (effect.type === 'innerShadow') {
              if (itemNeedsAlphaShadow(item)) {
                paintAlphaAwareInsetEffect(target, item, effect, 'shadow', shadowOps);
              } else {
                paintInsetEffect(target, item, effect, 'shadow');
              }
            } else if (effect.type === 'outerGlow') {
              // Outer glow: render a blurred colored shape behind the item (no offset)
              if (itemNeedsAlphaShadow(item)) {
                paintAlphaAwareDropShadow(target, item, { ...effect, x: 0, y: 0 }, shadowOps);
              } else {
                paintGeometricDropShadow(target, item, { ...effect, x: 0, y: 0 }, shadowOps);
              }
            } else if (effect.type === 'innerGlow') {
              if (itemNeedsAlphaShadow(item)) {
                paintAlphaAwareInsetEffect(target, item, effect, 'glow', shadowOps);
              } else {
                paintInsetEffect(target, item, effect, 'glow');
              }
            }
          }
        }

        // ── Glass material edge highlight (after fills, before filters) ──
        if (item.effects) {
          for (const effect of item.effects) {
            if (effect.visible && effect.type === 'glassMaterial' && effect.edgeHighlight) {
              paintGlassMaterialEdgeHighlight(target, item, effect);
            }
          }
        }

        // ── Post-render filter compositing ────────────────────────────
        // Apply complex filters (non-CSS, or requiring per-filter opacity/blend)
        // via offscreen canvas compositing on the fully rendered item.
        if (needsPostRenderFilters && item.filters && item.filters.length > 0) {
          const complexFilters = item.filters.filter(
            (f) => f.blendMode !== 'normal' || (f.opacity ?? 1) < 1 || !filterToCss(f),
          );
          if (complexFilters.length > 0) {
            const targetCanvas = target as unknown as CanvasRenderingContext2D;
            // Adjustment layers reach the IR as zero-geometry items whose
            // filters composite over the whole surface. The current transform
            // maps doc units to device pixels (camera + floating origin), so
            // it is the correct coordSpace for zoom-stable effect parameters
            // (dither cells, split offsets, bloom radii). On nested surfaces
            // the transform is identity and parameters interpret in the
            // surface's own pixel space, which is self-consistent.
            let coordSpace:
              | {
                  scale: number;
                  originX: number;
                  originY: number;
                  regionX: number;
                  regionY: number;
                }
              | undefined;
            try {
              const cam = targetCanvas.getTransform();
              coordSpace = {
                scale: Math.abs(cam.a) || 1,
                originX: cam.e,
                originY: cam.f,
                regionX: 0,
                regionY: 0,
              };
            } catch {
              coordSpace = undefined;
            }
            applyFilterWithCompositing(
              targetCanvas,
              complexFilters,
              targetCanvas.canvas?.width ?? 100,
              targetCanvas.canvas?.height ?? 100,
              { coordSpace },
            );
          }
        }

        // Reset per-item state (shadow, filter, etc.)
        target.shadowColor = 'transparent';
        target.shadowBlur = 0;
        target.shadowOffsetX = 0;
        target.shadowOffsetY = 0;
        target.filter = 'none';
        target.globalAlpha = 1;
        target.globalCompositeOperation = 'source-over';
      } finally {
        // Canvas state is stack-based. A failed image/filter/effect must not
        // poison every later item or the caller's camera transform.
        target.restore();
      }
    }
  } finally {
    imageLookupForCurrentReplay = previousImageLookup;
    effectMaskResolverForCurrentReplay = previousEffectMaskResolver;
    imagePolicyForCurrentReplay = previousImagePolicy;
  }
}

/** Paint a single fill (solid, gradient, image, or pattern) over the primitive shape. */
function paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void {
  if (fill.type === 'solid') {
    target.fillStyle = rgba(fill.color);
    paintShapeFill(target, item);
  } else if (fill.type === 'gradient') {
    const tilingMode = fill.tilingMode;
    if (tilingMode && tilingMode !== 'none') {
      paintTiledGradientFill(target, fill, item, tilingMode as 'repeat' | 'reflect');
    } else {
      target.fillStyle = createGradientStyle(target, fill, item);
      paintShapeFill(target, item);
    }
  } else if (fill.type === 'image') {
    target.save();
    try {
      target.beginPath();
      traceOutline(target, item.primitive);
      target.clip();
      paintImageFill(target, fill, item);
    } finally {
      target.restore();
    }
  } else if (fill.type === 'pattern') {
    target.save();
    try {
      target.beginPath();
      traceOutline(target, item.primitive);
      target.clip();
      paintPatternFill(target, fill, item);
    } finally {
      target.restore();
    }
  }
}

/** Paint an image fill over the primitive bounds. */
function paintImageFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'image' }>,
  item: RenderItem,
): void {
  const bounds = primitiveBounds(item.primitive);
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;

  const image = resolveReplayImage(
    fill.src,
    imageLookupForCurrentReplay,
    getImageCache(),
    fill.frame,
    {
      ...imagePolicyForCurrentReplay,
      sourceWidth: fill.imageWidth,
      sourceHeight: fill.imageHeight,
    },
  );

  if (!target.drawImage) {
    target.fillRect(bounds.x, bounds.y, bw, bh);
    return;
  }

  if (!image) {
    const prev = target.fillStyle;
    target.fillStyle = imagePlaceholderFill(fill.src);
    target.fillRect(bounds.x, bounds.y, bw, bh);
    target.fillStyle = prev;
    return;
  }

  const sizedImage = image as CanvasImageSource & {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const fullSourceWidth = fill.imageWidth || sizedImage.naturalWidth || sizedImage.width || bw;
  const fullSourceHeight = fill.imageHeight || sizedImage.naturalHeight || sizedImage.height || bh;
  const actualSourceWidth = sizedImage.naturalWidth || sizedImage.width || fullSourceWidth;
  const actualSourceHeight = sizedImage.naturalHeight || sizedImage.height || fullSourceHeight;
  const sourceScale = {
    x: actualSourceWidth / Math.max(1, fullSourceWidth),
    y: actualSourceHeight / Math.max(1, fullSourceHeight),
  };

  const placement = computeImagePlacement({
    fit: fill.fit ?? 'fill',
    sourceWidth: fullSourceWidth,
    sourceHeight: fullSourceHeight,
    bounds,
    x: fill.x ?? 0,
    y: fill.y ?? 0,
    scale: fill.scale ?? 1,
    sourceCrop: fill.crop,
    rotation: fill.rotation,
    flipH: fill.flipH,
    flipV: fill.flipV,
  });
  if (!placement) return;
  const { x: dx, y: dy, w: dw, h: dh } = placement.drawRect;

  if (placement.fit === 'tile') {
    for (let ty = dy; ty < bounds.y + bh; ty += dh) {
      for (let tx = dx; tx < bounds.x + bw; tx += dw) {
        const tileRect = { x: tx, y: ty, w: dw, h: dh };
        const sampleRect = offsetSampleRect(placement, tileRect);
        drawPlacedImageSample(target, image, placement, tileRect, sampleRect, sourceScale);
      }
    }
    return;
  }

  // Apply alpha mask via offscreen compositing (background removal on shape nodes).
  // Worker capability checks reject these scenes because workers have no DOM canvas.
  if (fill.alphaMask && typeof document !== 'undefined') {
    const maskImg = getImageCache().getImage(fill.alphaMask);
    // Trigger async load for mask if not yet cached (mirrors base image load pattern)
    if (!maskImg) {
      const maskEntry = getImageCache().get(fill.alphaMask);
      if (!maskEntry || maskEntry.state === 'idle') {
        getImageCache()
          .load(fill.alphaMask)
          .catch(() => {
            /* errors recorded in cache entry */
          });
      }
    }
    if (maskImg) {
      try {
        const masked = renderMaskedImageSample(
          image,
          maskImg,
          placement,
          bounds,
          fill.src,
          fill.alphaMask,
          sourceScale,
        );
        if (masked) {
          target.drawImage(masked, bounds.x, bounds.y, bounds.w, bounds.h);
        } else {
          drawPlacedImageSample(
            target,
            image,
            placement,
            placement.drawRect,
            placement.sampleDrawRect,
            sourceScale,
          );
        }
      } catch {
        drawPlacedImageSample(
          target,
          image,
          placement,
          placement.drawRect,
          placement.sampleDrawRect,
        );
      }
    } else {
      drawPlacedImageSample(
        target,
        image,
        placement,
        placement.drawRect,
        placement.sampleDrawRect,
        sourceScale,
      );
    }
  } else {
    drawPlacedImageSample(
      target,
      image,
      placement,
      placement.drawRect,
      placement.sampleDrawRect,
      sourceScale,
    );
  }
}

function offsetSampleRect(
  placement: ImagePlacement,
  drawRect: ImagePlacementRect,
): ImagePlacementRect {
  return {
    x: placement.sampleDrawRect.x + drawRect.x - placement.drawRect.x,
    y: placement.sampleDrawRect.y + drawRect.y - placement.drawRect.y,
    w: placement.sampleDrawRect.w,
    h: placement.sampleDrawRect.h,
  };
}

function drawPlacedImageSample(
  target: ReplayTarget,
  image: CanvasImageSource,
  placement: ImagePlacement,
  drawRect: ImagePlacementRect,
  sampleDrawRect: ImagePlacementRect,
  sourceScale = { x: 1, y: 1 },
): void {
  const { x, y, w, h } = placement.sourceRect;
  const sx = x * sourceScale.x;
  const sy = y * sourceScale.y;
  const sw = w * sourceScale.x;
  const sh = h * sourceScale.y;
  const hasTransform = placement.rotation !== 0 || placement.flipH || placement.flipV;
  if (!hasTransform) {
    target.drawImage?.(
      image,
      sx,
      sy,
      sw,
      sh,
      sampleDrawRect.x,
      sampleDrawRect.y,
      sampleDrawRect.w,
      sampleDrawRect.h,
    );
    return;
  }
  const cx = drawRect.x + drawRect.w / 2;
  const cy = drawRect.y + drawRect.h / 2;
  target.save();
  applyImageTransform(target, cx, cy, placement.rotation, placement.flipH, placement.flipV);
  target.drawImage?.(
    image,
    sx,
    sy,
    sw,
    sh,
    sampleDrawRect.x - cx,
    sampleDrawRect.y - cy,
    sampleDrawRect.w,
    sampleDrawRect.h,
  );
  target.restore();
}

const MASK_CACHE_MAX_ENTRIES = 24;
const MASK_CACHE_MAX_PIXELS = 16_777_216;
const maskedImageCache = new Map<string, HTMLCanvasElement>();
const maskedImageSourceIds = new WeakMap<object, number>();
let maskedImageCachePixels = 0;
let nextMaskedImageSourceId = 1;

function maskedImageSourceId(source: CanvasImageSource): number {
  const object = source as unknown as object;
  const existing = maskedImageSourceIds.get(object);
  if (existing !== undefined) return existing;
  const id = nextMaskedImageSourceId++;
  maskedImageSourceIds.set(object, id);
  return id;
}

function renderMaskedImageSample(
  image: CanvasImageSource,
  mask: CanvasImageSource,
  placement: ImagePlacement,
  bounds: ImagePlacementRect,
  imageKey: string,
  maskKey: string,
  sourceScale = { x: 1, y: 1 },
): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const width = Math.max(1, Math.ceil(bounds.w));
  const height = Math.max(1, Math.ceil(bounds.h));
  const pixels = width * height;
  if (
    !Number.isSafeInteger(pixels) ||
    pixels > MASK_CACHE_MAX_PIXELS ||
    width > 8192 ||
    height > 8192
  ) {
    return null;
  }
  const key = [
    imageKey,
    maskKey,
    maskedImageSourceId(image),
    maskedImageSourceId(mask),
    width,
    height,
    placement.drawRect.x - bounds.x,
    placement.drawRect.y - bounds.y,
    placement.drawRect.w,
    placement.drawRect.h,
    placement.sourceRect.x,
    placement.sourceRect.y,
    placement.sourceRect.w,
    placement.sourceRect.h,
    sourceScale.x,
    sourceScale.y,
    placement.rotation,
    placement.flipH,
    placement.flipV,
  ].join('|');
  const cached = maskedImageCache.get(key);
  if (cached) {
    maskedImageCache.delete(key);
    maskedImageCache.set(key, cached);
    return cached;
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.translate(-bounds.x, -bounds.y);
  drawPlacedImageSample(
    context as unknown as ReplayTarget,
    image,
    placement,
    placement.drawRect,
    placement.sampleDrawRect,
    sourceScale,
  );
  context.globalCompositeOperation = 'destination-in';
  drawPlacedImageSample(
    context as unknown as ReplayTarget,
    mask,
    placement,
    placement.drawRect,
    placement.sampleDrawRect,
  );

  maskedImageCache.set(key, canvas);
  maskedImageCachePixels += pixels;
  while (
    maskedImageCache.size > MASK_CACHE_MAX_ENTRIES ||
    maskedImageCachePixels > MASK_CACHE_MAX_PIXELS
  ) {
    const oldest = maskedImageCache.entries().next().value as
      | [string, HTMLCanvasElement]
      | undefined;
    if (!oldest) break;
    maskedImageCache.delete(oldest[0]);
    maskedImageCachePixels -= oldest[1].width * oldest[1].height;
  }
  return canvas;
}

/**
 * Apply rotation and flip transforms to the canvas context, centered at (cx, cy).
 * The caller is responsible for save/restore and must draw centered at origin
 * (i.e. drawImage with dest rect centered at 0,0).
 */
function applyImageTransform(
  ctx: ReplayTarget,
  cx: number,
  cy: number,
  rotationDeg: number,
  flipH?: boolean,
  flipV?: boolean,
): void {
  ctx.translate(cx, cy);
  if (Math.abs(((rotationDeg % 360) + 360) % 360) > 0.001) {
    ctx.rotate((rotationDeg * Math.PI) / 180);
  }
  const scaleX = flipH ? -1 : 1;
  const scaleY = flipV ? -1 : 1;
  if (scaleX !== 1 || scaleY !== 1) {
    ctx.scale(scaleX, scaleY);
  }
}

/** Paint a pattern (tiled) fill over the primitive bounds. */
function paintPatternFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'pattern' }>,
  item: RenderItem,
): void {
  const bounds = primitiveBounds(item.primitive);
  const bw = bounds.w || 1;
  const bh = bounds.h || 1;

  const cache = getImageCache();
  const tileEntry = cache.get(fill.tileSrc);
  if (fill.tileSrc && (!tileEntry || tileEntry.state === 'idle')) {
    cache.load(fill.tileSrc).catch(() => {
      /* errors recorded in cache entry */
    });
  }
  if (tileEntry?.state === 'loaded' && tileEntry.image) {
    const tileImage = tileEntry.image as HTMLImageElement;
    const imageWidth = fill.imageWidth ?? tileImage.naturalWidth;
    const imageHeight = fill.imageHeight ?? tileImage.naturalHeight;
    const spacing = Number.isFinite(fill.spacing) ? fill.spacing : Number.NaN;
    const stepX = imageWidth + spacing;
    const stepY = imageHeight + spacing;
    if (
      !Number.isFinite(imageWidth) ||
      !Number.isFinite(imageHeight) ||
      imageWidth <= 0 ||
      imageHeight <= 0 ||
      !Number.isFinite(stepX) ||
      !Number.isFinite(stepY) ||
      stepX < 1 ||
      stepY < 1
    ) {
      paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
      return;
    }

    const radians = Number.isFinite(fill.rotation) ? (fill.rotation * Math.PI) / 180 : 0;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const centerX = bounds.x + bw / 2;
    const centerY = bounds.y + bh / 2;

    // A zero-spacing tile maps directly to CanvasPattern. Pattern transforms
    // preserve the bounds-relative origin while rotating about the object center.
    if (spacing === 0 && target.createPattern) {
      const pattern = target.createPattern(tileEntry.image, 'repeat');
      if (pattern && typeof pattern.setTransform === 'function') {
        try {
          pattern.setTransform({
            a: cosine,
            b: sine,
            c: -sine,
            d: cosine,
            e: centerX - cosine * (bw / 2) + sine * (bh / 2),
            f: centerY - sine * (bw / 2) - cosine * (bh / 2),
          });
          target.fillStyle = pattern as unknown as CanvasPattern;
          target.fillRect(bounds.x, bounds.y, bw, bh);
          return;
        } catch {
          // Older targets may expose createPattern without transform support.
          // The explicit draw loop below preserves the same visual semantics.
        }
      }
    }

    if (!target.drawImage) {
      paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
      return;
    }

    let minX = bounds.x;
    let minY = bounds.y;
    let maxX = bounds.x + bw;
    let maxY = bounds.y + bh;
    if (radians !== 0) {
      target.transform(
        cosine,
        sine,
        -sine,
        cosine,
        centerX - cosine * centerX + sine * centerY,
        centerY - sine * centerX - cosine * centerY,
      );
      const inverseCorners = [
        [bounds.x, bounds.y],
        [bounds.x + bw, bounds.y],
        [bounds.x + bw, bounds.y + bh],
        [bounds.x, bounds.y + bh],
      ].map(([x, y]) => {
        const dx = (x ?? 0) - centerX;
        const dy = (y ?? 0) - centerY;
        return [centerX + cosine * dx + sine * dy, centerY - sine * dx + cosine * dy];
      });
      minX = Math.min(...inverseCorners.map(([x]) => x ?? bounds.x));
      minY = Math.min(...inverseCorners.map(([, y]) => y ?? bounds.y));
      maxX = Math.max(...inverseCorners.map(([x]) => x ?? bounds.x + bw));
      maxY = Math.max(...inverseCorners.map(([, y]) => y ?? bounds.y + bh));
    }

    const startX = bounds.x + Math.floor((minX - bounds.x) / stepX) * stepX;
    const startY = bounds.y + Math.floor((minY - bounds.y) / stepY) * stepY;
    for (let ty = startY; ty < maxY; ty += stepY) {
      for (let tx = startX; tx < maxX; tx += stepX) {
        target.drawImage(tileEntry.image, tx, ty, imageWidth, imageHeight);
      }
    }
  } else {
    paintPatternFallback(target, bounds.x, bounds.y, bw, bh);
  }
}

function paintPatternFallback(
  target: ReplayTarget,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  target.fillStyle = 'rgba(200,200,200,0.5)';
  target.fillRect(x, y, width, height);
}

/** Expand gradient stops for canvas API using perceptually uniform interpolation. */
function expandGradientStopsForFill(
  fill: Extract<FillIR, { type: 'gradient' }>,
): { position: number; color: EngineColor }[] {
  // Missing metadata is a legacy gradient, whose original Canvas2D behavior
  // was encoded-sRGB. New gradients carry an explicit resolved space.
  const space = fill.interpolationSpace ?? 'srgb';
  if (space === 'srgb') {
    return fill.stops.map((s) => ({ position: s.position, color: s.color }));
  }
  const inputs = fill.stops.map((s) => {
    const [r, g, b, a] = managedColorToNormalized(s.color);
    return {
      position: s.position,
      color: { space: 'rgb' as const, r: r * 255, g: g * 255, b: b * 255, a: a * 255 },
      ...(s.midpoint !== undefined ? { midpoint: s.midpoint } : {}),
    };
  });
  return expandGradientStops(inputs, space, 16, {
    precision: 'working',
    hueInterpolation: fill.hueInterpolation ?? 'shorter',
  }).map((s) => ({
    position: s.position,
    color: s.color as EngineColor,
  }));
}

// ── Backdrop blur cache ──────────────────────────────────────────────

interface BackdropCacheEntry {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  lastAccess: number;
}

const backdropCache = new Map<string, BackdropCacheEntry>();
const BACKDROP_CACHE_MAX = 20;
const BACKDROP_CACHE_TTL = 500;

function backdropCacheKey(
  lx: number,
  ly: number,
  lw: number,
  lh: number,
  canvasTransform: { a: number; b: number; c: number; d: number; e: number; f: number },
  itemTransform: readonly [number, number, number, number, number, number],
  radius: number,
): string {
  return `${lx.toFixed(1)},${ly.toFixed(1)},${lw.toFixed(1)},${lh.toFixed(1)}|${canvasTransform.a},${canvasTransform.b},${canvasTransform.c},${canvasTransform.d},${canvasTransform.e},${canvasTransform.f}|${itemTransform.join(',')}|r${radius}`;
}

function getBackdropCache(key: string): BackdropCacheEntry | undefined {
  const entry = backdropCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.lastAccess > BACKDROP_CACHE_TTL) {
    backdropCache.delete(key);
    return undefined;
  }
  entry.lastAccess = Date.now();
  return entry;
}

function setBackdropCache(key: string, canvas: HTMLCanvasElement | OffscreenCanvas): void {
  if (backdropCache.size >= BACKDROP_CACHE_MAX) {
    let oldestKey = '';
    let oldestTime = Infinity;
    for (const [k, v] of backdropCache) {
      if (v.lastAccess < oldestTime) {
        oldestTime = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey) backdropCache.delete(oldestKey);
  }
  backdropCache.set(key, { canvas, lastAccess: Date.now() });
}

/** Sweep expired backdrop cache entries. Called at the start of replayIr. */
function sweepBackdropCache(): void {
  const now = Date.now();
  for (const [key, entry] of backdropCache) {
    if (now - entry.lastAccess > BACKDROP_CACHE_TTL) {
      backdropCache.delete(key);
    }
  }
}

export function __clearBackdropCache(): void {
  backdropCache.clear();
}

export function __getBackdropCacheSize(): number {
  return backdropCache.size;
}

/** Module-level gradient cache: maps a hash of {fill, bounds} → CanvasGradient | string. */
const gradientCache = new FrameCache<string, CanvasGradient | string>();

/**
 * Test hook: drop all cached gradient objects. Deterministic tests that
 * compare draw-call sequences across replays need a clean cache so the
 * second pass re-constructs (and re-logs) gradient creation.
 */
export function resetGradientCacheForTest(): void {
  gradientCache.clear();
}

function gradientCacheKey(
  fill: Extract<FillIR, { type: 'gradient' }>,
  bounds: { x: number; y: number; w: number; h: number },
): string {
  const normalizedRotation = ((fill.rotation % 360) + 360) % 360;
  return `${fill.gradientType}|${fill.interpolationSpace ?? ''}|${fill.hueInterpolation ?? ''}|${normalizedRotation}|${fill.tilingMode ?? ''}|${JSON.stringify(fill.transform)}|${JSON.stringify(fill.stops)}|${bounds.x.toFixed(2)}|${bounds.y.toFixed(2)}|${bounds.w.toFixed(2)}|${bounds.h.toFixed(2)}`;
}

/** Create a gradient fillStyle from a FillIR gradient. */
function createGradientStyle(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'gradient' }>,
  item: RenderItem,
): CanvasGradient | string {
  const stops = fill.stops;
  if (stops.length === 0) return 'rgba(0,0,0,0)';

  const bounds = primitiveBounds(item.primitive);
  // Normalize rotation to [0, 360) so out-of-range values don't escape
  let rot = ((((fill.rotation % 360) + 360) % 360) * Math.PI) / 180;
  let cx = (bounds.x + bounds.w) / 2;
  let cy = (bounds.y + bounds.h) / 2;
  let halfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) / 2;

  // Degenerate shape with zero area — render as solid fill of last stop
  if (halfDiag <= 0) {
    const last = stops[stops.length - 1];
    return last ? rgba(last.color) : 'rgba(0,0,0,0)';
  }

  // When a fill transform matrix is provided, derive gradient parameters from it
  if (fill.transform) {
    const t = fill.transform;
    const du = t[0] * halfDiag; // unit u-axis x
    const dv = t[1] * halfDiag; // unit u-axis y
    cx = bounds.x + t[4]; // translate x
    cy = bounds.y + t[5]; // translate y
    rot = Math.atan2(dv, du); // rotation from u-axis
    halfDiag = Math.sqrt(du * du + dv * dv); // scale magnitude

    // Degenerate after transform — render as solid fill of last stop
    if (halfDiag <= 0) {
      const last = stops[stops.length - 1];
      return last ? rgba(last.color) : 'rgba(0,0,0,0)';
    }
  }

  // Gradient caching: check cache before computing
  const key = gradientCacheKey(fill, bounds);
  const cached = gradientCache.get(key);
  if (cached !== undefined) return cached;

  const dx = Math.cos(rot) * halfDiag;
  const dy = Math.sin(rot) * halfDiag;

  let result: CanvasGradient | string | undefined;

  if (fill.gradientType === 'radial' && target.createRadialGradient) {
    const grad = target.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgbaWorking(s.color));
    }
    result = grad;
  } else if (fill.gradientType === 'angular' && target.createConicGradient) {
    const grad = target.createConicGradient(rot, cx, cy);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgbaWorking(s.color));
    }
    result = grad;
  } else if (fill.gradientType === 'diamond' && target.createRadialGradient) {
    const grad = target.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgbaWorking(s.color));
    }
    result = grad;
  } else if (target.createLinearGradient) {
    const grad = target.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgbaWorking(s.color));
    }
    result = grad;
  } else {
    result = rgba(stops[0]?.color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 });
  }

  gradientCache.set(key, result);
  return result;
}

/**
 * Trace a squircle (continuous-corner rect) path.
 * smoothing=0 → identical to roundRect; smoothing=1 → fully smooth iOS-style corners.
 *
 * Uses cubic bezier approximation: the arc endpoints are "pulled" further along
 * each straight edge by `r * s * 0.55`, while bezier handle length stays at
 * `r * 0.5523` (the standard circle-arc approximation constant). This produces
 * the characteristic wide, smooth corner that fills more of the bounding box.
 */
function traceSquirclePath(
  target: ReplayTarget,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number | [number, number, number, number],
  smoothing: number,
): void {
  const maxR = Math.min(w, h) / 2;
  let [tl, tr, br, bl] = (
    Array.isArray(cornerRadius)
      ? cornerRadius
      : [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
  ).map((v) => Math.max(0, Math.min(v, maxR))) as [number, number, number, number];

  // Clamp adjacent corners so they don't overlap on the same edge.
  // Each edge's two corners (extended by smoothing) must not exceed the edge length.
  const s = Math.max(0, Math.min(1, smoothing));
  const extFactor = 1 + s * 0.55;
  const clampPair = (a: number, b: number, edgeLen: number): [number, number] => {
    const extA = a * extFactor;
    const extB = b * extFactor;
    if (extA + extB <= edgeLen) return [a, b];
    const ratio = edgeLen / (extA + extB);
    return [a * ratio, b * ratio];
  };
  [tl, tr] = clampPair(tl, tr, w);
  [tr, br] = clampPair(tr, br, h);
  [br, bl] = clampPair(br, bl, w);
  [bl, tl] = clampPair(bl, tl, h);

  // How far from the corner vertex the straight edge ends (> r when s > 0).
  const ext = (r: number) => Math.min(r * extFactor, maxR);
  // Bezier handle length for the arc (circle-arc approximation constant × r).
  const hnd = (r: number) => r * 0.5523;

  target.beginPath();
  target.moveTo(x + ext(tl), y);
  // Top edge →
  target.lineTo(x + w - ext(tr), y);
  // Top-right corner
  target.bezierCurveTo(
    x + w - ext(tr) + hnd(tr),
    y,
    x + w,
    y + ext(tr) - hnd(tr),
    x + w,
    y + ext(tr),
  );
  // Right edge ↓
  target.lineTo(x + w, y + h - ext(br));
  // Bottom-right corner
  target.bezierCurveTo(
    x + w,
    y + h - ext(br) + hnd(br),
    x + w - ext(br) + hnd(br),
    y + h,
    x + w - ext(br),
    y + h,
  );
  // Bottom edge ←
  target.lineTo(x + ext(bl), y + h);
  // Bottom-left corner
  target.bezierCurveTo(
    x + ext(bl) - hnd(bl),
    y + h,
    x,
    y + h - ext(bl) + hnd(bl),
    x,
    y + h - ext(bl),
  );
  // Left edge ↑
  target.lineTo(x, y + ext(tl));
  // Top-left corner
  target.bezierCurveTo(x, y + ext(tl) - hnd(tl), x + ext(tl) - hnd(tl), y, x + ext(tl), y);
  target.closePath();
}

/** Paint a tiled (repeat/reflect) gradient fill using an offscreen canvas pattern. */
function paintTiledGradientFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'gradient' }>,
  item: RenderItem,
  tilingMode: 'repeat' | 'reflect',
): void {
  const bounds = primitiveBounds(item.primitive);
  if (bounds.w <= 0 || bounds.h <= 0) return;
  // Normalize rotation to [0, 360) so out-of-range values don't escape
  let rot = ((((fill.rotation % 360) + 360) % 360) * Math.PI) / 180;
  let cx = (bounds.x + bounds.w) / 2;
  let cy = (bounds.y + bounds.h) / 2;
  const halfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) / 2;
  if (fill.transform) {
    const t = fill.transform;
    const du = t[0] * halfDiag;
    const dv = t[1] * halfDiag;
    cx = bounds.x + t[4];
    cy = bounds.y + t[5];
    rot = Math.atan2(dv, du);
  }
  const dx = Math.cos(rot) * halfDiag;
  const dy = Math.sin(rot) * halfDiag;

  // Build expanded stops (perceptual interpolation)
  const expanded = expandGradientStopsForFill(fill);

  // Determine tile canvas size
  // For linear: tile is along gradient direction
  // For radial: tile is a square of 2*halfDiag

  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(Math.max(1, Math.ceil(bounds.w)), Math.max(1, Math.ceil(bounds.h)))
      : null;

  if (!canvas) {
    // Fallback: render gradient without tiling
    target.fillStyle = createGradientStyle(target, fill, item);
    paintShapeFill(target, item);
    return;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    target.fillStyle = createGradientStyle(target, fill, item);
    paintShapeFill(target, item);
    return;
  }

  if (fill.gradientType === 'radial' || fill.gradientType === 'diamond') {
    const tileSize = Math.ceil(halfDiag * 2);
    const tileCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(Math.max(1, tileSize), Math.max(1, tileSize))
        : null;
    if (!tileCanvas) {
      target.fillStyle = createGradientStyle(target, fill, item);
      paintShapeFill(target, item);
      return;
    }
    const tileCtx = tileCanvas.getContext('2d');
    if (!tileCtx) {
      target.fillStyle = createGradientStyle(target, fill, item);
      paintShapeFill(target, item);
      return;
    }
    const grad = tileCtx.createRadialGradient(
      tileSize / 2,
      tileSize / 2,
      0,
      tileSize / 2,
      tileSize / 2,
      tileSize / 2,
    );
    for (const s of expanded) {
      grad.addColorStop(s.position, rgbaWorking(s.color));
    }
    tileCtx.fillStyle = grad;
    tileCtx.fillRect(0, 0, tileSize, tileSize);
    if (tilingMode === 'reflect') {
      // Mirror the tile horizontally for reflect
      const doubleCanvas =
        typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tileSize * 2, tileSize) : null;
      if (doubleCanvas) {
        const dCtx = doubleCanvas.getContext('2d');
        if (dCtx) {
          // Draw forward tile
          dCtx.drawImage(tileCanvas, 0, 0);
          // Draw mirrored tile
          dCtx.save();
          dCtx.translate(tileSize * 2, 0);
          dCtx.scale(-1, 1);
          dCtx.drawImage(tileCanvas, 0, 0);
          dCtx.restore();
          if (target.createPattern) {
            const pattern = target.createPattern(
              doubleCanvas as unknown as CanvasImageSource,
              'repeat',
            );
            if (pattern) {
              target.fillStyle = pattern;
              paintShapeFill(target, item);
              return;
            }
          }
        }
      }
    }
    if (target.createPattern) {
      const pattern = target.createPattern(tileCanvas as unknown as CanvasImageSource, 'repeat');
      if (pattern) {
        target.fillStyle = pattern;
        paintShapeFill(target, item);
        return;
      }
    }
  }

  if (fill.gradientType === 'angular') {
    target.fillStyle = createGradientStyle(target, fill, item);
    paintShapeFill(target, item);
    return;
  }

  // Paint the gradient across the canvas
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const s of expanded) {
    grad.addColorStop(s.position, rgbaWorking(s.color));
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, bounds.w, bounds.h);

  if (tilingMode === 'reflect') {
    // Mirror tiles horizontally
    const finalCanvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(
            Math.max(1, Math.ceil(bounds.w * 2)),
            Math.max(1, Math.ceil(bounds.h)),
          )
        : null;
    if (finalCanvas) {
      const fCtx = finalCanvas.getContext('2d');
      if (fCtx) {
        fCtx.drawImage(canvas, 0, 0);
        fCtx.save();
        fCtx.translate(bounds.w * 2, 0);
        fCtx.scale(-1, 1);
        fCtx.drawImage(canvas, 0, 0);
        fCtx.restore();
        if (target.createPattern) {
          const pattern = target.createPattern(
            finalCanvas as unknown as CanvasImageSource,
            'repeat',
          );
          if (pattern) {
            target.fillStyle = pattern;
            paintShapeFill(target, item);
            return;
          }
        }
      }
    }
  }

  if (target.createPattern) {
    const pattern = target.createPattern(canvas as unknown as CanvasImageSource, 'repeat');
    if (pattern) {
      target.fillStyle = pattern;
    } else {
      target.fillStyle = createGradientStyle(target, fill, item);
    }
  } else {
    target.fillStyle = createGradientStyle(target, fill, item);
  }
  paintShapeFill(target, item);
}

/**
 * Paint a compiled native table (ADR-0016 D3): cell fills, per-cell text
 * (pre-wrapped lines), inner dividers, and the outer border, clipped to the
 * table bounds. Deterministic and font-measurement-free at render time.
 */
function paintTable(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'table' }>,
): void {
  if (p.w <= 0 || p.h <= 0) return;
  target.save();

  const traceTablePath = (): void => {
    const radius = Math.max(0, p.cornerRadius);
    if (radius > 0 && target.roundRect) {
      target.roundRect(p.x, p.y, p.w, p.h, radius);
    } else {
      target.rect(p.x, p.y, p.w, p.h);
    }
  };

  traceTablePath();
  target.clip();

  for (const cell of p.cells) {
    target.fillStyle = rgba(cell.fill);
    target.fillRect(cell.x, cell.y, cell.w, cell.h);
    if (cell.border && cell.border.width > 0) {
      target.strokeStyle = rgba(cell.border.color);
      target.lineWidth = cell.border.width;
      target.strokeRect(cell.x, cell.y, cell.w, cell.h);
    }
  }

  for (const cell of p.cells) {
    const t = cell.text;
    if (!t || t.lines.length === 0) continue;
    target.fillStyle = rgba(t.color);
    target.font = `${t.fontStyle} ${t.fontWeight} ${t.fontSize}px ${t.fontFamily}`;
    target.textBaseline = 'top';
    const pad = Math.max(0, t.padding);
    const lineH = t.fontSize * 1.35;
    const totalTextH = t.lines.length * lineH;
    let y = cell.y + pad;
    if (t.alignV === 'middle') y = cell.y + Math.max(pad, (cell.h - totalTextH) / 2);
    else if (t.alignV === 'bottom') y = cell.y + cell.h - pad - totalTextH;
    target.save();
    target.beginPath();
    target.rect(
      cell.x + pad,
      cell.y + pad,
      Math.max(0, cell.w - pad * 2),
      Math.max(0, cell.h - pad * 2),
    );
    target.clip();
    for (const line of t.lines) {
      if (t.alignH === 'center') {
        target.textAlign = 'center';
        target.fillText(line, cell.x + cell.w / 2, y);
      } else if (t.alignH === 'right') {
        target.textAlign = 'right';
        target.fillText(line, cell.x + cell.w - pad, y);
      } else {
        target.textAlign = 'left';
        target.fillText(line, cell.x + pad, y);
      }
      y += lineH;
    }
    target.restore();
  }

  // Rich scene content (images, components, groups) rendered inside the
  // cell, clipped to the padded cell rect. The item is already in
  // cell-local coordinates; translate the target to the cell origin.
  for (const cell of p.cells) {
    const content = cell.content;
    if (!content) continue;
    const pad = Math.max(0, cell.w > 0 && cell.h > 0 ? 0 : 0);
    target.save();
    try {
      target.translate(cell.x, cell.y);
      target.beginPath();
      target.rect(pad, pad, Math.max(0, cell.w - pad * 2), Math.max(0, cell.h - pad * 2));
      target.clip();
      replayIr(target, [content], imageLookupForCurrentReplay ?? undefined);
    } finally {
      target.restore();
    }
  }

  // Inner dividers sit at the shared track edges (collapse semantics).
  // Merged cells suppress the dividers that would otherwise cut through
  // them: a divider segment is skipped when a cell with a span covers it.
  if (p.dividerWidth > 0) {
    target.fillStyle = rgba(p.dividerColor);
    const half = p.dividerWidth / 2;
    const hasSpans = p.cells.some((c) => c.rowSpan > 1 || c.columnSpan > 1);
    if (!hasSpans) {
      // Fast path (no merged cells — the common case): draw every divider
      // full-length like the original implementation, one rect per track.
      for (let i = 1; i < p.colPositions.length - 1; i++) {
        const x = p.colPositions[i]!;
        target.fillRect(x - half, p.y, p.dividerWidth, p.h);
      }
      for (let i = 1; i < p.rowPositions.length - 1; i++) {
        const y = p.rowPositions[i]!;
        target.fillRect(p.x, y - half, p.w, p.dividerWidth);
      }
    } else {
      // Span path: precompute the covered divider segments ONCE (a cell with
      // a span suppresses the dividers running through it), then draw the
      // remaining segments. O(spans × area) up front, O(1) per segment.
      const colCovered = new Set<string>();
      const rowCovered = new Set<string>();
      for (const c of p.cells) {
        for (let rr = c.rowIdx; rr < c.rowIdx + c.rowSpan; rr++) {
          for (let cc = c.columnIdx + 1; cc < c.columnIdx + c.columnSpan; cc++) {
            colCovered.add(`${cc},${rr}`);
          }
        }
        for (let cc = c.columnIdx; cc < c.columnIdx + c.columnSpan; cc++) {
          for (let rr = c.rowIdx + 1; rr < c.rowIdx + c.rowSpan; rr++) {
            rowCovered.add(`${rr},${cc}`);
          }
        }
      }
      for (let i = 1; i < p.colPositions.length - 1; i++) {
        const x = p.colPositions[i]!;
        for (let r = 0; r < p.rowPositions.length - 1; r++) {
          if (colCovered.has(`${i},${r}`)) continue;
          const y0 = p.rowPositions[r]!;
          const y1 = p.rowPositions[r + 1]!;
          if (y1 <= y0) continue;
          target.fillRect(x - half, y0, p.dividerWidth, y1 - y0);
        }
      }
      for (let i = 1; i < p.rowPositions.length - 1; i++) {
        const y = p.rowPositions[i]!;
        for (let c = 0; c < p.colPositions.length - 1; c++) {
          if (rowCovered.has(`${i},${c}`)) continue;
          const x0 = p.colPositions[c]!;
          const x1 = p.colPositions[c + 1]!;
          if (x1 <= x0) continue;
          target.fillRect(x0, y - half, x1 - x0, p.dividerWidth);
        }
      }
    }
  }

  if (p.borderWidth > 0) {
    target.strokeStyle = rgba(p.borderColor);
    target.lineWidth = p.borderWidth;
    traceTablePath();
    target.stroke();
  }

  target.restore();
}

/** Render a raster layer by compositing its tiles onto an offscreen canvas. */
function paintRasterLayer(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'rasterLayer' }>,
): void {
  const { width, height, tiles } = p;
  if (width <= 0 || height <= 0) return;

  // Measurement is opt-in: with no sink installed the timing calls below are
  // skipped entirely and this path keeps its original shape.
  const measured = isRasterReplayMeasured();
  const startedAt = measured ? performance.now() : 0;

  const TILE = 128;
  const cache = getRasterLayerCache();
  // A stable identity for the layer. `layerId` is set by the IR builder where
  // available; without one the cache is bypassed entirely rather than risking
  // two different layers sharing a surface.
  const layerKey = (p as { layerId?: string }).layerId ?? null;

  // Spatial tiled-pyramid path (ADR-0214 D5): engages only when enabled and
  // the crossover says visible-tile drawing is cheaper (large layer, low
  // effective scale, low viewport coverage). Falls back to the retained
  // surface when nothing is resident, so correctness never depends on it.
  if (layerKey && isRasterPyramidEnabled() && target.getTransform) {
    const m = target.getTransform();
    if (m) {
      const scale = effectiveScaleFromTransform(m);
      const viewport = getPyramidViewport();
      const decision = decideRasterStrategy({
        width,
        height,
        scale,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        enabled: true,
      });
      if (decision.kind === 'pyramid') {
        const source: PyramidLayerSource = {
          layerId: layerKey,
          width,
          height,
          pixelMode: (p as { pixelMode?: boolean }).pixelMode ?? false,
          tiles,
        };
        registerPyramidSource(source);
        const rect = layerVisibleRect(m, viewport.width, viewport.height);
        const lodStartedAt = measured ? performance.now() : 0;
        const result = drawRasterLayerLod(
          target,
          source,
          getPyramidResidency(),
          decision.level,
          rect,
        );
        if (result.drawnTiles > 0) {
          if (measured) {
            const endedAt = performance.now();
            emitRasterReplaySample({
              width,
              height,
              totalTiles: Object.keys(tiles).length,
              compositedTiles: result.drawnTiles,
              intermediateBytes: 0,
              surfaceMs: 0,
              tileReplayMs: 0,
              drawMs: 0,
              totalMs: endedAt - lodStartedAt,
            });
          }
          return;
        }
        // Nothing resident yet: fall through to the retained path (the
        // scheduler is generating the visible tiles).
      }
    }
  }

  let surfaceCanvas: CanvasImageSource | null = null;
  let compositedTiles = 0;
  let surfaceEndedAt = 0;
  let tilesEndedAt = 0;

  const acquired = layerKey ? cache.acquire(layerKey, width, height, tiles, TILE) : null;
  if (acquired) {
    // Dirty-tile path: only tiles whose version changed were re-uploaded.
    // `putImageData` ignores transform/clip/alpha/blend, and tile writes never
    // overlap, so a partial upload is pixel-identical to a full one.
    surfaceEndedAt = measured ? performance.now() : 0;
    tilesEndedAt = surfaceEndedAt;
    compositedTiles = acquired.plan.changed.length;
    surfaceCanvas = acquired.surface.canvas as unknown as CanvasImageSource;
  } else {
    // Fallback: no layer identity, or no canvas backend. Rebuild in full,
    // exactly as before.
    const offscreen =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : typeof document !== 'undefined'
          ? document.createElement('canvas')
          : null;
    if (!offscreen) return;
    offscreen.width = width;
    offscreen.height = height;

    const ctx = offscreen.getContext('2d') as
      | (CanvasRenderingContext2D & OffscreenCanvasRenderingContext2D)
      | null;
    if (!ctx) return;
    surfaceEndedAt = measured ? performance.now() : 0;

    for (const [key, tile] of Object.entries(tiles)) {
      const [colStr, rowStr] = key.split(':');
      const col = Number(colStr);
      const row = Number(rowStr);
      if (!Number.isFinite(col) || !Number.isFinite(row)) continue;
      const pixels = new Uint8ClampedArray(tile.pixels);
      const imageData = ctx.createImageData(TILE, TILE);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, col * TILE, row * TILE);
      compositedTiles++;
    }
    tilesEndedAt = measured ? performance.now() : 0;
    surfaceCanvas = offscreen as unknown as CanvasImageSource;
  }

  // The composite step is unchanged on both paths: the finished surface is
  // drawn as one image, so transform, opacity, blend mode, masks and filters
  // continue to apply to the whole layer and no per-tile seams can appear.
  if (target.drawImage && surfaceCanvas) {
    target.drawImage(surfaceCanvas, 0, 0, width, height);
  }

  if (measured) {
    const endedAt = performance.now();
    emitRasterReplaySample({
      width,
      height,
      totalTiles: Object.keys(tiles).length,
      compositedTiles,
      intermediateBytes: width * height * 4,
      surfaceMs: surfaceEndedAt - startedAt,
      tileReplayMs: tilesEndedAt - surfaceEndedAt,
      drawMs: endedAt - tilesEndedAt,
      totalMs: endedAt - startedAt,
    });
  }
}

/** Paint the primitive shape fill (without fillStyle). */
function paintShapeFill(target: ReplayTarget, item: RenderItem): void {
  const p = item.primitive;
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && p.cornerSmoothing && p.cornerSmoothing > 0) {
        traceSquirclePath(target, p.x, p.y, p.w, p.h, p.cornerRadius, p.cornerSmoothing);
        target.fill();
      } else if (p.cornerRadius && target.roundRect) {
        target.beginPath();
        target.roundRect(p.x, p.y, p.w, p.h, p.cornerRadius);
        target.fill();
      } else {
        target.fillRect(p.x, p.y, p.w, p.h);
      }
      break;
    case 'ellipse':
      target.beginPath();
      target.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, TAU);
      target.fill();
      break;
    case 'circle':
      target.beginPath();
      target.arc(p.cx, p.cy, p.r, 0, TAU);
      target.fill();
      break;
    case 'line':
    case 'arrow':
      // Lines and arrows are stroke-only primitives; the fill pass intentionally
      // draws nothing here. The stroke pass renders the segment and arrowheads.
      break;
    case 'polygon': {
      target.beginPath();
      for (let i = 0; i < p.sides; i++) {
        const a = (2 * Math.PI * i) / p.sides - Math.PI / 2 + p.rotation;
        const px = p.cx + p.radius * Math.cos(a);
        const py = p.cy + p.radius * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
    case 'star': {
      target.beginPath();
      for (let i = 0; i < p.points * 2; i++) {
        const a = (Math.PI * i) / p.points - Math.PI / 2 + p.rotation;
        const r = i % 2 === 0 ? p.outerRadius : p.innerRadius;
        const px = p.cx + r * Math.cos(a);
        const py = p.cy + r * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
    case 'path':
      paintPathFill(target, p);
      break;
    case 'text':
      paintText(target, p);
      break;
    case 'table':
      paintTable(target, p);
      break;
    case 'rasterLayer':
      paintRasterLayer(target, p);
      break;
    case 'warpedImage':
      paintWarpedImage(target, p, (src) =>
        resolveReplayImage(src, imageLookupForCurrentReplay, getImageCache()),
      );
      break;
    default:
      break;
  }
}

/** Apply text case transform to a string. */
function applyTextCase(text: string, textCase: string): string {
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

/**
 * Auto-detect whether a text string is predominantly RTL.
 * Scans for the first strong directional character (UAX #9 P2/P3).
 * Returns true if the first strong char is Hebrew or Arabic.
 */
function detectRTL(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i) ?? 0;
    // Hebrew: U+0590–U+05FF, U+FB1D–U+FB4F
    if (code >= 0x0590 && code <= 0x05ff) return true;
    if (code >= 0xfb1d && code <= 0xfb4f) return true;
    // Arabic: U+0600–U+06FF, U+0750–U+077F, U+0870–U+08FF, U+FB50–U+FDFF, U+FE70–U+FEFF
    if (code >= 0x0600 && code <= 0x06ff) return true;
    if (code >= 0x0750 && code <= 0x077f) return true;
    if (code >= 0x0870 && code <= 0x08ff) return true;
    if (code >= 0xfb50 && code <= 0xfdff) return true;
    if (code >= 0xfe70 && code <= 0xfeff) return true;
    if (code >= 0x1ec70 && code <= 0x1ecbf) return true;
    if (code >= 0x1ee00 && code <= 0x1eeff) return true;
    // Strong LTR found first → not RTL
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f) ||
      (code >= 0x0370 && code <= 0x03ff) ||
      (code >= 0x0400 && code <= 0x04ff) ||
      (code >= 0x0900 && code <= 0x0d7f) ||
      (code >= 0x0e00 && code <= 0x0eff) ||
      (code >= 0x1000 && code <= 0x10ff) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0x3040 && code <= 0x30ff)
    ) {
      return false;
    }
    if (code > 0xffff) i++; // skip surrogate low
  }
  return false;
}

/** Paint rich text using the typography layout engine. */
function paintRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  if (target.measureText) {
    const richText = p.richText! as import('./types').RichText;
    const hasAdvancedParagraphFormatting = richText.paragraphs.some((paragraph) => {
      const format = paragraph.format;
      return format?.maxLines !== undefined || format?.textOverflow !== undefined;
    });
    if (!hasAdvancedParagraphFormatting) {
      const snapshot = layoutRichTextSnapshot(
        richText,
        {
          fontFamily: p.fontFamily,
          fontSize: p.fontSize,
          fontWeight: p.fontWeight,
          fontStyle: p.fontStyle,
          letterSpacing: p.letterSpacing,
          tracking: p.tracking ?? 0,
          direction: p.direction,
          language: p.language,
        },
        target as import('./richTextLayout').RichTextMeasureContext,
        { maxWidth: p.w, lineHeight: p.fontSize * p.lineHeight, language: p.language },
      );
      paintCanonicalRichText(target, p, richText, snapshot);
      return;
    }
  }
  const defaultFormat = {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    fontWeight: p.fontWeight,
    fontStyle: p.fontStyle,
    letterSpacing: p.letterSpacing,
    tracking: p.tracking ?? 0,
    lineHeight: p.lineHeight,
    textCase: p.textCase,
    textDecoration: p.textDecoration,
  };
  const positioned = layoutRichText(
    p.richText! as import('./textLayout').RichTextInput,
    p.w,
    defaultFormat,
  );

  let yOffset = 0;
  if (p.textAlignVertical === 'middle') yOffset = (p.h - positioned.height) / 2;
  else if (p.textAlignVertical === 'bottom') yOffset = p.h - positioned.height;

  const originalFillStyle = target.fillStyle;

  const richIsRTL = p.direction === 'rtl' || (p.direction !== 'ltr' && detectRTL(p.text));

  for (const line of positioned.lines) {
    const lineWidth = line.runs.reduce((sum, r) => sum + r.width, 0);
    let xOffset = 0;
    let wordSpacingAdjust = 0;
    if (p.textAlign === 'center') {
      xOffset = (p.w - lineWidth) / 2;
    } else if (p.textAlign === 'right' || (richIsRTL && p.textAlign === 'left')) {
      // RTL: align to the right edge so the browser's native BiDi reorder works.
      target.textAlign = 'right';
      xOffset = p.w - lineWidth;
    } else if (p.textAlign === 'justify') {
      // Justify: count inter-word gaps and distribute remaining space
      let totalGaps = 0;
      for (const run of line.runs) {
        const spaces = (run.text.match(/\s/g) || []).length;
        totalGaps += spaces;
      }
      if (totalGaps > 0 && lineWidth < p.w) {
        wordSpacingAdjust = (p.w - lineWidth) / totalGaps;
      }
    }

    for (const run of line.runs) {
      target.font = run.font;
      const runFormat = run.format;
      // Run color is ManagedColor since schema 2.14; legacy tuples still
      // render (clipboard fragments, external IR). rgba() handles both.
      if (runFormat?.color) {
        target.fillStyle = rgba(runFormat.color);
      }
      if (wordSpacingAdjust > 0 && /\s/.test(run.text)) {
        // Distribute extra space between words within this run
        const parts = run.text.split(/(\s+)/);
        let runX = p.x + run.x + xOffset;
        for (const part of parts) {
          if (part === '') continue;
          if (/^\s+$/.test(part)) {
            runX += measureTextAdvance(target, part) + wordSpacingAdjust;
          } else {
            target.fillText(part, runX, p.y + run.y + yOffset);
            runX += measureTextAdvance(target, part);
          }
        }
      } else {
        target.fillText(run.text, p.x + run.x + xOffset, p.y + run.y + yOffset);
      }

      if (
        run.format.textDecoration === 'underline' ||
        run.format.textDecoration === 'line-through'
      ) {
        const decoY =
          run.format.textDecoration === 'underline'
            ? p.y + run.y + yOffset + run.format.fontSize * 1.1
            : p.y + run.y + yOffset + run.format.fontSize * 0.5;
        target.beginPath();
        target.moveTo(p.x + run.x + xOffset, decoY);
        target.lineTo(p.x + run.x + xOffset + run.width, decoY);
        target.strokeStyle = target.fillStyle;
        target.lineWidth = 1;
        target.stroke();
      }

      target.fillStyle = originalFillStyle;
    }
  }
}

function richTextFormatAt(
  richText: import('./types').RichText,
  offset: number,
): import('./types').CharacterFormat {
  let cursor = 0;
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs) {
      if (offset >= cursor && offset < cursor + run.text.length) return run.format ?? {};
      cursor += run.text.length;
    }
    cursor += 1;
  }
  return {};
}

function paintCanonicalRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
  richText: import('./types').RichText,
  snapshot: TextLayoutSnapshot,
): void {
  const verticalOffset =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'left';
  target.textBaseline = 'alphabetic';
  for (const line of snapshot.lines) {
    const xOffset =
      p.textAlign === 'center'
        ? (p.w - line.width) / 2
        : p.textAlign === 'right'
          ? p.w - line.width
          : 0;
    for (const run of line.runs) {
      for (const glyph of run.glyphs) {
        const cluster = snapshot.text.slice(glyph.clusterUtf16, glyph.sourceEnd);
        if (cluster.length === 0 || cluster.includes('\n')) continue;
        const format = richTextFormatAt(richText, glyph.clusterUtf16);
        const style = (format.fontStyle ?? run.sourceRun.fontStyle) === 'italic' ? 'italic ' : '';
        const weight = format.fontWeight ?? run.sourceRun.fontWeight;
        const size = format.fontSize ?? run.sourceRun.fontSize;
        const family = format.fontFamily ?? run.sourceRun.fontFamily;
        target.font = `${style}${Math.max(1, Math.min(1000, weight))} ${size}px "${family}"`;
        if (format.color) target.fillStyle = rgba(format.color);
        const glyphX =
          run.direction === 'rtl'
            ? run.x + run.width - (glyph.x - run.x) - glyph.xAdvance
            : glyph.x;
        target.fillText(
          cluster,
          p.x + xOffset + glyphX + glyph.xOffset,
          p.y + verticalOffset + glyph.y,
        );
        target.fillStyle = originalFillStyle;
      }
    }
  }
}

type TextPrimitive = Extract<RenderItem['primitive'], { kind: 'text' }>;

function canUseCanonicalTextLayout(p: TextPrimitive): boolean {
  return (
    !p.richText &&
    p.textMode !== 'path' &&
    p.textCase === 'none' &&
    p.listStyle === 'none' &&
    p.textOverflow === 'visible' &&
    p.paragraphSpacing === 0 &&
    p.firstLineIndent === undefined &&
    !p.text.includes('\t') &&
    !p.glyphAdjustments &&
    !p.pairAdjustments &&
    p.kerningMode !== 'none'
  );
}

function canonicalTextSnapshot(target: ReplayTarget, p: TextPrimitive): TextLayoutSnapshot | null {
  if (!canUseCanonicalTextLayout(p)) return null;

  const maxWidth = p.textMode === 'area' ? p.w : 0;
  const shaping =
    p.shaping ??
    (() => {
      if (!target.measureText) return undefined;
      const direction = p.direction ?? 'auto';
      const language = p.language ?? '';
      // Do not cache browser measurement here: this layer has no font-face
      // revision token, and a late-loaded face must invalidate geometry.
      return shapeText(
        p.text,
        p.fontFamily,
        p.fontSize,
        target as unknown as CanvasRenderingContext2D,
        {
          // The canonical path shapes and then paints from `run.font`, so the
          // axis has to be folded in here too — patching only the fallback
          // painter left the common case unchanged.
          fontWeight: effectiveWeight(p),
          fontStyle: p.fontStyle,
          letterSpacing: p.letterSpacing,
          tracking: p.tracking,
          direction,
          language,
        },
      );
    })();

  if (!shaping) return null;
  return buildTextLayoutSnapshot(p.text, shaping, {
    maxWidth,
    lineHeight: p.fontSize * p.lineHeight,
    language: p.language,
  });
}

function paintCanonicalText(
  target: ReplayTarget,
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): void {
  const verticalOffset =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'left';
  target.textBaseline = 'alphabetic';

  for (const line of snapshot.lines) {
    const xOffset =
      p.textAlign === 'center'
        ? (p.w - line.width) / 2
        : p.textAlign === 'right'
          ? p.w - line.width
          : 0;
    for (const run of line.runs) {
      const style = run.sourceRun.fontStyle === 'italic' ? 'italic ' : '';
      // The shaped run carries the weight it was measured at. The axis has to
      // win here as well: shaping with the effective weight is not enough,
      // because this is where the font actually gets assigned before drawing.
      const weight =
        p.variableAxes?.wght != null
          ? effectiveWeight(p)
          : Math.max(1, Math.min(1000, run.sourceRun.fontWeight));
      target.font = `${style}${weight} ${run.sourceRun.fontSize}px "${run.sourceRun.fontFamily}"`;
      for (const glyph of run.glyphs) {
        const cluster = snapshot.text.slice(glyph.clusterUtf16, glyph.sourceEnd);
        if (cluster.length === 0 || cluster.includes('\n')) continue;
        const glyphX =
          run.direction === 'rtl'
            ? run.x + run.width - (glyph.x - run.x) - glyph.xAdvance
            : glyph.x;
        target.fillText(
          cluster,
          p.x + xOffset + glyphX + glyph.xOffset,
          p.y + verticalOffset + glyph.y,
        );
      }
    }
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const decoY =
        p.y +
        verticalOffset +
        line.baseline +
        (p.textDecoration === 'underline' ? p.fontSize * 0.3 : -p.fontSize * 0.3);
      target.beginPath();
      target.moveTo(p.x + xOffset, decoY);
      target.lineTo(p.x + xOffset + line.width, decoY);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }
  target.fillStyle = originalFillStyle;
}

/**
 * Paint text along a path (text-on-path).
 *
 * Uses the same canonical shaper as point text (shapeText) so that kerning,
 * ligatures, combining marks, BiDi visual order and tracking are all honoured
 * by the path layout. For multiline text, each paragraph is shaped separately
 * and laid on a successive parallel offset curve (stacked outward on the
 * glyph side).
 */
function paintPathText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  const settings = p.pathTextSettings;
  if (!settings) return;

  const shape = p.pathShape;
  if (!shape) return;

  const displayText = applyTextCase(p.text, p.textCase);
  const style = p.fontStyle === 'italic' ? 'italic ' : '';
  const fw = effectiveWeight(p);
  target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;
  target.textBaseline = 'alphabetic';
  target.textAlign = 'left';

  const paragraphs = displayText.split('\n');

  // Shape each paragraph through the canonical pipeline so shaping, kerning,
  // ligature and BiDi ordering match point text exactly. Each paragraph is
  // shaped independently so flattenShapedRuns slices by the correct local
  // clusterUtf16 indices.
  const lines: Array<Array<{ text: string; advance: number }>> = paragraphs.map((paragraph) => {
    if (paragraph.length === 0) return [];
    if (target.measureText) {
      const shaping = shapeText(
        paragraph,
        p.fontFamily,
        p.fontSize,
        target as unknown as CanvasRenderingContext2D,
        {
          fontWeight: fw,
          fontStyle: (p.fontStyle as 'normal' | 'italic' | undefined) ?? 'normal',
          letterSpacing: p.letterSpacing,
          tracking: p.tracking,
          direction: (p.direction as 'ltr' | 'rtl' | 'auto' | undefined) ?? 'auto',
          language: p.language,
        },
      );
      return flattenShapedRuns(shaping.runs, paragraph);
    }
    // No measureText (e.g. pure WASM stub): fall back to grapheme clusters
    // with an estimated advance so they at least stay attached to each other.
    return splitGraphemes(paragraph).map((ch) => ({
      text: ch,
      advance: p.fontSize * 0.6,
    }));
  });

  const lineHeightPx = p.fontSize * (p.lineHeight ?? 1.4);

  const placements = placeLinesOnPath(lines, shape, {
    offset: settings.startOffset ?? 0,
    endOffset: settings.endOffset,
    side: settings.side ?? 'top',
    baselineShift: settings.baselineShift,
    flip: settings.flip,
    lineHeightPx,
    fitToInterval: settings.fitToPath,
    reverse: settings.reverse,
  });

  const originalFillStyle = target.fillStyle;

  for (const glyph of placements) {
    target.save();
    target.transform(1, 0, 0, 1, glyph.x, glyph.y);
    const c = Math.cos(glyph.angle);
    const s = Math.sin(glyph.angle);
    target.transform(c, s, -s, c, 0, 0);
    target.fillText(glyph.char, 0, 0);
    target.restore();
  }

  target.fillStyle = originalFillStyle;
}

/**
 * Per-cluster text drawing for kerning-off and glyph-level wordmark editing.
 *
 * Each grapheme cluster is drawn as its own fillText call, which disables
 * cross-cluster pair kerning (the browser only applies kerning within a
 * single text run) while keeping intra-cluster shaping for combining marks.
 * Per-cluster transforms (dx/dy/rotation/scale) and advance overrides are
 * applied from the IR glyphAdjustments; pairAdjustments add extra space
 * between cluster i and cluster i+1 (affecting the next cluster's position).
 * Only used when the display line maps 1:1 onto the source text (no case
 * transform, list prefix, tabs, wrapping, or RTL), so cluster indices stay
 * globally stable.
 */
/** Exported for tests: per-cluster drawing with injected measure stub. */
export function drawClusters(
  target: ReplayTarget,
  line: string,
  x: number,
  y: number,
  letterSpacing: number,
  trackingAdvance: number,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
  measure: (text: string) => number = (text) => measureTextAdvance(target, text),
): void {
  const clusters = splitGraphemes(line);
  let cursorX = x;
  for (let ci = 0; ci < clusters.length; ci += 1) {
    const cluster = clusters[ci] as string;
    const adjustment = p.glyphAdjustments?.[ci];
    const advance = measure(cluster) + letterSpacing + trackingAdvance;
    if (
      adjustment &&
      (adjustment.dx !== 0 ||
        adjustment.dy !== 0 ||
        adjustment.rotation !== 0 ||
        adjustment.scaleX !== 1 ||
        adjustment.scaleY !== 1)
    ) {
      target.save();
      target.translate(cursorX + adjustment.dx, y + adjustment.dy);
      if (adjustment.rotation !== 0) target.rotate(adjustment.rotation);
      if (adjustment.scaleX !== 1 || adjustment.scaleY !== 1) {
        target.scale(adjustment.scaleX, adjustment.scaleY);
      }
      target.fillText(cluster, 0, 0);
      target.restore();
    } else {
      target.fillText(cluster, cursorX, y);
    }
    cursorX += advance + (adjustment?.advance ?? 0) + (p.pairAdjustments?.[ci] ?? 0);
  }
}

/**
 * Effective weight for a Canvas2D font string.
 *
 * A CanvasRenderingContext2D `font` is a CSS font shorthand, and the
 * shorthand has no slot for `font-variation-settings` — so the axis values
 * the inspector writes never reached the canvas, and dragging a weight axis
 * changed the document while the glyphs stayed exactly as they were. The
 * shorthand's weight *does* drive a variable font's `wght` axis, so folding
 * that axis into the weight slot is how this renderer honours it.
 *
 * Only `wght` can be expressed this way. Axes like `opsz`, `wdth` and `slnt`
 * have no shorthand equivalent and are still applied only where the outline
 * path runs (textOutlines.ts sets them on the parsed font), not in this
 * Canvas2D preview.
 */
function effectiveWeight(p: { fontWeight: number; variableAxes?: Record<string, number> }): number {
  const axis = p.variableAxes?.wght;
  const weight = typeof axis === 'number' && Number.isFinite(axis) ? axis : p.fontWeight;
  return Math.max(1, Math.min(1000, weight));
}

/** Paint a text primitive via Canvas2D `fillText` with full typography support. */
function paintText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  if (p.textMode === 'path' && p.pathTextSettings) {
    paintPathText(target, p);
    return;
  }
  if (p.richText) {
    paintRichText(target, p);
    return;
  }
  const snapshot = canonicalTextSnapshot(target, p);
  if (snapshot) {
    paintCanonicalText(target, p, snapshot);
    return;
  }

  const style = p.fontStyle === 'italic' ? 'italic ' : '';
  const fw = effectiveWeight(p);
  target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;

  // Text baseline from vertical alignment.
  // When textAlignVertical='bottom', use 'bottom' baseline so descenders
  // (g, j, p, q, y) stay inside the text box rather than extending below it.
  const baselineMap: Record<string, CanvasTextBaseline> = {
    top: 'top',
    middle: 'middle',
    bottom: 'bottom',
  };
  target.textBaseline = baselineMap[p.textAlignVertical] ?? 'top';

  // Determine paragraph direction: explicit override or auto-detect from content.
  // When RTL, set textAlign='right' so the browser's native BiDi engine reorders
  // runs within fillText(). Our shaped data (shapeRun) handles caret/hit-testing.
  const isRTL = p.direction === 'rtl' || (p.direction !== 'ltr' && detectRTL(p.text));
  target.textAlign = isRTL && p.textAlign === 'left' ? 'right' : (p.textAlign as CanvasTextAlign);

  // Apply text case transform
  const displayText = applyTextCase(p.text, p.textCase);

  const trackingAdvance = ((p.tracking ?? 0) * p.fontSize) / 1000;
  const measureLine = (value: string): number => {
    let width = 0;
    for (let index = 0; index < value.length; index++) {
      width += measureTextAdvance(target, value[index] ?? '');
      if (index < value.length - 1) width += p.letterSpacing + trackingAdvance;
    }
    return width;
  };

  const wrapLine = (value: string): string[] => {
    if (p.textMode !== 'area' || p.w <= 0 || measureLine(value) <= p.w) return [value];
    const result: string[] = [];
    let current = '';
    const commit = (): void => {
      const line = current.trimEnd();
      if (line.length > 0) result.push(line);
      current = '';
    };
    for (const token of value.split(/(\s+)/)) {
      if (token.length === 0) continue;
      const candidate = current + token;
      if (current.length > 0 && measureLine(candidate) > p.w) commit();
      if (measureLine(token) <= p.w) {
        current += current.length === 0 ? token.trimStart() : token;
        continue;
      }
      for (const char of token) {
        if (current.length > 0 && measureLine(current + char) > p.w) commit();
        current += char;
      }
    }
    commit();
    return result.length > 0 ? result : [''];
  };

  // Expand tabs using tab stops or default tab width
  function expandTabs(text: string, xStart: number): string {
    if (!text.includes('\t')) return text;
    const stops = p.tabStops;
    if (stops && stops.length > 0) {
      // Tab stops: advance to next stop position
      const slines: string[] = [];
      const parts = text.split('\t');
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i] ?? '';
        if (i === 0) {
          slines.push(part);
          continue;
        }
        // Compute current x position based on accumulated content width
        let currentX = xStart;
        for (const prev of slines) {
          currentX += measureTextAdvance(target, prev);
        }
        // Find the next tab stop > currentX
        let nextStop = currentX + measureTextAdvance(target, ' ') * 8;
        for (const stop of stops) {
          if (stop.position > currentX + xStart) {
            nextStop = stop.position - xStart;
            break;
          }
        }
        const spaceWidth = measureTextAdvance(target, ' ');
        const spacesNeeded = Math.max(1, Math.ceil((nextStop - currentX) / spaceWidth));
        slines.push(' '.repeat(spacesNeeded) + part);
      }
      return slines.join('');
    }
    // Default tab width: 8 spaces
    const tabWidth = (p.tabSize ?? 8) * measureTextAdvance(target, ' ');
    const lines: string[] = [];
    const parts = text.split('\t');
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        lines.push(parts[i] ?? '');
        continue;
      }
      let currentX = xStart;
      for (const prev of lines) {
        currentX += measureTextAdvance(target, prev);
      }
      const tabStop = Math.ceil((currentX - xStart + 1) / tabWidth) * tabWidth + xStart;
      const spaceWidth = measureTextAdvance(target, ' ');
      const spacesNeeded = Math.max(1, Math.ceil((tabStop - currentX) / spaceWidth));
      lines.push(' '.repeat(spacesNeeded) + (parts[i] ?? ''));
    }
    return lines.join('');
  }

  // Split into lines and expand tabs
  const rawLines = displayText.split('\n').flatMap((line) => wrapLine(expandTabs(line, p.x)));

  // Build list prefix for each line
  const lines: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let line = rawLines[i] ?? '';
    if (p.listStyle === 'disc') line = `• ${line}`;
    else if (p.listStyle === 'circle') line = `○ ${line}`;
    else if (p.listStyle === 'square') line = `[ ] ${line}`;
    else if (p.listStyle === 'decimal') line = `${i + 1}. ${line}`;
    lines.push(line);
  }

  // Compute line metrics
  const lh = p.fontSize * p.lineHeight;
  const ps = p.paragraphSpacing;
  const ls = p.letterSpacing;
  const tr = ((p.tracking ?? 0) * p.fontSize) / 1000;

  // Compute text overflow: visible text
  const visibleLines: Array<{ text: string; y: number }> = [];
  const currentY = p.y;
  for (let i = 0; i < lines.length; i++) {
    const yPos = currentY + i * lh + (i > 0 ? ps : 0);
    if (p.textOverflow === 'clip' && yPos + lh > p.y + p.h) break;
    visibleLines.push({ text: lines[i] ?? '', y: yPos });
  }

  // Adjust Y for vertical alignment
  const totalHeight = visibleLines.length * lh + Math.max(0, visibleLines.length - 1) * ps;
  let yOffset = 0;
  if (p.textAlignVertical === 'middle') {
    yOffset = (p.h - totalHeight) / 2;
  } else if (p.textAlignVertical === 'bottom') {
    yOffset = p.h - totalHeight;
  }

  // Draw each line
  for (const vl of visibleLines) {
    const y = vl.y + yOffset;
    const text = vl.text;

    // Handle overflow ellipsis
    let displayLine = text;
    if (p.textOverflow === 'ellipsis') {
      target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;
      displayLine = text + (text.length > 0 && y + lh > p.y + p.h ? '…' : '');
    }

    // Calculate x origin based on text alignment within the box
    let xOrigin: number;
    let extraWordSpacing = 0;
    if (p.textAlign === 'center') {
      xOrigin = p.x + p.w / 2;
    } else if (p.textAlign === 'right') {
      xOrigin = p.x + p.w;
    } else if (p.textAlign === 'justify') {
      xOrigin = p.x;
      // Justify: distribute extra space between words
      if (displayLine.length > 0) {
        target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;
        const totalTextWidth =
          measureTextAdvance(target, displayLine.replace(/\s/g, '')) +
          (displayLine.split(/\s+/).length - 1) * measureTextAdvance(target, ' ');
        const gaps = (displayLine.match(/\s/g) || []).length;
        if (gaps > 0 && totalTextWidth < p.w) {
          extraWordSpacing = (p.w - totalTextWidth) / gaps;
        }
      }
    } else {
      xOrigin = p.x;
    }

    // Apply first-line indent (first line only)
    const isFirstLine = vl === visibleLines[0];
    const lineIndent = isFirstLine && p.firstLineIndent ? p.firstLineIndent : 0;

    // Draw text with letter spacing if needed
    const drawOriginX = xOrigin + lineIndent;
    const hasGlyphAdjustments =
      p.glyphAdjustments !== undefined && Object.keys(p.glyphAdjustments).length > 0;
    const hasPairAdjustments =
      p.pairAdjustments !== undefined && Object.keys(p.pairAdjustments).length > 0;
    const glyphControlled = p.kerningMode === 'none' || hasGlyphAdjustments || hasPairAdjustments;
    // Cluster drawing needs a 1:1 display line -> source text mapping so
    // cluster indices remain globally stable (no case transform, list
    // prefix, tabs, wrapping, RTL, or justify word-spacing).
    const clusterSafe =
      glyphControlled &&
      lines.length === 1 &&
      lines[0] === text &&
      !isRTL &&
      p.textAlign !== 'justify' &&
      extraWordSpacing === 0;
    if (clusterSafe) {
      drawClusters(target, displayLine, drawOriginX, y, ls, tr, p);
    } else if (
      (ls !== 0 ||
        tr !== 0 ||
        extraWordSpacing > 0 ||
        (p.kerningMode === 'none' && glyphControlled)) &&
      displayLine.length > 1
    ) {
      // Per-character or per-word rendering for custom spacing. Also used as
      // the kerning-off fallback when the cluster path is unavailable.
      const words = displayLine.split(/(\s+)/);
      let cursorX = drawOriginX;
      for (const word of words) {
        if (word === '') continue;
        const isSpace = /^\s+$/.test(word);
        if (isSpace) {
          // Draw spaces as advance only
          cursorX += measureTextAdvance(target, word) + extraWordSpacing;
          continue;
        }
        if ((ls !== 0 || tr !== 0) && word.length > 1) {
          // Letter spacing / tracking per character
          for (let ci = 0; ci < word.length; ci++) {
            const char = word[ci] ?? '';
            target.fillText(char, cursorX, y);
            cursorX += measureTextAdvance(target, char) + ls + tr;
          }
        } else {
          target.fillText(word, cursorX, y);
          cursorX += measureTextAdvance(target, word);
        }
      }
    } else {
      target.fillText(displayLine, drawOriginX, y);
    }

    // Text decoration: underline
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const decoY = p.textDecoration === 'underline' ? y + p.fontSize * 1.1 : y + p.fontSize * 0.5;
      const decoX1 = p.textAlign === 'center' ? p.x : p.x;
      const decoX2 = p.textAlign === 'center' ? p.x + p.w : p.x + p.w;
      target.beginPath();
      target.moveTo(decoX1, decoY);
      target.lineTo(decoX2, decoY);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }
}

/** Module-level cached canvas + context for measureText calls (created lazily). */
let _measureCanvasOffscreen: OffscreenCanvas | HTMLCanvasElement | null = null;
let _measureCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function _ensureMeasureContext(): void {
  if (_measureCtx) return;
  if (typeof OffscreenCanvas !== 'undefined') {
    _measureCanvasOffscreen = new OffscreenCanvas(4096, 1);
    _measureCtx = _measureCanvasOffscreen.getContext('2d');
  }
  if (!_measureCtx && typeof document !== 'undefined') {
    _measureCanvasOffscreen = document.createElement('canvas');
    _measureCanvasOffscreen.width = 4096;
    _measureCanvasOffscreen.height = 1;
    _measureCtx = _measureCanvasOffscreen.getContext('2d');
  }
}

/** Measure the width of a single character in the current canvas font. Falls back to an estimate. */
function measureTextAdvance(target: ReplayTarget, char: string): number {
  _ensureMeasureContext();
  const fallback = char.length * (target.font ? parseFontSize(target.font) * 0.6 : 0);
  if (!_measureCtx) return fallback;
  _measureCtx.font = target.font;
  const measured = _measureCtx.measureText(char).width;
  return Number.isFinite(measured) && (measured > 0 || char.length === 0) ? measured : fallback;
}

function parseFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match?.[1] ? Number.parseFloat(match[1]) : 16;
}

/** Paint a closed/open path fill (supports optional hole rings via evenodd). */
function paintPathFill(
  target: ReplayTarget,
  p: {
    points: {
      x: number;
      y: number;
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }[];
    closed: boolean;
    tolerance: number;
    holes?: {
      x: number;
      y: number;
      handleIn: [number, number] | null;
      handleOut: [number, number] | null;
    }[][];
    fillRule?: 'nonzero' | 'evenodd';
  },
): void {
  const shape = { kind: 'path' as const, ...p };
  const rings = pathRings(shape);
  if (rings.length === 0) return;
  target.beginPath();
  for (const ring of rings) {
    const first = ring[0];
    if (!first) continue;
    target.moveTo(first.x, first.y);
    for (let i = 1; i < ring.length; i++) {
      const pt = ring[i];
      const prev = ring[i - 1];
      if (!pt || !prev) continue;
      if (prev.handleOut || pt.handleIn) {
        const cp1x = prev.handleOut ? prev.x + prev.handleOut[0] : prev.x;
        const cp1y = prev.handleOut ? prev.y + prev.handleOut[1] : prev.y;
        const cp2x = pt.handleIn ? pt.x + pt.handleIn[0] : pt.x;
        const cp2y = pt.handleIn ? pt.y + pt.handleIn[1] : pt.y;
        target.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pt.x, pt.y);
      } else {
        target.lineTo(pt.x, pt.y);
      }
    }
    target.closePath();
  }
  const fillRule = pathFillRule(shape);
  if (fillRule === 'evenodd') target.fill(fillRule);
  else target.fill();
}

/**
 * Paint a single stroke over the primitive path.
 *
 * Canvas2D natively supports only `'center'` stroke alignment (`lineWidth`
 * straddles the path equally on both sides). `'inside'` stroke alignment is
 * approximated by clipping to the shape interior before stroking (the part
 * of the stroke outside the shape is clipped away). `'outside'` alignment
 * cannot be approximated with Canvas2D's clip API (no "inverse clip"
 * primitive) and falls back to `'center'` with a console.warn on first use.
 */
let _strokeAlignWarned = false;
function paintStroke(
  target: ReplayTarget,
  stroke: import('./types').Stroke,
  item: RenderItem,
): void {
  target.save();
  target.strokeStyle = rgba(stroke.color);
  target.lineWidth = stroke.weight;
  target.lineCap = stroke.cap as CanvasLineCap;
  target.lineJoin = stroke.join as CanvasLineJoin;
  target.lineDashOffset = stroke.dashOffset ?? 0;

  if (stroke.dashPattern && stroke.dashPattern.length > 0) {
    target.setLineDash(stroke.dashPattern);
  }

  // Handle non-center stroke alignment (Canvas2D only supports center natively)
  if (stroke.align === 'inside') {
    // Inside stroke: clip to shape interior, then stroke centered.
    // The outer half of the stroke is clipped away, leaving only the inside half.
    target.beginPath();
    traceOutline(target, item.primitive);
    if (target.clip) target.clip();
  } else if (stroke.align === 'outside') {
    // Outside stroke: render a double-width stroke, then composite the shape
    // interior on top with destination-out to remove the inner half.
    // This leaves only the portion of the stroke outside the shape boundary.
    if (typeof OffscreenCanvas !== 'undefined' && typeof document !== 'undefined') {
      try {
        const strokePad = stroke.weight * 2 + 2;
        const b = primitiveBounds(item.primitive);
        const sw = Math.ceil((b.w || 1) + strokePad * 2);
        const sh = Math.ceil((b.h || 1) + strokePad * 2);
        const oc = new OffscreenCanvas(sw, sh);
        const octx = oc.getContext('2d');
        if (octx) {
          const ox = (b.x || 0) - strokePad;
          const oy = (b.y || 0) - strokePad;
          octx.translate(-ox, -oy);
          octx.beginPath();
          traceOutline(octx, item.primitive);
          octx.fillStyle = 'white';
          octx.fill();
          target.lineWidth = stroke.weight * 2;
          target.beginPath();
          traceOutline(target, item.primitive);
          target.stroke();
          target.globalCompositeOperation = 'destination-out';
          target.drawImage!(oc as unknown as CanvasImageSource, 0, 0);
          target.globalCompositeOperation = 'source-over';
          target.restore();
          return;
        }
      } catch {
        // fall through to center fallback
      }
    }
    if (!_strokeAlignWarned) {
      console.warn('Canvas2D does not support outside stroke alignment; falling back to center');
      _strokeAlignWarned = true;
    }
  }

  const p = item.primitive;
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && p.cornerSmoothing && p.cornerSmoothing > 0) {
        traceSquirclePath(target, p.x, p.y, p.w, p.h, p.cornerRadius, p.cornerSmoothing);
        target.stroke();
      } else if (p.cornerRadius && target.roundRect) {
        target.beginPath();
        target.roundRect(p.x, p.y, p.w, p.h, p.cornerRadius);
        target.stroke();
      } else {
        target.strokeRect(p.x, p.y, p.w, p.h);
      }
      break;
    case 'ellipse':
    case 'circle':
    case 'polygon':
    case 'star': {
      target.beginPath();
      traceOutline(target, p);
      target.stroke();
      break;
    }
    case 'line': {
      // Lines can also have arrowheads via stroke.arrowStart/arrowEnd.
      const arrowStart = stroke.arrowStart ?? 'none';
      const arrowEnd = stroke.arrowEnd ?? 'none';
      const hasArrowheads = arrowStart !== 'none' || arrowEnd !== 'none';
      if (hasArrowheads) {
        target.lineCap = 'butt';
      }
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      if (hasArrowheads) {
        const headSize = arrowheadSize(undefined, stroke.weight);
        target.fillStyle = rgba(stroke.color);
        if (arrowStart !== 'none') {
          drawArrowhead(target, p.from, p.to, headSize, arrowStart, true);
        }
        if (arrowEnd !== 'none') {
          drawArrowhead(target, p.from, p.to, headSize, arrowEnd, false);
        }
      }
      break;
    }
    case 'arrow': {
      // When arrowheads are present, use butt cap so the stroke doesn't
      // extend past the arrowhead base (round cap creates a visible bump).
      const arrowStart = stroke.arrowStart ?? 'none';
      const arrowEnd = stroke.arrowEnd ?? 'arrow';
      const hasArrowheads = arrowStart !== 'none' || arrowEnd !== 'none';
      if (hasArrowheads) {
        target.lineCap = 'butt';
      }
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      // Draw arrowheads using stroke color, respecting per-stroke arrowStart/arrowEnd.
      // Default: arrow tool produces an end arrowhead.
      const headSize = arrowheadSize(p.arrowheadSize, stroke.weight);
      target.fillStyle = rgba(stroke.color);
      if (arrowStart !== 'none') {
        drawArrowhead(target, p.from, p.to, headSize, arrowStart, true);
      }
      if (arrowEnd !== 'none') {
        drawArrowhead(target, p.from, p.to, headSize, arrowEnd, false);
      }
      break;
    }
    case 'path': {
      const hasPressure = p.points.some((pp) => pp.pressure !== undefined && pp.pressure !== 0.5);
      if (hasPressure && stroke.weight > 0) {
        paintVariableWidthPathStroke(
          target,
          p.points,
          p.closed,
          stroke.weight,
          stroke.cap,
          stroke.join,
        );
      } else {
        target.beginPath();
        target.moveTo(p.points[0]?.x ?? 0, p.points[0]?.y ?? 0);
        for (let i = 1; i < p.points.length; i++) {
          const pt = p.points[i];
          if (!pt) continue;
          const prev = p.points[i - 1];
          if (prev && (prev.handleOut || pt.handleIn)) {
            const cp1x = prev.handleOut ? prev.x + prev.handleOut[0] : prev.x;
            const cp1y = prev.handleOut ? prev.y + prev.handleOut[1] : prev.y;
            const cp2x = pt.handleIn ? pt.x + pt.handleIn[0] : pt.x;
            const cp2y = pt.handleIn ? pt.y + pt.handleIn[1] : pt.y;
            target.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pt.x, pt.y);
          } else {
            target.lineTo(pt.x, pt.y);
          }
        }
        if (p.closed) target.closePath();
        target.stroke();
      }
      break;
    }
    default:
      break;
  }

  target.restore();
}

/**
 * Paint a variable-width stroke for a path primitive.
 * Uses per-point pressure to modulate stroke width along the path.
 * Segments the path into small sub-paths, each drawn with interpolated width.
 */
function paintVariableWidthPathStroke(
  target: ReplayTarget,
  points: import('./types').PathPoint[],
  closed: boolean,
  baseWeight: number,
  cap: import('./types').StrokeCap,
  join: import('./types').StrokeJoin,
): void {
  if (points.length < 2) return;

  // Determine if we have genuine pressure variation
  const hasPressure = points.some((p) => p.pressure !== undefined && p.pressure !== 0.5);
  if (!hasPressure) return;

  target.save();
  target.lineCap = (cap || 'round') as CanvasLineCap;
  target.lineJoin = (join || 'round') as CanvasLineJoin;

  const SEGMENTS_PER_BEZIER = 12;
  const samples: { x: number; y: number; width: number }[] = [];

  // Walk through each segment and sample at regular intervals for width interpolation
  for (let i = 0; i < points.length; i++) {
    const pt = points[i]!;
    const prev = i > 0 ? points[i - 1] : null;

    if (!prev) {
      const w = baseWeight * (pt.pressure ?? 0.5);
      samples.push({ x: pt.x, y: pt.y, width: Math.max(0.5, w) });
      continue;
    }

    const isBezier = !!(prev.handleOut || pt.handleIn);

    if (isBezier) {
      const p0x = prev.x;
      const p0y = prev.y;
      const p3x = pt.x;
      const p3y = pt.y;
      const cp1x = prev.handleOut ? prev.x + prev.handleOut[0] : prev.x;
      const cp1y = prev.handleOut ? prev.y + prev.handleOut[1] : prev.y;
      const cp2x = pt.handleIn ? pt.x + pt.handleIn[0] : pt.x;
      const cp2y = pt.handleIn ? pt.y + pt.handleIn[1] : pt.y;
      const pStart = prev.pressure ?? 0.5;
      const pEnd = pt.pressure ?? 0.5;
      const steps = SEGMENTS_PER_BEZIER;

      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const oneMinusT = 1 - t;
        const x =
          oneMinusT * oneMinusT * oneMinusT * p0x +
          3 * oneMinusT * oneMinusT * t * cp1x +
          3 * oneMinusT * t * t * cp2x +
          t * t * t * p3x;
        const y =
          oneMinusT * oneMinusT * oneMinusT * p0y +
          3 * oneMinusT * oneMinusT * t * cp1y +
          3 * oneMinusT * t * t * cp2y +
          t * t * t * p3y;
        const pressure = pStart + (pEnd - pStart) * t;
        const w = baseWeight * pressure;
        samples.push({ x, y, width: Math.max(0.5, w) });
      }
    } else {
      // Linear segment
      const pStart = prev.pressure ?? 0.5;
      const pEnd = pt.pressure ?? 0.5;
      const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
      const steps = Math.max(1, Math.ceil(dist / 3));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const x = prev.x + (pt.x - prev.x) * t;
        const y = prev.y + (pt.y - prev.y) * t;
        const pressure = pStart + (pEnd - pStart) * t;
        const w = baseWeight * pressure;
        samples.push({ x, y, width: Math.max(0.5, w) });
      }
    }
  }

  if (samples.length < 2) {
    target.restore();
    return;
  }

  // Draw each short segment with interpolated width
  // Use round caps on each segment for smooth appearance
  target.lineCap = 'round';
  target.lineJoin = 'round';

  for (let i = 1; i < samples.length; i++) {
    const s0 = samples[i - 1]!;
    const s1 = samples[i]!;
    const avgWidth = (s0.width + s1.width) / 2;
    target.lineWidth = avgWidth;
    target.beginPath();
    target.moveTo(s0.x, s0.y);
    target.lineTo(s1.x, s1.y);
    target.stroke();
  }

  // If closed, connect last to first with interpolated width
  if (closed && samples.length > 2) {
    const last = samples[samples.length - 1]!;
    const first = samples[0]!;
    const avgWidth = (last.width + first.width) / 2;
    target.lineWidth = avgWidth;
    target.beginPath();
    target.moveTo(last.x, last.y);
    target.lineTo(first.x, first.y);
    target.stroke();
  }

  target.restore();
}

/** Compute effective arrowhead size, respecting both the primitive's arrowheadSize
 * and the stroke weight. Ensure a minimum visible size. */
function arrowheadSize(primitiveSize: number | undefined, strokeWeight: number): number {
  const fromWeight = Math.max(strokeWeight * 3, 4);
  if (primitiveSize && primitiveSize > 0) {
    return Math.min(Math.max(primitiveSize, fromWeight), Math.max(strokeWeight * 6, fromWeight));
  }
  return fromWeight;
}

/** Draw a filled arrowhead oriented along the from→to direction.
 * Handles degenerate (zero-length) segments by skipping rendering. */
function drawArrowhead(
  target: ReplayTarget,
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
  style: ArrowheadStyle,
  isStart: boolean,
): void {
  if (style === 'none') return;
  // Guard against degenerate segments: skip if endpoints coincide.
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;

  // For start arrowheads, the direction is reversed (pointing away from `to`).
  const tip = isStart ? from : to;
  const tail = isStart ? to : from;
  const angle = Math.atan2(tip[1] - tail[1], tip[0] - tail[0]);
  const spread = Math.PI / 9;
  const safeSize = Math.max(size, 1);

  target.save();
  target.translate(tip[0], tip[1]);
  target.rotate(angle);

  switch (style) {
    case 'arrow': {
      // Elongated arrowhead: tip at origin, base set back by the full size.
      // The base width is controlled by spread (narrower = more elongated).
      const baseX = -safeSize;
      const halfW = safeSize * Math.sin(spread);
      target.beginPath();
      target.moveTo(0, 0);
      target.lineTo(baseX, -halfW);
      target.lineTo(baseX, halfW);
      target.closePath();
      target.fill();
      break;
    }
    case 'circle': {
      const r = safeSize * 0.5;
      target.beginPath();
      target.arc(-r, 0, r, 0, TAU);
      target.fill();
      break;
    }
    case 'square': {
      const s = safeSize * 0.7;
      target.beginPath();
      target.rect(-s, -s * 0.5, s, s);
      target.fill();
      break;
    }
    case 'diamond': {
      const s = safeSize * 0.6;
      target.beginPath();
      target.moveTo(0, 0);
      target.lineTo(-s, -s * 0.5);
      target.lineTo(-s * 2, 0);
      target.lineTo(-s, s * 0.5);
      target.closePath();
      target.fill();
      break;
    }
  }
  target.restore();
}

/** Trace the outline of a primitive without filling. Covers all shape types
 * for use in clipping operations (inner shadow, image fill clips). */
function traceOutline(target: ReplayTarget, p: RenderItem['primitive']): void {
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && p.cornerSmoothing && p.cornerSmoothing > 0) {
        traceSquirclePath(target, p.x, p.y, p.w, p.h, p.cornerRadius, p.cornerSmoothing);
      } else if (p.cornerRadius && target.roundRect) {
        target.roundRect(p.x, p.y, p.w, p.h, p.cornerRadius);
      } else {
        target.rect(p.x, p.y, p.w, p.h);
      }
      break;
    case 'ellipse':
      target.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, TAU);
      break;
    case 'circle':
      target.arc(p.cx, p.cy, p.r, 0, TAU);
      break;
    case 'line': {
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      break;
    }
    case 'arrow': {
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      break;
    }
    case 'polygon':
      for (let i = 0; i < p.sides; i++) {
        const a = (2 * Math.PI * i) / p.sides - Math.PI / 2 + p.rotation;
        const px = p.cx + p.radius * Math.cos(a);
        const py = p.cy + p.radius * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      break;
    case 'star':
      for (let i = 0; i < p.points * 2; i++) {
        const a = (Math.PI * i) / p.points - Math.PI / 2 + p.rotation;
        const r = i % 2 === 0 ? p.outerRadius : p.innerRadius;
        const px = p.cx + r * Math.cos(a);
        const py = p.cy + r * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      break;
    case 'path':
      if (p.points.length > 0) {
        target.moveTo(p.points[0]?.x ?? 0, p.points[0]?.y ?? 0);
        for (let i = 1; i < p.points.length; i++) {
          const pt = p.points[i];
          const prev = p.points[i - 1];
          if (!pt || !prev) continue;
          if (prev.handleOut || pt.handleIn) {
            const cp1x = prev.handleOut ? prev.x + prev.handleOut[0] : prev.x;
            const cp1y = prev.handleOut ? prev.y + prev.handleOut[1] : prev.y;
            const cp2x = pt.handleIn ? pt.x + pt.handleIn[0] : pt.x;
            const cp2y = pt.handleIn ? pt.y + pt.handleIn[1] : pt.y;
            target.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pt.x, pt.y);
          } else {
            target.lineTo(pt.x, pt.y);
          }
        }
        if (p.closed) target.closePath();
      }
      break;
    case 'text': {
      target.rect(p.x, p.y, p.w, p.h);
      break;
    }
    case 'rasterLayer': {
      target.rect(0, 0, p.width, p.height);
      break;
    }
    case 'warpedImage': {
      target.moveTo(p.quad[0][0], p.quad[0][1]);
      target.lineTo(p.quad[1][0], p.quad[1][1]);
      target.lineTo(p.quad[2][0], p.quad[2][1]);
      target.lineTo(p.quad[3][0], p.quad[3][1]);
      target.closePath();
      break;
    }
    default:
      break;
  }
}

/** Get the finite, local-coordinate bounding box of a primitive. */
export function primitiveBounds(p: RenderItem['primitive']): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  switch (p.kind) {
    case 'warpedImage': {
      return quadBoundsOf(p as Extract<Primitive, { kind: 'warpedImage' }>);
    }
    case 'rect':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'ellipse':
      return { x: p.cx - p.rx, y: p.cy - p.ry, w: p.rx * 2, h: p.ry * 2 };
    case 'circle':
      return { x: p.cx - p.r, y: p.cy - p.r, w: p.r * 2, h: p.r * 2 };
    case 'line':
      return {
        x: Math.min(p.from[0], p.to[0]),
        y: Math.min(p.from[1], p.to[1]),
        w: Math.max(Math.abs(p.to[0] - p.from[0]), 4),
        h: Math.max(Math.abs(p.to[1] - p.from[1]), 4),
      };
    case 'arrow': {
      const pad = p.arrowheadSize;
      return {
        x: Math.min(p.from[0], p.to[0]) - pad,
        y: Math.min(p.from[1], p.to[1]) - pad,
        w: Math.max(Math.abs(p.to[0] - p.from[0]), 4) + pad * 2,
        h: Math.max(Math.abs(p.to[1] - p.from[1]), 4) + pad * 2,
      };
    }
    case 'polygon':
      return { x: p.cx - p.radius, y: p.cy - p.radius, w: p.radius * 2, h: p.radius * 2 };
    case 'star':
      return {
        x: p.cx - p.outerRadius,
        y: p.cy - p.outerRadius,
        w: p.outerRadius * 2,
        h: p.outerRadius * 2,
      };
    case 'text':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'table':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'path': {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      const include = (x: number, y: number): void => {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      };

      for (const ring of [p.points, ...(p.holes ?? [])]) {
        for (const point of ring) {
          include(point.x, point.y);
          if (point.handleIn) {
            include(point.x + point.handleIn[0], point.y + point.handleIn[1]);
          }
          if (point.handleOut) {
            include(point.x + point.handleOut[0], point.y + point.handleOut[1]);
          }
        }
      }

      if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        return { x: 0, y: 0, w: 0, h: 0 };
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'rasterLayer':
      return { x: 0, y: 0, w: p.width, h: p.height };
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}
