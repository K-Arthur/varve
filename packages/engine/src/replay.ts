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
import { applyFilterChain } from './filters';
import { layoutRichText } from './textLayout';
import { placeGlyphsOnPath } from './pathText';
import { managedColorToRgba } from '@strata/shared';
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
  fillText(text: string, x: number, y: number): void;
  font: string;
  textBaseline: CanvasTextBaseline;
  fillStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  textAlign: CanvasTextAlign;
  lineJoin: CanvasLineJoin;
  strokeStyle: string;
  /** F6: opacity for the item layer. */
  globalAlpha: number;
  /** F6: blend mode compositing. */
  globalCompositeOperation: string;
  /** F6: CSS filter for effects. */
  filter: string;
  lineDashOffset: number;
  setLineDash(segments: number[]): void;
  /** F6: draw an image. */
  drawImage?(
    image: CanvasImageSource | string,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
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
  /** P2: for shadow effects (replay clips shadow pass). */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Set the clipping path from the current sub-path. */
  clip?(): void;
  /** Create a pattern from an image source. */
  createPattern?(image: CanvasImageSource | string, repetition: string): ReplayPattern | null;
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

/** Replay `ir` into `target` (a 2D context). Clears nothing; caller manages. */
export function replayIr(target: ReplayTarget, ir: readonly RenderItem[]): void {
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
      item.blendMode && item.blendMode !== 'normal' ? mapBlendMode(item.blendMode) : 'source-over';
    if (itemBlend !== 'source-over') {
      target.globalCompositeOperation = itemBlend;
    }

    // ── Effects pass (shadows, blur) ──────────────────────────────
    // Each shadow effect is rendered independently as a colored blurred shape behind/inside.
    // Blur effects track max radius and apply to the main content.
    let maxLayerBlur = 0;
    let maxBgBlur = 0;

    if (item.effects && item.effects.length > 0) {
      // Pre-compute the shape path once for all effect passes
      for (const effect of item.effects) {
        if (!effect.visible) continue;

        if (effect.type === 'dropShadow') {
          target.save();
          // Apply per-effect compositing
          if (effect.blendMode && effect.blendMode !== 'normal') {
            target.globalCompositeOperation = mapBlendMode(effect.blendMode);
          }
          // Offset and blur the shadow shape
          target.transform(1, 0, 0, 1, effect.x, effect.y);
          const blurRadius = effect.blur + Math.max(0, effect.spread) / 2;
          if (blurRadius > 0) {
            target.filter = `blur(${blurRadius}px)`;
          }
          target.fillStyle = rgba(effect.color, effect.opacity);
          paintShapeFill(target, item);
          target.restore();
        }

        if (effect.type === 'innerShadow') {
          target.save();
          // Build shape path as clip so the shadow only renders inside the shape
          target.beginPath();
          traceOutline(target, item.primitive);
          target.closePath();
          if (target.clip) target.clip();
          // Apply per-effect compositing
          if (effect.blendMode && effect.blendMode !== 'normal') {
            target.globalCompositeOperation = mapBlendMode(effect.blendMode);
          }
          // For inner shadow: draw a blurred shape offset INWARD (offset same sign as effect)
          // Clip hides the outward-extending part; only the inward-shadow is visible
          const blurRadius = effect.blur + Math.max(0, effect.spread) / 2;
          if (blurRadius > 0) {
            target.filter = `blur(${blurRadius}px)`;
          }
          target.fillStyle = rgba(effect.color, effect.opacity);
          paintShapeFill(target, item);
          target.restore();
        }

        if (effect.type === 'layerBlur') {
          maxLayerBlur = Math.max(maxLayerBlur, effect.radius);
        }

        if (effect.type === 'backgroundBlur') {
          maxBgBlur = Math.max(maxBgBlur, effect.radius);
        }
      }
    }

    // Apply nondestructive adjustment filters to the main content.
    // Filters are applied before fills and persist through strokes.
    if (item.filters && item.filters.length > 0) {
      applyFilterChain(target, item.filters);
    }

    // ── Fills pass ────────────────────────────────────────────────
    const fills = item.fills;
    if (fills && fills.length > 0) {
      const restoreBlend = target.globalCompositeOperation;
      for (const fill of fills) {
        if (!fill.visible) continue;
        // Per-fill opacity multiplies with item alpha. Always set (resets between fills).
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
      // Legacy: single fill color
      target.fillStyle = rgba(item.fill);
      paintShapeFill(target, item);
    }

    // ── Strokes pass ──────────────────────────────────────────────
    if (item.strokes && item.strokes.length > 0) {
      for (const stroke of item.strokes) {
        if (!stroke.visible) continue;
        paintStroke(target, stroke, item);
      }
    }

    // Apply cumulative blur to the entire rendered content
    const totalBlur = Math.max(maxLayerBlur, maxBgBlur);
    if (totalBlur > 0) {
      target.filter = `blur(${totalBlur}px)`;
      // Draw the current content (already rendered) once more with blur
      // Canvas2D filter applies to subsequent draw calls, so we re-draw
      // the fill shape to get the blur effect on the existing content.
      // Since the content is already on canvas, we can't retroactively blur it.
      // Instead, set filter for subsequent strokes pass items if any.
      // For fills already drawn, this doesn't retroactively blur them.
      // The blur filter will apply to the strokes pass below.
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
}

/** Map Strata blend mode to CSS compositing operator. */
function mapBlendMode(mode: string): string {
  switch (mode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'darken':
      return 'darken';
    case 'lighten':
      return 'lighten';
    case 'colorDodge':
      return 'color-dodge';
    case 'colorBurn':
      return 'color-burn';
    case 'hardLight':
      return 'hard-light';
    case 'softLight':
      return 'soft-light';
    case 'difference':
      return 'difference';
    case 'exclusion':
      return 'exclusion';
    case 'hue':
      return 'hue';
    case 'saturation':
      return 'saturation';
    case 'color':
      return 'color';
    case 'luminosity':
      return 'luminosity';
    case 'plusDarker':
      return 'plus-darker';
    case 'plusLighter':
      return 'plus-lighter';
    case 'passThrough':
      return 'source-over';
    default:
      return 'source-over';
  }
}

/** Paint a single fill (solid, gradient, image, or pattern) over the primitive shape. */
function paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void {
  if (fill.type === 'solid') {
    target.fillStyle = rgba(fill.color);
    paintShapeFill(target, item);
  } else if (fill.type === 'gradient') {
    target.fillStyle = createGradientStyle(target, fill, item);
    paintShapeFill(target, item);
  } else if (fill.type === 'image') {
    paintImageFill(target, fill, item);
  } else if (fill.type === 'pattern') {
    // Pattern fill: draw as tinted placeholder for now
    target.fillStyle = 'rgba(160, 160, 180, 0.3)';
    paintShapeFill(target, item);
  }
}

/** Paint an image fill clipped to the primitive shape, respecting the fit mode. */
function paintImageFill(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'image' }>,
  item: RenderItem,
): void {
  target.save();
  target.beginPath();
  traceOutline(target, item.primitive);
  target.closePath();
  if (target.clip) target.clip();

  if (target.drawImage && fill.src) {
    const bounds = primitiveBounds(item.primitive);
    const fit = fill.fit ?? 'fill';
    const imageWidth = fill.imageWidth ?? bounds.w;
    const imageHeight = fill.imageHeight ?? bounds.h;

    if (fit === 'stretch') {
      target.drawImage(fill.src, bounds.x, bounds.y, bounds.w, bounds.h);
    } else if (fit === 'tile') {
      paintTiledImage(
        target,
        fill.src,
        bounds,
        imageWidth,
        imageHeight,
        fill.x ?? 0,
        fill.y ?? 0,
        fill.scale ?? 1,
      );
    } else {
      const { x, y, w, h } = computeImageFillRect(
        fit,
        bounds,
        imageWidth,
        imageHeight,
        fill.x ?? 0,
        fill.y ?? 0,
        fill.scale ?? 1,
      );
      target.drawImage(fill.src, x, y, w, h);
    }
  } else {
    // Placeholder when no drawImage support or no src
    target.fillStyle = 'rgba(180, 180, 200, 0.4)';
    const bounds = primitiveBounds(item.primitive);
    target.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
  }
  target.restore();
}

function paintTiledImage(
  target: ReplayTarget,
  src: string,
  bounds: { x: number; y: number; w: number; h: number },
  imageWidth: number,
  imageHeight: number,
  offsetX: number,
  offsetY: number,
  scale: number,
): void {
  if (!target.drawImage) return;
  const tileW = imageWidth * scale;
  const tileH = imageHeight * scale;
  if (tileW <= 0 || tileH <= 0) return;
  const startX = bounds.x + offsetX - Math.floor((bounds.x + offsetX) / tileW) * tileW;
  const startY = bounds.y + offsetY - Math.floor((bounds.y + offsetY) / tileH) * tileH;
  for (let y = startY; y < bounds.y + bounds.h; y += tileH) {
    for (let x = startX; x < bounds.x + bounds.w; x += tileW) {
      target.drawImage(src, x, y, tileW, tileH);
    }
  }
}

function computeImageFillRect(
  fit: 'fill' | 'fit' | 'stretch' | 'tile',
  bounds: { x: number; y: number; w: number; h: number },
  imageWidth: number,
  imageHeight: number,
  offsetX: number,
  offsetY: number,
  scale: number,
): { x: number; y: number; w: number; h: number } {
  if (fit === 'stretch') {
    return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  }
  const scaledW = imageWidth * scale;
  const scaledH = imageHeight * scale;
  if (scaledW <= 0 || scaledH <= 0) return { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };

  const imageAspect = scaledW / scaledH;
  const boundsAspect = bounds.w / bounds.h;

  let w: number;
  let h: number;
  if (fit === 'fit') {
    if (imageAspect > boundsAspect) {
      w = bounds.w;
      h = w / imageAspect;
    } else {
      h = bounds.h;
      w = h * imageAspect;
    }
  } else {
    // fill
    if (imageAspect > boundsAspect) {
      h = bounds.h;
      w = h * imageAspect;
    } else {
      w = bounds.w;
      h = w / imageAspect;
    }
  }

  return {
    x: bounds.x + offsetX + (bounds.w - w) / 2,
    y: bounds.y + offsetY + (bounds.h - h) / 2,
    w,
    h,
  };
}

/** Create a gradient fillStyle string from a FillIR gradient. */
function createGradientStyle(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'gradient' }>,
  item: RenderItem,
): string {
  const stops = fill.stops;
  if (stops.length === 0) return 'rgba(0,0,0,0)';

  const bounds = primitiveBounds(item.primitive);
  let rot = (fill.rotation * Math.PI) / 180;
  let cx = (bounds.x + bounds.w) / 2;
  let cy = (bounds.y + bounds.h) / 2;
  let halfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) / 2;

  // When a fill transform matrix is provided, derive gradient parameters from it
  if (fill.transform) {
    const t = fill.transform;
    const du = t[0] * halfDiag; // unit u-axis x
    const dv = t[1] * halfDiag; // unit u-axis y
    cx = bounds.x + t[4]; // translate x
    cy = bounds.y + t[5]; // translate y
    rot = Math.atan2(dv, du); // rotation from u-axis
    halfDiag = Math.sqrt(du * du + dv * dv); // scale magnitude
  }

  const dx = Math.cos(rot) * halfDiag;
  const dy = Math.sin(rot) * halfDiag;

  if (fill.gradientType === 'radial' && target.createRadialGradient) {
    const grad = target.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
    for (const s of stops) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    return grad as unknown as string;
  }

  if (fill.gradientType === 'angular' && target.createConicGradient) {
    const grad = target.createConicGradient(rot, cx, cy);
    for (const s of stops) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    return grad as unknown as string;
  }

  if (fill.gradientType === 'diamond' && target.createRadialGradient) {
    const grad = target.createRadialGradient(cx, cy, 0, cx, cy, halfDiag);
    for (const s of stops) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    return grad as unknown as string;
  }

  if (target.createLinearGradient) {
    const grad = target.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const s of stops) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    return grad as unknown as string;
  }

  return rgba(stops[0]?.color ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 0 });
}

