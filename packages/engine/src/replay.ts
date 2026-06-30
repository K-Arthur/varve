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
import type { Color, FillIR, RenderItem } from './types';

export interface ReplayTarget {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
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
  /** P2: for shadow effects (replay clips shadow pass). */
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
}

export interface ReplayGradient {
  addColorStop(offset: number, color: string): void;
}

function rgba(c: Color): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] / 255).toFixed(3)})`;
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

    // ── Effects pass (shadows, blur) ──────────────────────────────
    if (item.effects && item.effects.length > 0) {
      for (const effect of item.effects) {
        if (!effect.visible) continue;
        if (effect.type === 'dropShadow') {
          target.shadowColor = rgba(effect.color);
          target.shadowBlur = effect.blur;
          target.shadowOffsetX = effect.x;
          target.shadowOffsetY = effect.y;
        } else if (effect.type === 'layerBlur') {
          target.filter = `blur(${effect.radius}px)`;
        }
      }
    }

    // ── Item-level opacity and blend ─────────────────────────────
    const itemAlpha = item.opacity ?? 1;
    if (itemAlpha < 1) {
      target.globalAlpha = itemAlpha;
    }
    if (item.blendMode && item.blendMode !== 'normal') {
      target.globalCompositeOperation = mapBlendMode(item.blendMode);
    }

    // ── Fills pass ────────────────────────────────────────────────
    const fills = item.fills;
    if (fills && fills.length > 0) {
      for (const fill of fills) {
        if (!fill.visible) continue;
        // Per-fill opacity multiplies with item alpha.
        if (fill.opacity < 1) {
          target.globalAlpha = itemAlpha * fill.opacity;
        }
        if (fill.blendMode && fill.blendMode !== 'normal') {
          target.globalCompositeOperation = mapBlendMode(fill.blendMode);
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
    default:
      return 'source-over';
  }
}

/** Paint a single fill (solid or gradient) over the primitive shape. */
function paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void {
  if (fill.type === 'solid') {
    target.fillStyle = rgba(fill.color);
  } else if (fill.type === 'gradient') {
    target.fillStyle = createGradientStyle(target, fill, item);
  }
  paintShapeFill(target, item);
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
  const rot = (fill.rotation * Math.PI) / 180;
  const cx = (bounds.x + bounds.w) / 2;
  const cy = (bounds.y + bounds.h) / 2;
  const halfDiag = Math.sqrt(bounds.w * bounds.w + bounds.h * bounds.h) / 2;
  const dx = Math.cos(rot) * halfDiag;
  const dy = Math.sin(rot) * halfDiag;

  if (fill.gradientType === 'radial' && target.createRadialGradient) {
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

  return rgba(stops[0]?.color ?? [0, 0, 0, 0]);
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
      // Image rendering placeholder. Actual `drawImage(src, 0, 0, w, h)`
      // requires an ImageCache with progressive async loading (deferred).
      // The item transform positions the image, so local origin is (0,0).
      target.fillRect(0, 0, p.w, p.h);
      break;
    case 'text':
      paintText(target, p);
      break;
    default:
      break;
  }
}

/** Paint a text primitive via Canvas2D `fillText`. */
function paintText(
  target: ReplayTarget,
  p: Extract<RenderItem['primitive'], { kind: 'text' }>,
): void {
  const style = p.fontStyle === 'italic' ? 'italic ' : '';
  const fw = Math.max(1, Math.min(1000, p.fontWeight));
  target.font = `${style}${fw} ${p.fontSize}px "${p.fontFamily}"`;
  target.textBaseline = 'top';
  target.textAlign = p.textAlign as CanvasTextAlign;
  const xOrigin =
    p.textAlign === 'center' ? p.x + p.w / 2 : p.textAlign === 'right' ? p.x + p.w : p.x;
  target.fillText(p.text, xOrigin, p.y);
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
    if (prev.handleOut && pt.handleIn) {
      target.bezierCurveTo(
        prev.x + prev.handleOut[0],
        prev.y + prev.handleOut[1],
        pt.x + pt.handleIn[0],
        pt.y + pt.handleIn[1],
        pt.x,
        pt.y,
      );
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
      target.strokeRect(p.x, p.y, p.w, p.h);
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
      target.fillStyle = rgba(stroke.color);
      drawArrowhead(target, p.from, p.to, p.arrowheadSize);
      break;
    case 'path':
      target.beginPath();
      target.moveTo(p.points[0]?.x ?? 0, p.points[0]?.y ?? 0);
      for (let i = 1; i < p.points.length; i++) {
        target.lineTo(p.points[i]?.x ?? 0, p.points[i]?.y ?? 0);
      }
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

/** Trace the outline of a primitive without filling. */
function traceOutline(target: ReplayTarget, p: RenderItem['primitive']): void {
  switch (p.kind) {
    case 'ellipse':
      target.ellipse(p.cx, p.cy, p.rx, p.ry, 0, 0, TAU);
      break;
    case 'circle':
      target.arc(p.cx, p.cy, p.r, 0, TAU);
      break;
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
