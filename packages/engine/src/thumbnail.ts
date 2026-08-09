/**
 * @deprecated Legacy LocalDoc thumbnail path. Superseded by the canonical
 * pipeline: `@varve/scene` source resolution + `flattenSceneToEngine`
 * (editor) + `generateThumbnail` (engine `thumbnail/service.ts`). Retained
 * only until Home and the thumbnail picker migrate; do not add callers.
 */

import { DEFAULT_ARTWORK_FONT_FAMILY, multiplyAffine } from '@varve/shared';
import { createEngine } from './engine';
import { createRasterSurface, encodeRasterSurface } from './rasterSurface';
import { replayIr } from './replay';
import type { Affine, EngineColor, RenderItem, SceneNode, Shape } from './types';

interface LocalNode {
  id: string;
  name: string;
  kind: string;
  shape?: Shape;
  transform?: Affine;
  fill?: EngineColor;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: string;
  w?: number;
  h?: number;
  children?: string[];
  visible?: boolean;
  opacity?: number;
  blendMode?: SceneNode['blendMode'];
  fills?: SceneNode['fills'];
  strokes?: SceneNode['strokes'];
  effects?: SceneNode['effects'];
}

interface LocalDoc {
  id: string;
  name: string;
  nodes: Record<string, LocalNode>;
}

const DEFAULT_THUMB_W = 256;
const DEFAULT_THUMB_H = 192;

function sceneNodeBounds(node: SceneNode): { x: number; y: number; w: number; h: number } | null {
  const shape = node.shape;
  if (shape?.kind === 'rect') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  if (shape?.kind === 'ellipse') {
    return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
  }
  if (shape?.kind === 'circle') {
    return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: shape.r * 2, h: shape.r * 2 };
  }
  if (shape?.kind === 'line') {
    return {
      x: Math.min(shape.from[0], shape.to[0]) - shape.tolerance,
      y: Math.min(shape.from[1], shape.to[1]) - shape.tolerance,
      w: Math.abs(shape.to[0] - shape.from[0]) + shape.tolerance * 2,
      h: Math.abs(shape.to[1] - shape.from[1]) + shape.tolerance * 2,
    };
  }
  if (shape?.kind === 'polygon' || shape?.kind === 'star') {
    const radius = shape.kind === 'polygon' ? shape.radius : shape.outerRadius;
    return { x: shape.cx - radius, y: shape.cy - radius, w: radius * 2, h: radius * 2 };
  }
  if (node.kind === 'text') {
    const size = node.fontSize ?? 16;
    return {
      x: 0,
      y: 0,
      w: node.w ?? Math.max(size, (node.text?.length ?? 1) * size * 0.6),
      h: node.h ?? size * 1.4,
    };
  }
  return null;
}

function transformBounds(
  bounds: { x: number; y: number; w: number; h: number },
  transform: Affine,
): { x: number; y: number; w: number; h: number } {
  const points = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.w, bounds.y],
    [bounds.x, bounds.y + bounds.h],
    [bounds.x + bounds.w, bounds.y + bounds.h],
  ] as const;
  const xs = points.map(([x, y]) => transform[0] * x + transform[2] * y + transform[4]);
  const ys = points.map(([x, y]) => transform[1] * x + transform[3] * y + transform[5]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function computeDocBounds(scene: {
  nodes: SceneNode[];
}): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const node of scene.nodes) {
    const local = sceneNodeBounds(node);
    if (!local) continue;
    const bounds = transformBounds(local, node.transform);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.w);
    maxY = Math.max(maxY, bounds.y + bounds.h);
    found = true;
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function buildThumbnailScene(doc: LocalDoc): { nodes: SceneNode[] } {
  const nodes: SceneNode[] = [];
  const parents = new Map<string, string>();
  for (const node of Object.values(doc.nodes)) {
    for (const childId of node.children ?? []) parents.set(childId, node.id);
  }
  const worldTransforms = new Map<string, Affine>();
  const resolveWorld = (id: string, stack = new Set<string>()): Affine => {
    const cached = worldTransforms.get(id);
    if (cached) return cached;
    if (stack.has(id)) return [1, 0, 0, 1, 0, 0];
    stack.add(id);
    const node = doc.nodes[id];
    const local = node?.transform ?? [1, 0, 0, 1, 0, 0];
    const parentId = parents.get(id);
    const world = parentId ? multiplyAffine(resolveWorld(parentId, stack), local) : local;
    worldTransforms.set(id, world);
    return world;
  };

  for (const node of Object.values(doc.nodes)) {
    if (node.visible === false) continue;
    const transform = resolveWorld(node.id);
    if (node.shape && node.kind === 'shape') {
      nodes.push({
        id: node.id,
        name: node.name,
        transform,
        shape: node.shape,
        fill: node.fill ?? { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
        fills: node.fills,
        strokes: node.strokes,
        effects: node.effects,
        opacity: node.opacity,
        blendMode: node.blendMode,
      });
    } else if (node.kind === 'frame' && node.w !== undefined && node.h !== undefined) {
      nodes.push({
        id: node.id,
        name: node.name,
        kind: 'frame',
        transform,
        shape: { kind: 'rect', x: 0, y: 0, w: node.w, h: node.h },
        fill: node.fill ?? { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
        fills: node.fills,
        strokes: node.strokes,
        effects: node.effects,
        opacity: node.opacity,
        blendMode: node.blendMode,
      });
    } else if (node.kind === 'text') {
      nodes.push({
        id: node.id,
        name: node.name,
        kind: 'text',
        transform,
        text: node.text ?? '',
        w: node.w,
        h: node.h,
        fontSize: node.fontSize ?? 16,
        fontFamily: node.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
        fontWeight: node.fontWeight ?? 400,
        fontStyle: node.fontStyle ?? 'normal',
        fill: node.fill ?? { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
        fills: node.fills,
        opacity: node.opacity,
        blendMode: node.blendMode,
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

  const scene = buildThumbnailScene(doc);
  const bounds = computeDocBounds(scene);
  if (!bounds || bounds.w === 0 || bounds.h === 0) return null;

  const scale = Math.min(maxW / bounds.w, maxH / bounds.h, 1);
  const cw = Math.round(bounds.w * scale);
  const ch = Math.round(bounds.h * scale);

  const surface = createRasterSurface(cw, ch);
  const { context: ctx } = surface;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cw, ch);

  ctx.translate(-bounds.x * scale, -bounds.y * scale);
  ctx.scale(scale, scale);

  const engine = await createEngine('stub');
  const ir: RenderItem[] = await engine.buildIr(scene);
  replayIr(ctx as import('./replay').ReplayTarget, ir);

  const blob = await encodeRasterSurface(surface, 'image/png');
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(blob);
  });
}
