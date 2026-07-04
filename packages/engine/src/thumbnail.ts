import { createEngine } from './engine';
import { replayIr } from './replay';
import type { Affine, EngineColor, RenderItem, Shape } from './types';

interface LocalNode {
  id: string;
  name: string;
  kind: string;
  shape?: Shape;
  transform?: Affine;
  fill?: EngineColor;
  text?: string;
  fontSize?: number;
}

interface LocalDoc {
  id: string;
  name: string;
  nodes: Record<string, LocalNode>;
}

const DEFAULT_THUMB_W = 256;
const DEFAULT_THUMB_H = 192;

function computeDocBounds(doc: LocalDoc): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const node of Object.values(doc.nodes)) {
    const tx = node.transform?.[4] ?? 0;
    const ty = node.transform?.[5] ?? 0;
    const s = node.shape;

    if (s) {
      if (s.kind === 'rect') {
        minX = Math.min(minX, tx + s.x);
        minY = Math.min(minY, ty + s.y);
        maxX = Math.max(maxX, tx + s.x + s.w);
        maxY = Math.max(maxY, ty + s.y + s.h);
        found = true;
      } else if (s.kind === 'ellipse' || s.kind === 'circle') {
        const r = s.kind === 'ellipse' ? Math.max(s.rx, s.ry) : s.r;
        minX = Math.min(minX, tx + s.cx - r);
        minY = Math.min(minY, ty + s.cy - r);
        maxX = Math.max(maxX, tx + s.cx + r);
        maxY = Math.max(maxY, ty + s.cy + r);
        found = true;
      } else if (s.kind === 'line') {
        minX = Math.min(minX, tx + Math.min(s.from[0], s.to[0]) - s.tolerance);
        minY = Math.min(minY, ty + Math.min(s.from[1], s.to[1]) - s.tolerance);
        maxX = Math.max(maxX, tx + Math.max(s.from[0], s.to[0]) + s.tolerance);
        maxY = Math.max(maxY, ty + Math.max(s.from[1], s.to[1]) + s.tolerance);
        found = true;
      } else if (s.kind === 'polygon' || s.kind === 'star') {
        const r = s.kind === 'polygon' ? s.radius : s.outerRadius;
        minX = Math.min(minX, tx + s.cx - r);
        minY = Math.min(minY, ty + s.cy - r);
        maxX = Math.max(maxX, tx + s.cx + r);
        maxY = Math.max(maxY, ty + s.cy + r);
        found = true;
      }
    }

    if (node.kind === 'text') {
      minX = Math.min(minX, tx);
      minY = Math.min(minY, ty);
      maxX = Math.max(maxX, tx + (node.text?.length ?? 10) * (node.fontSize ?? 16) * 0.6);
      maxY = Math.max(maxY, ty + (node.fontSize ?? 16) * 1.4);
      found = true;
    }
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function buildScene(doc: LocalDoc): { nodes: import('./types').SceneNode[] } {
  const nodes: import('./types').SceneNode[] = [];
  for (const node of Object.values(doc.nodes)) {
    if (node.shape && node.kind === 'shape') {
      nodes.push({
        id: node.id,
        name: node.name,
        transform: node.transform ?? ([1, 0, 0, 1, 0, 0] as Affine),
        shape: node.shape,
        fill: node.fill ?? { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      });
    }
  }
  return { nodes };
}

export interface ThumbnailOptions {
  maxW?: number;
  maxH?: number;
  bg?: string;
}

export async function renderThumbnail(
  doc: LocalDoc,
  options: ThumbnailOptions = {},
): Promise<string | null> {
  const { maxW = DEFAULT_THUMB_W, maxH = DEFAULT_THUMB_H, bg = 'transparent' } = options;

  const bounds = computeDocBounds(doc);
  if (!bounds || bounds.w === 0 || bounds.h === 0) return null;

  const scale = Math.min(maxW / bounds.w, maxH / bounds.h, 1);
  const cw = Math.round(bounds.w * scale);
  const ch = Math.round(bounds.h * scale);

  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

  if (typeof OffscreenCanvas !== 'undefined') {
    const oc = new OffscreenCanvas(cw, ch);
    const ocCtx = oc.getContext('2d');
    if (ocCtx) {
      canvas = oc;
      ctx = ocCtx;
    }
  }

  if (!ctx) {
    const el = document.createElement('canvas');
    el.width = cw;
    el.height = ch;
    canvas = el;
    ctx = el.getContext('2d');
  }

  if (!ctx || !canvas) return null;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  ctx.translate(-bounds.x * scale, -bounds.y * scale);
  ctx.scale(scale, scale);

  const scene = buildScene(doc);
  const engine = await createEngine('stub');
  const ir: RenderItem[] = await engine.buildIr(scene);
  replayIr(ctx as import('./replay').ReplayTarget, ir);

  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  }

  return (canvas as HTMLCanvasElement).toDataURL('image/png');
}
