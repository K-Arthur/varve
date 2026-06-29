/**
 * Canvas2D replay of the render IR (the webview side of ADR-0001).
 *
 * This is the exact strategy the task-0.2 spike measured at 86 fps: native Rust
 * computes the scene and emits a compact IR; the webview replays it to a canvas.
 * `ReplayTarget` is a structural slice of CanvasRenderingContext2D so tests can
 * pass a recorder without a real DOM/canvas.
 */
import type { Color, RenderItem } from './types';

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
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillText(text: string, x: number, y: number): void;
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
    target.fillStyle = rgba(item.fill);
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
        const {
          cx: scx,
          cy: scy,
          innerRadius,
          outerRadius,
          points,
          rotation: srot,
        } = item.primitive;
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
      case 'text': {
        const p = item.primitive;
        const fw = Math.max(1, Math.min(1000, p.fontWeight));
        target.font = `${p.fontStyle === 'italic' ? 'italic ' : ''}${fw} ${p.fontSize}px "${p.fontFamily}"`;
        target.textAlign = p.textAlign;
        target.textBaseline = 'top';
        target.fillText(p.text, 0, 0);
        break;
      }
    }
    target.restore();
  }
}
