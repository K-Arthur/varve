/**
 * Layer-count helpers for the filter bar badge ("N layers" / "M of N layers").
 *
 * Must mirror what the tree actually displays: scoped to the active page
 * only, and excluding the page's own contentRoot group (internal plumbing,
 * never shown as a row). `Object.keys(doc.nodes).length` is NOT the right
 * source — `doc.nodes` is a flat map spanning every page in the document,
 * plus the per-page contentRoot groups themselves.
 */

import {
  activePageNodes,
  type Document,
  isContainer,
  type NodeId,
  type SceneNode,
} from '@strata/scene';

/** All node ids visible on the active page, recursively (matches tree rows). */
export function collectActivePageNodeIds(doc: Document): NodeId[] {
  const ids: NodeId[] = [];
  const queue: NodeId[] = [...activePageNodes(doc)];
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

/** Total layer count for the active page (recursively, excluding the contentRoot itself). */
export function computeActivePageLayerCount(doc: Document): number {
  return collectActivePageNodeIds(doc).length;
}

/** Count of active-page nodes matching a predicate (e.g. the layer filter). */
export function countActivePageNodesMatching(
  doc: Document,
  predicate: (node: SceneNode) => boolean,
): number {
  let count = 0;
  for (const id of collectActivePageNodeIds(doc)) {
    const node = doc.nodes[id];
    if (node && predicate(node)) count++;
  }
  return count;
}
