import type { Document } from './document';
import { isContainer, type SceneNode } from './types';

/**
 * Solo View — a reversible, undo-friendly focus mode.
 *
 * When at least one node in the document is soloed, only soloed nodes are
 * effectively visible; every other node is hidden for display. `solo` is a
 * plain boolean on each node (see `NodeBase.solo`), so it integrates with the
 * normal undo/redo and document-update machinery without a separate overlay
 * state. The helpers here centralise the "is anything soloed?" and
 * "is this node effectively visible under solo?" computations so the Layers
 * panel and (eventually) the renderer agree on a single source of truth.
 */

/** True when any node in the document is soloed. */
export function documentHasSolo(doc: Document): boolean {
  for (const node of Object.values(doc.nodes)) {
    if (node && (node as SceneNode).solo) return true;
  }
  return false;
}

/**
 * Effective visibility of a node under a solo context.
 *
 * A node is effectively visible only if it is explicitly `visible` AND
 * (nothing is soloed OR this node is the soloed one).
 */
export function nodeSoloVisible(node: SceneNode, hasSolo: boolean): boolean {
  if (!node.visible) return false;
  if (!hasSolo) return true;
  return node.solo === true;
}

/**
 * Return a shallow-cloned document whose `visible` flags reflect the solo
 * state, suitable for feeding the renderer without mutating the source
 * document. When nothing is soloed, the original document reference is
 * returned untouched.
 */
export function applySoloToDocument(doc: Document): Document {
  if (!documentHasSolo(doc)) return doc;
  const parentByChild = new Map<string, string>();
  for (const node of Object.values(doc.nodes)) {
    if (!node || !isContainer(node)) continue;
    for (const childId of node.children) parentByChild.set(childId, node.id);
  }

  // Keep soloed containers' descendants and every soloed node's ancestor
  // chain visible. Otherwise soloing a child would hide its group before the
  // renderer can reach it, and soloing a group would render an empty shell.
  const renderable = new Set<string>();
  const addSubtree = (rootId: string): void => {
    const pending = [rootId];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (renderable.has(id)) continue;
      renderable.add(id);
      const node = doc.nodes[id];
      if (!node || !isContainer(node)) continue;
      for (const childId of node.children) pending.push(childId);
    }
  };
  for (const node of Object.values(doc.nodes)) {
    if (!node?.solo) continue;
    addSubtree(node.id);
    let parentId = parentByChild.get(node.id);
    while (parentId) {
      renderable.add(parentId);
      parentId = parentByChild.get(parentId);
    }
  }

  const nodes = { ...doc.nodes };
  for (const id of Object.keys(nodes)) {
    const node = nodes[id]!;
    if (!node.visible || !renderable.has(id)) {
      nodes[id] = { ...node, visible: false } as SceneNode;
    }
  }
  return { ...doc, nodes };
}
