import type { Document, NodeId, SceneNode } from '@varve/scene';

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
