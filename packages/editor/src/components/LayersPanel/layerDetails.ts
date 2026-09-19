import type { Document, NodeId, SceneNode } from '@varve/scene';
import { getParentFast, type ParentIndexCache } from '../../scene/parentIndexCache';

/** Return the visible surface-to-layer path without changing the camera. */
export function layerAncestry(
  doc: Document,
  nodeId: NodeId,
  parentCache?: ParentIndexCache | null,
): SceneNode[] {
  const path: SceneNode[] = [];
  let current: NodeId | null = nodeId;
  const seen = new Set<NodeId>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = doc.nodes[current];
    if (!node) break;
    path.push(node);
    current = getParentFast(doc, current, parentCache);
  }
  return path.reverse();
}

export function layerIdentity(node: SceneNode): string {
  return node.name.trim() || 'Unnamed layer';
}
