/**
 * Canvas2D replay of the render IR (the webview side of ADR-0001).
 *
 * This is the exact strategy the task-0.2 spike measured at 86 fps: native Rust
 * computes the scene and emits a compact IR; the webview replays it to a canvas.
 * `ReplayTarget` is a structural slice of CanvasRenderingContext2D so tests can
 * pass a recorder without a real DOM/canvas.
 */
import type { Color, FillIR, RenderItem } from './types';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface ReplayGradient {
  addColorStop(offset: number, color: string): void;
}

export interface ReplayTarget {
  save(): void;
  restore(): void;
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
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
  fill(): void;
  stroke(): void;
  closePath(): void;
  fillStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
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
}

function rgba(c: Color): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] / 255).toFixed(3)})`;
}

const TAU = Math.PI * 2;

/** Replay `ir` into `target` (a 2D context). Clears nothing; caller manages. */
export function replayIr(target: ReplayTarget, ir: readonly RenderItem[]): void {
  for (const item of ir) {
    target.save();
    target.transform(
      item.transform[0],
      item.transform[1],
      item.transform[2],
      item.transform[3],
      item.transform[4],
      item.transform[5],
    );

    // P2: if fills stack is present, paint each fill bottom→top
    const fills = item.fills;
    if (fills && fills.length > 0) {
      for (const fill of fills) {
        paintFill(target, fill, item);
      }
    } else {
      // Legacy: single fill color
      target.fillStyle = rgba(item.fill);
      paintShape(target, item);
    }

    target.restore();
  }
}

/** Paint a single fill (solid or gradient) over the primitive shape. */
function paintFill(target: ReplayTarget, fill: FillIR, item: RenderItem): void {
  if (!fill.visible) return;

  if (fill.type === 'solid') {
    target.fillStyle = rgba(fill.color);
  } else if (fill.type === 'gradient') {
    target.fillStyle = createGradientStyle(target, fill, item);
  }

  paintShape(target, item);
}

/** Create a gradient fillStyle string from a FillIR gradient. */
function createGradientStyle(
  target: ReplayTarget,
  fill: Extract<FillIR, { type: 'gradient' }>,
  item: RenderItem,
): string {
  const stops = fill.stops;
  if (stops.length === 0) return 'rgba(0,0,0,0)';

  // Compute gradient bounds from the primitive
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

  // Linear gradient (default, also fallback for angular/diamond)
  if (target.createLinearGradient) {
    const grad = target.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    for (const s of stops) {
      grad.addColorStop(s.position, rgba(s.color));
    }
    return grad as unknown as string;
  }

  // Fallback: first stop color
  return rgba(stops[0]?.color ?? [0, 0, 0, 0]);
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
      return {
        x: Math.min(p.from[0], p.to[0]),
        y: Math.min(p.from[1], p.to[1]),
        w: Math.abs(p.to[0] - p.from[0]),
        h: Math.abs(p.to[1] - p.from[1]),
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
    default:
      return { x: 0, y: 0, w: 100, h: 100 };
  }
}

/** Paint the primitive shape (without setting fillStyle). */
function paintShape(target: ReplayTarget, item: RenderItem): void {
  switch (item.primitive.kind) {
    case 'rect':
      target.fillRect(item.primitive.x, item.primitive.y, item.primitive.w, item.primitive.h);
      break;
    case 'ellipse':
      target.beginPath();
      target.ellipse(
        item.primitive.cx,
        item.primitive.cy,
        item.primitive.rx,
        item.primitive.ry,
        0,
        0,
        TAU,
      );
      target.fill();
      break;
    case 'circle':
      target.beginPath();
      target.arc(item.primitive.cx, item.primitive.cy, item.primitive.r, 0, TAU);
      target.fill();
      break;
    case 'line':
      target.lineWidth = item.primitive.tolerance * 2;
      target.lineCap = 'round';
      target.beginPath();
      target.moveTo(item.primitive.from[0], item.primitive.from[1]);
      target.lineTo(item.primitive.to[0], item.primitive.to[1]);
      target.stroke();
      break;
    case 'polygon': {
      target.beginPath();
      const { cx, cy, radius, sides, rotation } = item.primitive;
      for (let i = 0; i < sides; i++) {
        const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
        const px = cx + radius * Math.cos(a);
        const py = cy + radius * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
    case 'star': {
      target.beginPath();
      const { cx: scx, cy: scy, innerRadius, outerRadius, points, rotation: srot } = item.primitive;
      for (let i = 0; i < points * 2; i++) {
        const a = (Math.PI * i) / points - Math.PI / 2 + srot;
        const r = i % 2 === 0 ? outerRadius : innerRadius;
        const px = scx + r * Math.cos(a);
        const py = scy + r * Math.sin(a);
        if (i === 0) target.moveTo(px, py);
        else target.lineTo(px, py);
      }
      target.closePath();
      target.fill();
      break;
    }
  }
}
