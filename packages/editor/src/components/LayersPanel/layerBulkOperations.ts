/**
 * Pure bulk-operation logic for the layers panel: batch lock/visibility/color
 * tagging, and "select all matching" queries. Kept free of React/editor
 * context so it's directly unit-testable — `context.tsx` wraps these in
 * `updateDoc`/`patch` for state wiring and undo-stack integration.
 */

import type { Document, LayerColor, NodeId, SceneNode } from '@varve/scene';

export function bulkSetNodeLockedDoc(doc: Document, ids: NodeId[], locked: boolean): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = { ...node, locked } as SceneNode;
  }
  return { ...doc, nodes };
}

export function bulkSetNodeVisibleDoc(doc: Document, ids: NodeId[], visible: boolean): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = { ...node, visible } as SceneNode;
  }
  return { ...doc, nodes };
}

export function bulkSetLayerColorDoc(doc: Document, ids: NodeId[], color: LayerColor): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    nodes[id] = { ...node, layerColor: color } as SceneNode;
  }
  return { ...doc, nodes };
}

/**
 * Node ids sharing the first selected node's kind, restricted to visible +
 * unlocked nodes, including the first id itself. Empty array when the
 * selection is empty, the first node doesn't exist, or nothing else matches.
 */
export function findSameKindIds(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetKind = firstNode.kind;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n && n.kind === targetKind && n.visible && !n.locked && n.id !== firstNode.id) {
      matches.push(n.id);
    }
  }
  return matches.length > 0 ? [firstNode.id, ...matches] : [];
}

/**
 * Node ids sharing the first selected node's layerColor tag, restricted to
 * visible + unlocked nodes, including the first id itself. Empty array when
 * nothing else matches (mirrors findSameKindIds' contract).
 */
export function findSameLayerColorIds(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetColor = firstNode.layerColor;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n?.visible && !n.locked && n.id !== firstNode.id && n.layerColor === targetColor) {
      matches.push(n.id);
    }
  }
  return matches.length > 0 ? [firstNode.id, ...matches] : [];
}

/**
 * ALL node ids sharing the first selected node's kind — including hidden and
 * locked nodes, unlike findSameKindIds. Includes the first id itself.
 */
export function findAllOfKindIds(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetKind = firstNode.kind;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n && n.kind === targetKind && n.id !== firstNode.id) {
      matches.push(n.id);
    }
  }
  return matches.length > 0 ? [firstNode.id, ...matches] : [];
}