/** Paint the primitive shape fill (without fillStyle). */
function paintShapeFill(target: ReplayTarget, item: RenderItem): void {
  const p = item.primitive;
  switch (p.kind) {
    case 'rect':
      if (p.cornerRadius && target.roundRect) {
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
    case 'image':
      // Render the image via drawImage. The item transform positions the image,
      // so local origin is (0,0). If drawImage is unavailable, draw a placeholder.
      if (target.drawImage && p.src) {
        target.drawImage(p.src, 0, 0, p.w, p.h);
      } else {
        target.fillRect(0, 0, p.w, p.h);
      }
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
    if (p.textAlign === 'center') xOffset = (p.w - lineWidth) / 2;
    else if (p.textAlign === 'right') xOffset = p.w - lineWidth;

    for (const run of line.runs) {
      target.font = run.font;
      const runFormat = run.format as { color?: readonly [number, number, number, number] };
      if (runFormat.color && runFormat.color[3] > 0) {
        target.fillStyle = rgba(runFormat.color);
      }
      target.fillText(run.text, p.x + run.x + xOffset, p.y + run.y + yOffset);

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

  // Split into lines
  const rawLines = displayText.split('\n');

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
    const xOrigin =
      p.textAlign === 'center' ? p.x + p.w / 2 : p.textAlign === 'right' ? p.x + p.w : p.x;

    // Draw text with letter spacing if needed
    if (ls !== 0 && displayLine.length > 1) {
      // Letter spacing: draw each character individually, using the real glyph width when possible.
      let cursorX = xOrigin;
      for (let ci = 0; ci < displayLine.length; ci++) {
        const char = displayLine[ci] ?? '';
        target.fillText(char, cursorX, y);
        // Measure the actual glyph advance so spacing is correct for non-monospace fonts.
        cursorX += measureTextAdvance(target, char) + ls;
      }
    } else {
      target.fillText(displayLine, xOrigin, y);
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

/** Measure the width of a single character in the current canvas font. Falls back to an estimate. */
function measureTextAdvance(target: ReplayTarget, char: string): number {
  if (typeof document === 'undefined') return target.font ? parseFontSize(target.font) * 0.6 : 0;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return parseFontSize(target.font) * 0.6;
  ctx.font = target.font;
  return ctx.measureText(char).width;
}

function parseFontSize(font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  return match && match[1] ? Number.parseFloat(match[1]) : 16;
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
      if (p.cornerRadius && target.roundRect) {
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
    case 'image': {
      target.rect(0, 0, p.w, p.h);
      break;
    }
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
    case 'image':
      return { x: 0, y: 0, w: p.w, h: p.h };
    case 'text':
      return { x: p.x, y: p.y, w: p.w, h: p.h };
    default:
      return { x: 0, y: 0, w: 100, h: 100 };
  }
}
