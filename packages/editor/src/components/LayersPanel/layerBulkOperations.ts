/**
 * Pure bulk-operation logic for the layers panel: batch lock/visibility/color
 * tagging, and "select all matching" queries. Kept free of React/editor
 * context so it's directly unit-testable — `context.tsx` wraps these in
 * `updateDoc`/`patch` for state wiring and undo-stack integration.
 */

import {
  activePageNodes,
  type Document,
  designCanvasChildren,
  isContainer,
  type LayerColor,
  type NodeId,
  type SceneNode,
} from '@varve/scene';

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
export interface LayerColorScopeOptions {
  designCanvasId?: NodeId | null;
  isolatedNodeId?: NodeId | null;
  masterEditId?: NodeId | null;
}

/**
 * Resolve the same logical surface shown by LayersTree, then walk its
 * descendants. Tags are document metadata, but “select same” must not jump
 * to another page, design canvas, or component master unexpectedly.
 */
export function collectLayerColorScope(
  doc: Document,
  options: LayerColorScopeOptions = {},
): Set<NodeId> {
  let roots: NodeId[];
  if (options.isolatedNodeId && doc.nodes[options.isolatedNodeId]) {
    roots = [options.isolatedNodeId];
  } else if (options.masterEditId && doc.masters?.[options.masterEditId]) {
    const master = doc.masters[options.masterEditId];
    const root = master ? doc.nodes[master.contentRoot] : undefined;
    roots = root && isContainer(root) ? root.children : [];
  } else {
    roots = options.designCanvasId
      ? designCanvasChildren(doc, options.designCanvasId)
      : activePageNodes(doc);
    if (!options.designCanvasId && doc.activePageId) {
      const pageContentRoots = new Set((doc.pages ?? []).map((page) => page.contentRoot));
      roots = [
        ...roots,
        ...doc.rootChildren.filter((id) => {
          const node = doc.nodes[id];
          return node && !pageContentRoots.has(id) && node.kind !== 'group';
        }),
      ];
    }
  }

  const ids = new Set<NodeId>();
  const pending = [...roots];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || ids.has(id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    ids.add(id);
    if (isContainer(node)) pending.push(...node.children);
  }
  return ids;
}

export function findSameLayerColorIds(
  doc: Document,
  selection: NodeId[],
  scope?: ReadonlySet<NodeId>,
): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetColor = firstNode.layerColor;
  // “No color tag” is a useful filter state, but it is not a tag to select
  // across the surface. Avoid turning an untagged context-menu action into a
  // surprising select-everything operation.
  if (!targetColor) return [];
  if (scope && !scope.has(firstNode.id)) return [];
  const matches: NodeId[] = [];
  const candidates = scope ? [...scope].map((id) => doc.nodes[id]) : Object.values(doc.nodes);
  for (const n of candidates) {
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
