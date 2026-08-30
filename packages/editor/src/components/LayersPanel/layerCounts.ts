/**
 * Layer-count helpers for the filter bar badge ("N layers" / "M of N layers").
 *
 * Must mirror what the tree actually displays: scoped to the active surface
 * only, and excluding the surface's own contentRoot group (internal plumbing,
 * never shown as a row). `Object.keys(doc.nodes).length` is NOT the right
 * source — `doc.nodes` is a flat map spanning every surface in the document,
 * plus the per-surface contentRoot groups themselves.
 */

import {
  activePageNodes,
  type Document,
  designCanvasChildren,
  isContainer,
  type NodeId,
  type SceneNode,
} from '@varve/scene';

/** All node ids visible on the active surface, recursively (matches tree rows). */
export function collectActiveSurfaceNodeIds(doc: Document, designCanvasId?: NodeId): NodeId[] {
  const ids: NodeId[] = [];
  const queue: NodeId[] = [
    ...(designCanvasId ? designCanvasChildren(doc, designCanvasId) : activePageNodes(doc)),
  ];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = doc.nodes[id];
    if (!node) continue;
    ids.push(id);
    if (isContainer(node) && node.children.length > 0) {
      queue.push(...node.children);
    }
  }
  return ids;
}

/** Total layer count for the active surface (excluding its contentRoot). */
export function computeActiveSurfaceLayerCount(doc: Document, designCanvasId?: NodeId): number {
  return collectActiveSurfaceNodeIds(doc, designCanvasId).length;
}

/** Count of active-surface nodes matching a predicate (e.g. the layer filter). */
export function countActiveSurfaceNodesMatching(
  doc: Document,
  predicate: (node: SceneNode) => boolean,
  designCanvasId?: NodeId,
): number {
  let count = 0;
  for (const id of collectActiveSurfaceNodeIds(doc, designCanvasId)) {
    const node = doc.nodes[id];
    if (node && predicate(node)) count++;
  }
  return count;
}
