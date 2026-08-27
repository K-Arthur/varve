/**
 * Measurement math for the Spec Panel — world-space AABB computation, edge
 * distances, and center-to-center measurements for redline overlay.
 *
 * Every function is pure TS, no DOM dependency. Builds on engine geometry
 * helpers (applyAffine, invertAffine).
 *
 * Research basis: CSS Box Model (W3C); Figma Dev Mode measurement UX.
 */

import type { Affine, Point, Shape } from '@varve/engine';
import { applyAffine } from '@varve/engine';
import type { ContainerNode, Document, SceneNode } from '@varve/scene';
import { textNodeLocalBounds } from '@varve/scene';
import { nodeWorldBounds } from '../../scene/world';

export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

function polygonVertices(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2 + rotation;
    verts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return verts;
}

function starVertices(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  points: number,
  rotation: number,
): Point[] {
  const verts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points - Math.PI / 2 + rotation;
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    verts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return verts;
}

function pointsAABB(pts: Point[]): AABB {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function shapeLocalBBox(shape: Shape): AABB {
  switch (shape.kind) {
    case 'rect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'ellipse':
      return {
        x: shape.cx - shape.rx,
        y: shape.cy - shape.ry,
        w: shape.rx * 2,
        h: shape.ry * 2,
      };
    case 'circle': {
      const d = shape.r * 2;
      return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: d, h: d };
    }
    case 'line': {
      const from = shape.from;
      const to = shape.to;
      const x0 = Math.min(from[0], to[0]) - shape.tolerance;
      const y0 = Math.min(from[1], to[1]) - shape.tolerance;
      const x1 = Math.max(from[0], to[0]) + shape.tolerance;
      const y1 = Math.max(from[1], to[1]) + shape.tolerance;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'polygon':
      return pointsAABB(
        polygonVertices(shape.cx, shape.cy, shape.radius, shape.sides, shape.rotation),
      );
    case 'star':
      return pointsAABB(
        starVertices(
          shape.cx,
          shape.cy,
          shape.innerRadius,
          shape.outerRadius,
          shape.points,
          shape.rotation,
        ),
      );
    case 'arrow': {
      const from = shape.from;
      const to = shape.to;
      const x0 = Math.min(from[0], to[0]) - shape.tolerance;
      const y0 = Math.min(from[1], to[1]) - shape.tolerance;
      const x1 = Math.max(from[0], to[0]) + shape.tolerance;
      const y1 = Math.max(from[1], to[1]) + shape.tolerance;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    case 'path':
      if (shape.points.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
      return pointsAABB(shape.points.map((p) => [p.x, p.y] as [number, number]));
    default:
      return { x: 0, y: 0, w: 0, h: 0 };
  }
}

function approximateTextBBox(node: SceneNode): AABB | null {
  if (node.kind !== 'text') return null;
  // Redlining is a measurement surface; the number it prints has to be the
  // number the canvas draws, not a character count.
  return textNodeLocalBounds(node);
}

export function getAccumulatedTransform(
  doc: Document,
  nodeId: string,
  nodeTransform?: Affine,
): Affine {
  const nodeTransform_ = nodeTransform ?? ([1, 0, 0, 1, 0, 0] as Affine);

  const parents: SceneNode[] = [];
  let currentId: string | null = nodeId;
  let maxDepth = 100;
  while (currentId && maxDepth > 0) {
    currentId = getParent(doc, currentId);
    if (currentId) {
      const p = doc.nodes[currentId];
      if (p) parents.push(p);
    }
    maxDepth--;
  }

  let result: Affine = nodeTransform_;
  for (const p of parents) {
    result = composeAffine(p.transform as Affine, result);
  }
  return result;
}

function composeAffine(a: Affine, b: Affine): Affine {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ] as Affine;
}

function applyAffineToAABB(m: Affine, bbox: AABB): AABB {
  const corners: Point[] = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.w, bbox.y],
    [bbox.x + bbox.w, bbox.y + bbox.h],
    [bbox.x, bbox.y + bbox.h],
  ];
  const transformed = corners.map((p) => applyAffine(m, p));
  return pointsAABB(transformed);
}

function getParent(doc: Document, id: string): string | null {
  for (const n of Object.values(doc.nodes)) {
    if (n.kind === 'frame' || n.kind === 'group') {
      const container = n as ContainerNode;
      if (container.children?.includes(id)) return n.id;
    }
  }
  return null;
}

export function worldBBox(node: SceneNode, doc: Document): AABB {
  // Measurement, selection, zoom-to-fit, and export must share one world
  // geometry contract. Frames carry explicit dimensions, area text carries
  // its container, and groups are the union of their descendants.
  if (doc.nodes[node.id]) {
    const canonical = nodeWorldBounds(doc, node.id);
    if (canonical) return canonical;
  }

  const localBBox =
    node.kind === 'shape'
      ? shapeLocalBBox(node.shape)
      : node.kind === 'text'
        ? (approximateTextBBox(node) ?? { x: 0, y: 0, w: 100, h: 20 })
        : node.kind === 'frame'
          ? { x: 0, y: 0, w: node.w, h: node.h }
          : { x: 0, y: 0, w: 0, h: 0 };

  const world = getAccumulatedTransform(doc, node.id, node.transform as Affine);
  return applyAffineToAABB(world, localBBox);
}

export function edgeDistance(
  a: AABB,
  b: AABB,
): { left: number; right: number; top: number; bottom: number } {
  return {
    left: b.x - (a.x + a.w),
    right: a.x - (b.x + b.w),
    top: b.y - (a.y + a.h),
    bottom: a.y - (b.y + b.h),
  };
}

export function centerToCenter(a: AABB, b: AABB): { dx: number; dy: number; distance: number } {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  const dx = bx - ax;
  const dy = by - ay;
  return { dx, dy, distance: Math.sqrt(dx * dx + dy * dy) };
}
