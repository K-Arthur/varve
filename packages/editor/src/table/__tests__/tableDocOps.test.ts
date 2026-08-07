/**
 * Table document-op tests: applyTableModelOp and embedSceneContentInCell.
 */
import type { Document, TableNode } from '@varve/scene';
import { addNode, createDocument, makeFrameNode, makeTableNode, nextNodeId } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { applyTableModelOp, embedSceneContentInCell } from '../tableDocOps';

function docWithTable(): { doc: Document; tableId: string; cellId: string } {
  let doc = createDocument('Doc', { flat: true });
  const tableNode = makeTableNode('', { rows: 2, columns: 2 });
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  const table: TableNode = { ...tableNode, id, name: 'Table' };
  doc = addNode(doc, table);
  const cellId = Object.keys(table.table.cells)[0]!;
  return { doc, tableId: id, cellId };
}

describe('applyTableModelOp', () => {
  it('applies the op to the owning table node and returns the new doc', () => {
    const { doc, tableId, cellId } = docWithTable();
    const next = applyTableModelOp(doc, tableId, (t) => ({
      ...t,
      cells: {
        ...t.cells,
        [cellId]: { ...t.cells[cellId]!, content: { kind: 'text', text: 'hello' } },
      },
    }));
    const table = next.nodes[tableId] as TableNode;
    expect(table.table.cells[cellId]!.content).toEqual({ kind: 'text', text: 'hello' });
  });

  it('returns the doc unchanged when the table id is missing', () => {
    const { doc, cellId } = docWithTable();
    const next = applyTableModelOp(doc, 'nope', (t) => t);
    expect(next).toBe(doc);
  });
});

describe('embedSceneContentInCell', () => {
  it('sets scene content and removes the node from root children', () => {
    const { doc, tableId, cellId } = docWithTable();
    const frame = makeFrameNode('', { name: 'Avatar', w: 80, h: 80 });
    const { id, doc: d2 } = nextNodeId(doc);
    let nextDoc = d2;
    nextDoc = addNode(nextDoc, { ...frame, id });
    nextDoc = { ...nextDoc, rootChildren: [...nextDoc.rootChildren, id] };

    const result = embedSceneContentInCell(nextDoc, tableId, cellId, id);
    const table = result.nodes[tableId] as TableNode;
    expect(table.table.cells[cellId]!.content).toEqual({ kind: 'scene', nodeId: id });
    // The node no longer renders at the document root (inside the cell only).
    expect(result.rootChildren.includes(id)).toBe(false);
    // The node stays in the graph.
    expect(result.nodes[id]).toBeDefined();
  });

  it('is a no-op when the table or cell is missing', () => {
    const { doc, tableId } = docWithTable();
    const next = embedSceneContentInCell(doc, tableId, 'missing-cell', 'n1');
    expect(next).toBe(doc);
  });

  it('does not duplicate removal when the node is not a root child', () => {
    const { doc, tableId, cellId } = docWithTable();
    // Manually add a node that is NOT in rootChildren (already embedded).
    const frame = makeFrameNode('', { name: 'Avatar', w: 80, h: 80 });
    const { id, doc: d2 } = nextNodeId(doc);
    const nextDoc: Document = {
      ...d2,
      nodes: { ...d2.nodes, [id]: { ...frame, id } },
    };
    const result = embedSceneContentInCell(nextDoc, tableId, cellId, id);
    expect(result.rootChildren).toEqual(nextDoc.rootChildren);
    expect(result.nodes[id]).toBeDefined();
  });
});
