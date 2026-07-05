/**
 * Mask resolution for the scene graph.
 *
 * A mask is a property on a container (FrameNode or GroupNode) that designates
 * one of its children as a mask source. The mask type determines how the child
 * is used:
 *   - 'clip': the mask child's outline clips the container's other children
 *   - 'alpha': the mask child's alpha channel modulates the container's
 *     other children (deferred — requires render-time compositing)
 *
 * Research basis: Figma mask model (Fill → Mask, alpha/vector masks),
 * Adobe Illustrator clipping masks.
 */
import type { Document } from './document';
import type { Mask, NodeId, SceneNode } from './types';

/** Return the effective mask for a container node, or null if no mask is set. */
export function resolveMask(node: SceneNode): Mask | null {
  if (node.kind !== 'frame' && node.kind !== 'group') return null;
  const container = node as SceneNode & { mask?: Mask; children: string[] };
  if (!container.mask) return null;
  if (!container.children.includes(container.mask.sourceNodeId)) return null;
  return container.mask;
}

/** True if the container has an active (visible, valid) mask. */
export function isMasked(node: SceneNode): boolean {
  const mask = resolveMask(node);
  return mask ? mask.visible : false;
}

/**
 * Find all nodes whose mask references the given sourceNodeId.
 */
export function findNodesUsingMaskSource(doc: Document, sourceId: NodeId): NodeId[] {
  const result: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      result.push(id as NodeId);
    }
  }
  return result;
}

/**
 * Remove mask references to the given source node from all container nodes.
 * Returns a new Document with the masks cleared.
 */
export function clearMaskSource(doc: Document, sourceId: NodeId): Document {
  let nodes = { ...doc.nodes };
  for (const [id, node] of Object.entries(nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId === sourceId) {
      const { mask: _unused, ...rest } = n;
      nodes = { ...nodes, [id]: rest as SceneNode };
    }
  }
  return { ...doc, nodes };
}

/**
 * Validate that no mask references point to non-existent nodes.
 * Returns list of NodeIds with dangling mask references.
 */
export function validateMasks(doc: Document): NodeId[] {
  const dangling: NodeId[] = [];
  for (const [id, node] of Object.entries(doc.nodes)) {
    const n = node as SceneNode & { mask?: Mask };
    if (n.mask?.sourceNodeId && !doc.nodes[n.mask.sourceNodeId]) {
      dangling.push(id as NodeId);
    }
  }
  return dangling;
}

/**
 * Check if a node is used as a mask source.
 */
export function isMaskSource(doc: Document, sourceId: NodeId): boolean {
  return findNodesUsingMaskSource(doc, sourceId).length > 0;
}
