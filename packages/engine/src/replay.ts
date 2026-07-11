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

import { expandGradientStops, managedColorToRgba } from '@strata/shared';
import { gaussianBlurSeparable } from './blur';
import { CompositeCanvas, mapBlendMode } from './compositeCanvas';
import { applyFilterWithCompositing } from './filterCompositor';
import { applyFilterChain, filterChainToCss, filterToCss } from './filters';
import { getImageCache } from './imageCache';
import { placeGlyphsOnPath } from './pathText';
import { layoutRichText } from './textLayout';
import type { EngineColor, FillIR, RenderItem } from './types';

export interface ReplayTarget {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
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
  fill(): void;
  stroke(): void;
  closePath(): void;
  clip(): void;
  fillText(text: string, x: number, y: number): void;
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
  /** F6: draw an image. Matches the Canvas2D 3-arg and 5-arg overloads. */
  drawImage?(
    image: CanvasImageSource | string,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number,
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
}

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
  if (Array.isArray(c) || 'length' in c) {
    const arr = c as readonly [number, number, number, number];
    const alpha = opacityOverride !== undefined ? opacityOverride : arr[3] / 255;
    return `rgba(${arr[0]}, ${arr[1]}, ${arr[2]}, ${alpha})`;
  }
  const [r, g, b, a] = managedColorToRgba(c as EngineColor);
  const alpha = opacityOverride !== undefined ? opacityOverride : a / 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TAU = Math.PI * 2;

type BackgroundBlurEffect = Extract<
  NonNullable<RenderItem['effects']>[number],
  { type: 'backgroundBlur' }
>;
type LayerBlurEffect = Extract<NonNullable<RenderItem['effects']>[number], { type: 'layerBlur' }>;
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

