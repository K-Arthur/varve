/**
 * Table document operations for the editor layer — thin adapters that run
 * an immutable table-model op through the normal undoable updateDoc path.
 */
import type { Document, SceneNode, TableModel } from '@varve/scene';

export function updateTableCellTextInDoc(doc: Document, cellId: string, text: string): Document {
  const nodes = doc.nodes;
  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node.kind !== 'table') continue;
    const cell = node.table.cells[cellId];
    if (!cell) continue;
    const table: TableModel = {
      ...node.table,
      cells: {
        ...node.table.cells,
        [cellId]: { ...cell, content: { kind: 'text', text } },
      },
    };
    return {
      ...doc,
      nodes: { ...nodes, [nodeId]: { ...node, table } as SceneNode },
    };
  }
  return doc;
}

/** Apply a table-model op to the node that owns `tableId`. */
export function applyTableModelOp(
  doc: Document,
  tableId: string,
  op: (model: TableModel) => TableModel,
): Document {
  const node = doc.nodes[tableId];
  if (node?.kind !== 'table') return doc;
  const table = op(node.table);
  if (table === node.table) return doc;
  return {
    ...doc,
    nodes: { ...doc.nodes, [tableId]: { ...node, table } as SceneNode },
  };
}

/**
 * Embed a scene node as rich content in a table cell (one undoable op).
 *
 * The content node is removed from the document's root children so it
 * renders ONLY inside the cell (its render position is the cell's local
 * space). The node stays in the document graph, so it participates in
 * hit testing, export, clipboard closure, and undo like any other node.
 */
export function embedSceneContentInCell(
  doc: Document,
  tableId: string,
  cellId: string,
  nodeId: string,
): Document {
  const node = doc.nodes[tableId];
  if (node?.kind !== 'table') return doc;
  const cell = node.table.cells[cellId];
  if (!cell) return doc;
  const contentNode = doc.nodes[nodeId];
  if (!contentNode) return doc;

  const table: TableModel = {
    ...node.table,
    cells: {
      ...node.table.cells,
      [cellId]: { ...cell, content: { kind: 'scene', nodeId } },
    },
  };
  const rootChildren = doc.rootChildren.includes(nodeId)
    ? doc.rootChildren.filter((id) => id !== nodeId)
    : doc.rootChildren;
  return {
    ...doc,
    rootChildren,
    nodes: { ...doc.nodes, [tableId]: { ...node, table } as SceneNode },
  };
}

/** Find the table node that owns a cell id. */
export function tableNodeForCell(
  doc: Document,
  cellId: string,
): { tableId: string; cellId: string } | null {
  for (const [nodeId, node] of Object.entries(doc.nodes)) {
    if (node.kind !== 'table') continue;
    if (node.table.cells[cellId]) return { tableId: nodeId, cellId };
  }
  return null;
}
