/**
 * Scene-level flatten operations — pure document mutations for the
 * unified flatten system. These functions take a document and return
 * a new document with the flatten result applied.
 *
 * Each operation is immutable: the input document is never mutated.
 * The caller is responsible for wiring these into undo/redo via
 * `updateDoc`.
 */

import type { Document } from '../document';
import { getParent } from '../document';
import { imageFill } from '../fills';
import type { NodeId, SceneNode, ShapeNode } from '../types';

export interface FlattenReplacement {
  nodeId: NodeId;
  bounds: { x: number; y: number; w: number; h: number };
  dataUrl: string;
  assetId: string;
  placement: { dx: number; dy: number };
  cssWidth: number;
  cssHeight: number;
}

function createFlattenedShape(replacement: FlattenReplacement, name: string): ShapeNode {
  return {
    id: replacement.nodeId,
    kind: 'shape',
    name,
    layerColor: null,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, replacement.placement.dx, replacement.placement.dy],
    fills: [
      imageFill(replacement.dataUrl, {
        assetId: replacement.assetId,
        fit: 'fill',
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      }),
    ],
    strokes: [],
    effects: [],
    shape: {
      kind: 'rect',
      x: 0,
      y: 0,
      w: replacement.bounds.w,
      h: replacement.bounds.h,
    },
  };
}

/**
 * Replace a set of nodes with a single flattened ShapeNode containing
 * an image fill. The original nodes are removed from the document.
 *
 * @param doc The source document (not mutated)
 * @param nodeIds The IDs of nodes to replace (must all share a common parent)
 * @param replacement The flatten result from the engine service
 * @returns A new document with the replacement applied
 */
export function replaceNodesWithFlattened(
  doc: Document,
  nodeIds: readonly NodeId[],
  replacement: FlattenReplacement,
): Document {
  if (nodeIds.length === 0) return doc;

  const parentId = findCommonParent(doc, nodeIds);
  const nodeSet = new Set(nodeIds);

  // Determine insertion order (use the minimum order of the replaced nodes)
  const orders = nodeIds
    .map((id) => doc.nodes[id]?.order)
    .filter((o): o is string => typeof o === 'string' && o.length > 0);
  const insertOrder = orders.length > 0 ? orders.reduce((min, o) => (o < min ? o : min)) : 'a0';

  const shapeNode: ShapeNode = {
    ...createFlattenedShape(replacement, 'Flattened'),
    order: insertOrder,
  };

  const newNodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (nodeSet.has(id as NodeId)) continue;
    newNodes[id] = node;
  }
  newNodes[replacement.nodeId] = shapeNode;

  let newDoc: Document = { ...doc, nodes: newNodes as Document['nodes'] };

  // Remove from parent's children array or rootChildren
  if (parentId) {
    const parent = newDoc.nodes[parentId];
    if (parent && 'children' in parent) {
      const newChildren = parent.children.filter((c) => !nodeSet.has(c));
      // Insert replacement at the position of the first removed child
      const firstIndex = parent.children.findIndex((c) => nodeSet.has(c));
      if (firstIndex >= 0) {
        newChildren.splice(firstIndex, 0, replacement.nodeId);
      } else {
        newChildren.push(replacement.nodeId);
      }
      newDoc = {
        ...newDoc,
        nodes: {
          ...newDoc.nodes,
          [parentId]: { ...parent, children: newChildren },
        } as Document['nodes'],
      };
    }
  } else {
    // Root level
    const newRootChildren = doc.rootChildren.filter((c) => !nodeSet.has(c));
    const firstIndex = doc.rootChildren.findIndex((c) => nodeSet.has(c));
    if (firstIndex >= 0) {
      newRootChildren.splice(firstIndex, 0, replacement.nodeId);
    } else {
      newRootChildren.push(replacement.nodeId);
    }
    newDoc = { ...newDoc, rootChildren: newRootChildren };
  }

  return newDoc;
}

