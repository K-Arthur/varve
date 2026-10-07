import {
  buildParentIndexMap,
  type Document,
  type NodeId,
  nodeWorldBounds,
  nodeWorldTransform,
  resolveAdjustmentScope,
  type SceneNode,
} from '@varve/scene';
import { type Rect, transformRect } from '@varve/shared';

function unionBounds(current: Rect | null, next: Rect): Rect {
  if (!current) return next;
  const x = Math.min(current.x, next.x);
  const y = Math.min(current.y, next.y);
  return {
    x,
    y,
    w: Math.max(current.x + current.w, next.x + next.w) - x,
    h: Math.max(current.y + current.h, next.y + next.h) - y,
  };
}

function collectWorldBounds(
  node: SceneNode,
  doc: Document,
  parents: Map<NodeId, NodeId>,
  visited: Set<NodeId>,
): Rect | null {
  if (visited.has(node.id) || node.visible === false) return null;
  visited.add(node.id);
  // Frames own their background and clip rectangle; groups own no geometry.
  let bounds = node.kind === 'group' ? null : nodeWorldBounds(doc, node.id, parents);
  if (node.kind === 'frame' && node.clipContent !== false) return bounds;
  const children =
    node.kind === 'frame' || node.kind === 'group'
      ? node.children
      : node.kind === 'adjustment'
        ? resolveAdjustmentScope(doc, node.scope, node.id)
        : [];
  for (const id of children) {
    const child = doc.nodes[id];
    if (!child) continue;
    const childBounds = collectWorldBounds(child, doc, parents, visited);
    if (childBounds) bounds = unionBounds(bounds, childBounds);
  }
  return bounds;
}

/** Crop the real world-space replay, including frame backgrounds and unclipped overflow. */
export function rasterBoundaryBounds(
  node: SceneNode,
  doc: Document,
  parents = buildParentIndexMap(doc),
): Rect {
  return (
    collectWorldBounds(node, doc, parents, new Set()) ??
    transformRect(nodeWorldTransform(doc, node.id, parents), { x: 0, y: 0, w: 200, h: 160 })
  );
}
