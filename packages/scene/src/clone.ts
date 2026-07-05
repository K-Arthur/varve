/**
 * Deep-clone a subtree rooted at a given node.
 *
 * All descendants get new IDs. Parent-child relationships, slots, masks,
 * and other node-to-node references are remapped.
 */
import { isContainer, nextNodeId } from './document';
import type { ContainerNode, FrameNode, GroupNode, NodeId, SceneNode } from './types';
import type { Document } from './document';

export interface CloneResult {
  nodes: Record<NodeId, SceneNode>;
  idMap: Map<NodeId, NodeId>;
  rootId: NodeId;
  /** The next available ID counter after cloning (caller should sync this). */
  nextId: number;
}

/**
 * Deep-clone a subtree rooted at `rootId`.
 *
 * All descendants get new IDs via nextNodeId.
 * Returns the cloned nodes map, a mapping of old→new IDs, and the new root ID.
 *
 * The caller is responsible for adding the cloned nodes to a document
 * and updating any external references.
 */
export function deepCloneSubtree(doc: Document, rootId: NodeId): CloneResult {
  const idMap = new Map<NodeId, NodeId>();
  const newNodes: Record<NodeId, SceneNode> = {};
  let currentDoc = doc;

  function walkNode(nid: NodeId): NodeId | null {
    const node = currentDoc.nodes[nid];
    if (!node) return null;
    if (idMap.has(nid)) return idMap.get(nid)!;

    const { id: newId, doc: d2 } = nextNodeId(currentDoc);
    currentDoc = d2;
    idMap.set(nid, newId);

    let cloned: SceneNode;

    if (isContainer(node)) {
      const container = node as ContainerNode;
      const clonedChildren = container.children
        .map((c) => walkNode(c))
        .filter((c): c is NodeId => c !== null);

      // Clone the container with remapped children
      cloned = { ...node, id: newId, children: clonedChildren } as SceneNode;

      // Remap slots on frames
      if ('slots' in container && container.slots) {
        const remappedSlots: Record<string, NodeId> = {};
        for (const [slotId, childId] of Object.entries(container.slots)) {
          const newChildId = idMap.get(childId);
          if (newChildId) {
            remappedSlots[slotId] = newChildId;
          }
        }
        (cloned as FrameNode).slots =
          Object.keys(remappedSlots).length > 0 ? remappedSlots : undefined;
      }

      // Remap mask reference
      if ('mask' in container && container.mask) {
        const mask = container.mask;
        const newSourceId = idMap.get(mask.sourceNodeId);
        if (newSourceId) {
          (cloned as FrameNode | GroupNode).mask = {
            ...mask,
            sourceNodeId: newSourceId,
          };
        }
      }
    } else {
      // Leaf node: simple id replacement
      cloned = { ...node, id: newId } as SceneNode;
    }

    newNodes[newId] = cloned;
    return newId;
  }

  const newRootId = walkNode(rootId);

  if (!newRootId) {
    return { nodes: {}, idMap, rootId, nextId: currentDoc.nextId };
  }

  return { nodes: newNodes, idMap, rootId: newRootId, nextId: currentDoc.nextId };
}