  if (item.strokes && item.strokes.length > 0) {
    for (const stroke of item.strokes) {
      if (!stroke.visible) continue;
      paintStroke(target, stroke, item);
    }
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
  const pad = Math.ceil(effect.radius * 3);
  const lx = bounds.x - pad;
  const ly = bounds.y - pad;
  const lw = bounds.w + pad * 2;
  const lh = bounds.h + pad * 2;

  const m = target.getTransform();
  const mapPoint = (x: number, y: number): [number, number] => [
    m.a * x + m.c * y + m.e,
    m.b * x + m.d * y + m.f,
  ];
  const pts = [
    mapPoint(lx, ly),
    mapPoint(lx + lw, ly),
    mapPoint(lx + lw, ly + lh),
    mapPoint(lx, ly + lh),
  ];
  const minX = Math.floor(Math.min(...pts.map((p) => p[0])));
  const minY = Math.floor(Math.min(...pts.map((p) => p[1])));
  const maxX = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const maxY = Math.ceil(Math.max(...pts.map((p) => p[1])));
  const sw = Math.max(1, maxX - minX);
  const sh = Math.max(1, maxY - minY);

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
  cc.captureSource(canvas, minX, minY, sw, sh, 0, 0);
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

/**
 * Replay a list of render items to the given canvas target.
 * @param imageLookup Optional callback for resolving image source URLs to
 *   CanvasImageSource (used by render workers that receive ImageBitmaps
 *   via Structured Clone and cannot use `new Image()`).
 */
export function replayIr(
  target: ReplayTarget,
  ir: readonly RenderItem[],
  imageLookup?: (src: string) => CanvasImageSource | undefined,
): void {
  // Sweep expired backdrop cache entries (preserves recent entries across frames)
  sweepBackdropCache();
  // Gradient cache lives per replayIr call so it doesn't leak across frames
  gradientCache.clear();
  imageLookupForCurrentReplay = imageLookup ?? null;
  try {
    for (const item of ir) {
      target.save();

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
        (f) => !f.blendMode || f.blendMode !== 'normal' || (f.opacity ?? 1) < 1 || !filterToCss(f),
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

      const layerBlurEffect = item.effects?.find(
        (e): e is LayerBlurEffect => e.visible && e.type === 'layerBlur',
      );

      // ── Background blur (before fills — captures true backdrop) ───
      if (item.effects) {
        for (const effect of item.effects) {
          if (effect.visible && effect.type === 'backgroundBlur') {
            paintBackgroundBlur(target, item, effect);
          }
        }
      }

      // ── Fills + strokes pass (offscreen when layerBlur present) ───
      if (layerBlurEffect) {
        const bounds = primitiveBounds(item.primitive);
        const cc = new CompositeCanvas({
          width: Math.max(1, bounds.w),
          height: Math.max(1, bounds.h),
          devicePixelRatio: 1,
        });
        cc.ctx.translate(-bounds.x, -bounds.y);
        paintFillsAndStrokes(cc.ctx as unknown as ReplayTarget, item, itemAlpha, itemBlend);

        const radius = layerBlurEffect.radius;
        target.save();
        target.globalAlpha = itemAlpha;
        if (radius > 32) {
          // Software separable blur for large radii:
          // Capture fills to ImageData, blur in pixel space, put back, then draw.
          const imageData = cc.getImageData(0, 0, bounds.w, bounds.h);
          const blurred = gaussianBlurSeparable(imageData, radius);
          cc.putImageData(blurred, 0, 0);
          if (target.drawImage) {
            target.drawImage(
              cc.canvas as unknown as CanvasImageSource,
              bounds.x,
              bounds.y,
              bounds.w,
              bounds.h,
            );
          }
        } else {
          target.filter = `blur(${radius}px)`;
          if (target.drawImage) {
            target.drawImage(
              cc.canvas as unknown as CanvasImageSource,
              bounds.x,
              bounds.y,
              bounds.w,
              bounds.h,
            );
          }
        }
        target.restore();
      } else {
        paintFillsAndStrokes(target, item, itemAlpha, itemBlend);
      }

      // ── Effects pass (per-effect save/restore compositing) ────────
      if (item.effects && item.effects.length > 0) {
        for (const effect of item.effects) {
          if (!effect.visible) continue;
          if (effect.type === 'layerBlur' || effect.type === 'backgroundBlur') continue;
          if (effect.type === 'dropShadow') {
            target.save();
            target.shadowColor = rgba(effect.color);
            target.shadowBlur = effect.blur + Math.max(0, effect.spread) / 2;
            target.shadowOffsetX = effect.x;
            target.shadowOffsetY = effect.y;
            target.globalAlpha = effect.opacity ?? 1;
            // Use destination-over so the shadow source fill goes behind
            // the already-rendered item fill, preventing overdraw for image fills
            target.globalCompositeOperation = 'destination-over';
            target.fillStyle = rgba(effect.color);
            target.beginPath();
            traceOutline(target, item.primitive);
            target.fill();
            target.restore();
          } else if (effect.type === 'innerShadow') {
            paintInsetEffect(target, item, effect, 'shadow');
          } else if (effect.type === 'outerGlow') {
            // Outer glow: render a blurred colored shape behind the item (no offset)
            target.save();
            target.shadowColor = rgba(effect.color);
            target.shadowBlur = effect.blur + Math.max(0, effect.spread) / 2;
            target.shadowOffsetX = 0;
            target.shadowOffsetY = 0;
            target.globalAlpha = effect.opacity ?? 1;
            // Use destination-over so the glow source fill goes behind existing content
            target.globalCompositeOperation = 'destination-over';
            target.fillStyle = rgba(effect.color);
            target.beginPath();
            traceOutline(target, item.primitive);
            target.fill();
            target.restore();
          } else if (effect.type === 'innerGlow') {
            paintInsetEffect(target, item, effect, 'glow');
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
          applyFilterWithCompositing(
            targetCanvas,
            complexFilters,
            targetCanvas.canvas?.width ?? 100,
            targetCanvas.canvas?.height ?? 100,
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

      target.restore();
    }
  } finally {
    imageLookupForCurrentReplay = null;
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
    paintImageFill(target, fill, item);
  } else if (fill.type === 'pattern') {
    paintPatternFill(target, fill, item);
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

  // Render worker path: use pre-decoded ImageBitmap from Structured Clone.
  // This avoids the `new Image()` constructor which doesn't exist in Workers.
  if (imageLookupForCurrentReplay) {
    const img = imageLookupForCurrentReplay(fill.src);
    if (img && target.drawImage) {
      target.drawImage(img, bounds.x, bounds.y, bw, bh);
    } else {
      const prev = target.fillStyle;
      target.fillStyle = '#e8eaed';
      target.fillRect(bounds.x, bounds.y, bw, bh);
      target.fillStyle = prev;
    }
    return;
  }

  const cache = getImageCache();
  const imgEntry = cache.get(fill.src);
  const hasCached = imgEntry?.state === 'loaded' && imgEntry.image;

  // Kick off async loading for images not yet in cache. CanvasArea subscribes
  // to cache.subscribeGlobal() and will schedule a re-render on completion.
  if (!imgEntry || imgEntry.state === 'idle') {
    cache.load(fill.src).catch(() => {
      /* errors recorded in cache entry */
    });
  }

  if (!target.drawImage) {
    target.fillRect(bounds.x, bounds.y, bw, bh);
    return;
  }

  const scale = fill.scale ?? 1;
  const fit = fill.fit ?? 'fill';

  if (hasCached) {
    const img = imgEntry.image!;
    // Effective reference dimensions: scale the natural size (matches old IR convention).
    const refW = (img.naturalWidth || bw) * scale;
    const refH = (img.naturalHeight || bh) * scale;
    const aspect = refW / refH;
    const boundsAspect = bw / bh;
    let dw: number, dh: number;
    if (fit === 'stretch') {
      dw = bw;
      dh = bh;
    } else if (fit === 'tile') {
      if (refW > 0 && refH > 0) {
        const startX =
          bounds.x + (fill.x ?? 0) - Math.floor((bounds.x + (fill.x ?? 0)) / refW) * refW;
        const startY =
          bounds.y + (fill.y ?? 0) - Math.floor((bounds.y + (fill.y ?? 0)) / refH) * refH;
        for (let ty = startY; ty < bounds.y + bh; ty += refH) {
          for (let tx = startX; tx < bounds.x + bw; tx += refW) {
            target.drawImage(img, tx, ty, refW, refH);
          }
        }
      }
      return;
    } else if (fit === 'fit') {
      // Scale refW/refH to fit within bounds, preserving aspect ratio.
      if (aspect > boundsAspect) {
        dw = bw;
        dh = bw / aspect;
      } else {
        dh = bh;
        dw = bh * aspect;
      }
    } else {
      // fill: scale to cover bounds, preserving aspect ratio, centered.
      if (aspect > boundsAspect) {
        dh = bh;
        dw = bh * aspect;
      } else {
        dw = bw;
        dh = bw / aspect;
      }
    }
    const dx = bounds.x + (fill.x ?? 0) + (bw - dw) / 2;
    const dy = bounds.y + (fill.y ?? 0) + (bh - dh) / 2;

    // Apply alpha mask via offscreen compositing (background removal on shape nodes)
    if (fill.alphaMask && target.drawImage && typeof document !== 'undefined') {
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
          const oc = document.createElement('canvas');
          oc.width = bw;
          oc.height = bh;
          const octx = oc.getContext('2d');
          if (octx) {
            octx.drawImage(img, dx - bounds.x, dy - bounds.y, dw, dh);
            octx.globalCompositeOperation = 'destination-in';
            octx.drawImage(maskImg, 0, 0, bw, bh);
            target.drawImage(oc, bounds.x, bounds.y, bw, bh);
          } else {
            target.drawImage(img, dx, dy, dw, dh);
          }
        } catch {
          target.drawImage(img, dx, dy, dw, dh);
        }
      } else {
        target.drawImage(img, dx, dy, dw, dh);
      }
    } else {
      target.drawImage(img, dx, dy, dw, dh);
    }
  } else {
    // Image still loading — draw a subtle placeholder so the node is visible
    const prev = target.fillStyle;
    target.fillStyle = '#e8eaed';
    target.fillRect(bounds.x, bounds.y, bw, bh);
    target.fillStyle = prev;
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

  const tileEntry = getImageCache().get(fill.tileSrc);
  if (tileEntry?.state === 'loaded' && tileEntry.image && target.drawImage) {
    const spacing = fill.spacing;
    const tw = tileEntry.image.naturalWidth + spacing;
    const th = tileEntry.image.naturalHeight + spacing;
    for (let ty = 0; ty < bh; ty += th) {
      for (let tx = 0; tx < bw; tx += tw) {
        target.drawImage(
          tileEntry.image,
          tx,
          ty,
          tileEntry.image.naturalWidth,
          tileEntry.image.naturalHeight,
        );
      }
    }
  } else {
    target.fillStyle = 'rgba(200,200,200,0.5)';
    target.fillRect(0, 0, bw, bh);
  }
}

/** Expand gradient stops for canvas API using perceptually uniform interpolation. */
function expandGradientStopsForFill(
  fill: Extract<FillIR, { type: 'gradient' }>,
): { position: number; color: EngineColor }[] {
  const space = fill.interpolationSpace ?? 'oklab';
  if (space === 'srgb') {
    return fill.stops.map((s) => ({ position: s.position, color: s.color }));
  }
  const inputs = fill.stops.map((s) => {
    const [r, g, b, a] = managedColorToRgba(s.color);
    return {
      position: s.position,
      color: { space: 'rgb' as const, r, g, b, a },
      ...(s.midpoint !== undefined ? { midpoint: s.midpoint } : {}),
    };
  });
  return expandGradientStops(inputs, space, 16).map((s) => ({
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
const gradientCache = new Map<string, CanvasGradient | string>();

function gradientCacheKey(
  fill: Extract<FillIR, { type: 'gradient' }>,
  bounds: { x: number; y: number; w: number; h: number },
): string {
  return `${fill.gradientType}|${fill.interpolationSpace ?? ''}|${fill.rotation}|${fill.tilingMode ?? ''}|${JSON.stringify(fill.transform)}|${JSON.stringify(fill.stops)}|${bounds.x.toFixed(2)}|${bounds.y.toFixed(2)}|${bounds.w.toFixed(2)}|${bounds.h.toFixed(2)}`;
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
      grad.addColorStop(s.position, rgba(s.color));
    }
    result = grad;
  } else if (fill.gradientType === 'angular' && target.createConicGradient) {
    const grad = target.createConicGradient(rot, cx, cy);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    result = grad;
  } else if (fill.gradientType === 'diamond' && target.createRadialGradient) {
    const grad = target.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    result = grad;
  } else if (target.createLinearGradient) {
    const grad = target.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const expanded = expandGradientStopsForFill(fill);
    for (const s of expanded) {
      grad.addColorStop(s.position, rgba(s.color));
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
  const [tl, tr, br, bl] = (
    Array.isArray(cornerRadius)
      ? cornerRadius
      : [cornerRadius, cornerRadius, cornerRadius, cornerRadius]
  ).map((v) => Math.min(v, maxR)) as [number, number, number, number];
  const s = Math.max(0, Math.min(1, smoothing));
  // How far from the corner vertex the straight edge ends (> r when s > 0).
  const ext = (r: number) => Math.min(r * (1 + s * 0.55), maxR);
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
      grad.addColorStop(s.position, rgba(s.color));
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
    grad.addColorStop(s.position, rgba(s.color));
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
      // Lines stroke — handled in main loop via strokes pass.
      // For fill-only path, stroke the segment.
      target.lineWidth = p.tolerance * 2;
      target.lineCap = 'round';
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      break;
    case 'arrow':
      target.lineWidth = p.tolerance * 2;
      target.lineCap = 'round';
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      drawArrowhead(target, p.from, p.to, p.arrowheadSize);
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

/** Paint rich text using the typography layout engine. */
function paintRichText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  const defaultFormat = {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    fontWeight: p.fontWeight,
    fontStyle: p.fontStyle,
    letterSpacing: p.letterSpacing,
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

  for (const line of positioned.lines) {
    const lineWidth = line.runs.reduce((sum, r) => sum + r.width, 0);
    let xOffset = 0;
    let wordSpacingAdjust = 0;
    if (p.textAlign === 'center') {
      xOffset = (p.w - lineWidth) / 2;
    } else if (p.textAlign === 'right') {
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
      const runFormat = run.format as { color?: readonly [number, number, number, number] };
      if (runFormat.color && runFormat.color[3] > 0) {
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

/** Paint text along a path (text-on-path). */
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
  const fw = Math.max(1, Math.min(1000, p.fontWeight));
  target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;
  target.textBaseline = 'alphabetic';

  const placements = placeGlyphsOnPath(displayText, shape, {
    offset: settings.startOffset ?? 0,
    side: settings.side ?? 'top',
    fontSize: p.fontSize,
  });

  const originalFillStyle = target.fillStyle;

  for (const glyph of placements) {
    target.save();
    target.transform(1, 0, 0, 1, glyph.x, glyph.y);
    // Apply rotation via transform: [cos, sin, -sin, cos, 0, 0]
    const c = Math.cos(glyph.angle);
    const s = Math.sin(glyph.angle);
    target.transform(c, s, -s, c, 0, 0);
    target.fillText(glyph.char, 0, 0);
    target.restore();
  }

  target.fillStyle = originalFillStyle;
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

  const style = p.fontStyle === 'italic' ? 'italic ' : '';
  const fw = Math.max(1, Math.min(1000, p.fontWeight));
  target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;

  // Text baseline from vertical alignment
  const baselineMap: Record<string, CanvasTextBaseline> = {
    top: 'top',
    middle: 'middle',
    bottom: 'alphabetic',
  };
  target.textBaseline = baselineMap[p.textAlignVertical] ?? 'top';
  target.textAlign = p.textAlign as CanvasTextAlign;

  // Apply text case transform
  const displayText = applyTextCase(p.text, p.textCase);

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
  const rawLines = displayText.split('\n').map((l) => expandTabs(l, p.x));

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
    if ((ls !== 0 || extraWordSpacing > 0) && displayLine.length > 1) {
      // Per-character or per-word rendering for custom spacing
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
        if (ls !== 0 && word.length > 1) {
          // Letter spacing per character
          for (let ci = 0; ci < word.length; ci++) {
            const char = word[ci] ?? '';
            target.fillText(char, cursorX, y);
            cursorX += measureTextAdvance(target, char) + ls;
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

/** Module-level cached canvas context for measureText calls (created lazily). */
let _measureCtx: CanvasRenderingContext2D | null = null;

/** Measure the width of a single character in the current canvas font. Falls back to an estimate. */
function measureTextAdvance(target: ReplayTarget, char: string): number {
  if (typeof document === 'undefined') return target.font ? parseFontSize(target.font) * 0.6 : 0;
  if (!_measureCtx) {
    _measureCtx = document.createElement('canvas').getContext('2d');
  }
  if (!_measureCtx) return parseFontSize(target.font) * 0.6;
  _measureCtx.font = target.font;
  return _measureCtx.measureText(char).width;
}

function parseFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match?.[1] ? Number.parseFloat(match[1]) : 16;
}

/** Paint a closed/open path fill. */
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
  },
): void {
  if (p.points.length < 2) return;
  target.beginPath();
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
  target.fill();
}

/** Paint a single stroke over the primitive path. */
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
    case 'line':
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      break;
    case 'arrow':
      target.beginPath();
      target.moveTo(p.from[0], p.from[1]);
      target.lineTo(p.to[0], p.to[1]);
      target.stroke();
      // Arrowhead is drawn in the fill pass only to avoid double-draw.
      break;
    case 'path':
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
      break;
    default:
      break;
  }

  target.restore();
}

/** Draw a filled triangular arrowhead at `to`, oriented along the from→to direction. */
function drawArrowhead(
  target: ReplayTarget,
  from: readonly [number, number],
  to: readonly [number, number],
  size: number,
): void {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const spread = Math.PI / 7;
  const x1 = to[0] - size * Math.cos(angle - spread);
  const y1 = to[1] - size * Math.sin(angle - spread);
  const x2 = to[0] - size * Math.cos(angle + spread);
  const y2 = to[1] - size * Math.sin(angle + spread);
  target.beginPath();
  target.moveTo(to[0], to[1]);
  target.lineTo(x1, y1);
  target.lineTo(x2, y2);
  target.closePath();
  target.fill();
}

/** Trace the outline of a primitive without filling. Covers all shape types
 * for use in clipping operations (inner shadow, image fill clips). */
function traceOutline(target: ReplayTarget, p: RenderItem['primitive']): void {
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && target.roundRect) {
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
    default:
      break;
  }
}

/** Get the bounding box of a primitive. */
function primitiveBounds(p: RenderItem['primitive']): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  switch (p.kind) {
    case 'rect':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    case 'ellipse':
      return { x: p.cx - p.rx, y: p.cy - p.ry, w: p.rx * 2, h: p.ry * 2 };
    case 'circle':
      return { x: p.cx - p.r, y: p.cy - p.r, w: p.r * 2, h: p.r * 2 };
    case 'line':
    case 'arrow':
      return {
        x: Math.min(p.from[0], p.to[0]),
        y: Math.min(p.from[1], p.to[1]),
        w: Math.max(Math.abs(p.to[0] - p.from[0]), 4),
        h: Math.max(Math.abs(p.to[1] - p.from[1]), 4),
      };
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
    default:
      return { x: 0, y: 0, w: 100, h: 100 };
  }
}