/**
 * Insert a rasterized copy without discarding the editable source subtree.
 * The source nodes are hidden so transparent edges are not composited twice;
 * they remain in the document and can be revealed or edited at any time.
 */
export function insertFlattenedCopy(
  doc: Document,
  nodeIds: readonly NodeId[],
  replacement: FlattenReplacement,
): Document {
  if (nodeIds.length === 0) return doc;

  const parentId = findCommonParent(doc, nodeIds);
  const nodeSet = new Set(nodeIds);
  const parentChildren = parentId
    ? doc.nodes[parentId] && 'children' in doc.nodes[parentId]
      ? doc.nodes[parentId].children
      : []
    : doc.rootChildren;
  const firstIndex = parentChildren.findIndex((id) => nodeSet.has(id));
  const insertIndex = firstIndex >= 0 ? firstIndex : parentChildren.length;
  const nextChildren = [...parentChildren];
  nextChildren.splice(insertIndex, 0, replacement.nodeId);

  const newNodes: Record<string, SceneNode> = {
    ...doc.nodes,
    [replacement.nodeId]: createFlattenedShape(replacement, 'Rasterized Copy'),
  };
  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (node) newNodes[nodeId] = { ...node, visible: false };
  }

  if (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent || !('children' in parent)) return doc;
    newNodes[parentId] = { ...parent, children: nextChildren };
    return { ...doc, nodes: newNodes as Document['nodes'] };
  }
  return {
    ...doc,
    nodes: newNodes as Document['nodes'],
    rootChildren: nextChildren,
  };
}

/**
 * Merge a set of nodes into a single new node (for "merge selected" / "merge visible").
 * Similar to replaceNodesWithFlattened but uses a different naming convention
 * and can merge into an existing node rather than creating a new one.
 */
export function mergeNodes(
  doc: Document,
  nodeIds: readonly NodeId[],
  replacement: FlattenReplacement,
  targetNodeId?: NodeId,
): Document {
  if (nodeIds.length === 0) return doc;

  const nodeSet = new Set(nodeIds);
  const mergeTargetId = targetNodeId ?? replacement.nodeId;

  const shapeNode: ShapeNode = {
    ...createFlattenedShape(replacement, 'Merged'),
    id: mergeTargetId,
  };

  const newNodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (nodeSet.has(id as NodeId) && id !== mergeTargetId) continue;
    newNodes[id] = node;
  }
  newNodes[mergeTargetId] = shapeNode;

  return { ...doc, nodes: newNodes as Document['nodes'] };
}

/** Find the common parent for a set of nodes. Returns null if they're at root level. */
function findCommonParent(doc: Document, nodeIds: readonly NodeId[]): NodeId | null {
  if (nodeIds.length === 0) return null;

  const parents = new Map<NodeId, NodeId | null>();
  for (const id of nodeIds) {
    parents.set(id, getParent(doc, id));
  }

  // If all share the same parent, return it
  const uniqueParents = new Set(parents.values());
  if (uniqueParents.size === 1) {
    return parents.get(nodeIds[0]!) ?? null;
  }

  // Otherwise find the deepest common ancestor
  const getAncestors = (id: NodeId): NodeId[] => {
    const chain: NodeId[] = [];
    let current: NodeId | null = id;
    const visited = new Set<NodeId>();
    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      current = getParent(doc, current);
    }
    return chain;
  };

  const firstChain = getAncestors(nodeIds[0]!);
  const firstSet = new Set(firstChain);

  let deepest: NodeId | null = null;
  let deepestDepth = -1;
  for (let i = 1; i < nodeIds.length; i++) {
    const chain = getAncestors(nodeIds[i]!);
    for (let depth = 0; depth < chain.length; depth++) {
      const ancestor = chain[depth]!;
      if (firstSet.has(ancestor) && depth > deepestDepth) {
        deepest = ancestor;
        deepestDepth = depth;
      }
    }
  }

  return deepest;
}
