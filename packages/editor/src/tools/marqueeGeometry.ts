import type { Document, NodeId, SceneNode } from '@varve/scene';
import { applyAffine, type Point } from '@varve/shared';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from '../scene/world';

export interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalize a drag rectangle without rounding document-space coordinates. */
export function normalizeMarqueeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
): MarqueeRect | null {
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

/** Inclusive AABB intersection: touching an object's selection geometry counts. */
export function marqueeRectsIntersect(a: MarqueeRect, b: MarqueeRect): boolean {
  if (![a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h].every(Number.isFinite)) return false;
  if (a.w < 0 || a.h < 0 || b.w < 0 || b.h < 0) return false;
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Closed-boundary containment for continuous world-space geometry. */
export function marqueeRectContainsRect(outer: MarqueeRect, inner: MarqueeRect): boolean {
  if (
    ![outer.x, outer.y, outer.w, outer.h, inner.x, inner.y, inner.w, inner.h].every(Number.isFinite)
  ) {
    return false;
  }
  if (outer.w < 0 || outer.h < 0 || inner.w < 0 || inner.h < 0) return false;
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.w >= inner.x + inner.w &&
    outer.y + outer.h >= inner.y + inner.h
  );
}

function pointInRect(point: Point, rect: MarqueeRect): boolean {
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.w &&
    point[1] >= rect.y &&
    point[1] <= rect.y + rect.h
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const eps = 1e-9;
  if (Math.abs(abC) <= eps && onSegment(a, b, c)) return true;
  if (Math.abs(abD) <= eps && onSegment(a, b, d)) return true;
  if (Math.abs(cdA) <= eps && onSegment(c, d, a)) return true;
  if (Math.abs(cdB) <= eps && onSegment(c, d, b)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function primitivePolygon(
  doc: Document,
  node: SceneNode,
  nodeId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Point[] | null {
  if (node.kind !== 'shape' || !['rect', 'ellipse', 'circle'].includes(node.shape.kind)) {
    return null;
  }
  const local = nodeLocalBounds(node, doc);
  if (!local) return null;
  if (node.shape.kind === 'rect') {
    const corners: Point[] = [
      [local.x, local.y],
      [local.x + local.w, local.y],
      [local.x + local.w, local.y + local.h],
      [local.x, local.y + local.h],
    ];
    return corners.map((point) => applyAffine(nodeWorldTransform(doc, nodeId, parentIndex), point));
  }
  const points: Point[] = [];
  const count = 48;
  const cx = local.x + local.w / 2;
  const cy = local.y + local.h / 2;
  const transform = nodeWorldTransform(doc, nodeId, parentIndex);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push(
      applyAffine(transform, [
        cx + (local.w / 2) * Math.cos(angle),
        cy + (local.h / 2) * Math.sin(angle),
      ]),
    );
  }
  return points;
}

/**
 * Precise primitive phase after the spatial AABB query. Rectangles are exact;
 * ellipses use a 48-sided perimeter approximation. Containers, paths, and
 * effect/stroke bounds retain canonical AABB semantics.
 */
export function marqueeGeometryHit(
  doc: Document,
  nodeId: NodeId,
  marquee: MarqueeRect,
  containment: boolean,
  parentIndex?: Map<NodeId, NodeId>,
): boolean {
  const node = doc.nodes[nodeId];
  const bounds = nodeWorldBounds(doc, nodeId, parentIndex);
  if (!node || !bounds) return false;
  const polygon = primitivePolygon(doc, node, nodeId, parentIndex);
  if (!polygon) {
    return containment
      ? marqueeRectContainsRect(marquee, bounds)
      : marqueeRectsIntersect(marquee, bounds);
  }
  if (containment) return polygon.every((point) => pointInRect(point, marquee));
  if (polygon.some((point) => pointInRect(point, marquee))) return true;
  const marqueeCorners: Point[] = [
    [marquee.x, marquee.y],
    [marquee.x + marquee.w, marquee.y],
    [marquee.x + marquee.w, marquee.y + marquee.h],
    [marquee.x, marquee.y + marquee.h],
  ];
  if (marqueeCorners.some((point) => pointInPolygon(point, polygon))) return true;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    for (let j = 0; j < marqueeCorners.length; j++) {
      const c = marqueeCorners[j]!;
      const d = marqueeCorners[(j + 1) % marqueeCorners.length]!;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

/**
 * A hidden or locked ancestor makes its descendants unavailable to marquee
 * selection, matching the normal hit-test contract. Opacity is intentionally
 * not checked: a transparent node is still an editable object.
 */
export function isMarqueeSelectableNode(
  doc: Document,
  nodeId: NodeId,
  parentIndex: ReadonlyMap<NodeId, NodeId>,
): boolean {
  let current: NodeId | undefined = nodeId;
  while (current) {
    const node = doc.nodes[current] as SceneNode | undefined;
    if (!node || node.locked || node.visible === false) return false;
    current = parentIndex.get(current);
  }
  return true;
}
