import { describe, expect, it } from 'vitest';
import {
  addNode,
  createDocument,
  getById,
  insertNode,
  makeShapeNode,
  moveNode,
  nextNodeId,
  removeNode,
  renameNode,
  rootNodes,
} from './document';

function shape(doc: ReturnType<typeof createDocument>, name: string) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return { id, node: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name }), doc };
}

describe('Document', () => {
  it('adds nodes in paint order with sequential ids', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    expect(doc.rootChildren).toEqual([a.id, b.id]);
    expect(getById(doc, a.id)?.index).toBe(0);
    expect(getById(doc, b.id)?.index).toBe(1);
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['a', 'b']);
  });

  it('removes a node and keeps the rest', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    doc = removeNode(doc, a.id);
    expect(doc.rootChildren).toEqual([b.id]);
    expect(getById(doc, a.id)).toBeUndefined();
  });

  it('moves a node to a new paint index', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    const c = shape(doc, 'c');
    doc = c.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    doc = addNode(doc, c.node);
    doc = moveNode(doc, c.id, 0);
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['c', 'a', 'b']);
  });

  it('inserts at a specific index', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    const x = shape(doc, 'x');
    doc = x.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    doc = insertNode(doc, x.node, 1);
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['a', 'x', 'b']);
  });

  it('renames a node', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    doc = renameNode(doc, a.id, 'renamed');
    expect(getById(doc, a.id)?.name).toBe('renamed');
  });

  it('ids are unique and monotonic', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    expect(a.id).not.toBe(b.id);
    expect(doc.nextId).toBe(3);
  });
});
