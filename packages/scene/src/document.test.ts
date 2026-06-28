import { describe, expect, it } from 'vitest';
import {
  addChild,
  addNode,
  createDocument,
  getById,
  getParent,
  insertNode,
  makeFrameNode,
  makeShapeNode,
  moveChild,
  moveNode,
  nextNodeId,
  removeNode,
  renameNode,
  rootNodes,
  walkNodes,
} from './document';
import type { FrameNode } from './types';

function shape(doc: ReturnType<typeof createDocument>, name: string) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return { id, node: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name }), doc };
}

describe('Document (root-level ops)', () => {
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

describe('Document (nested child ops)', () => {
  it('walkNodes returns root-level nodes with parentId null', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const entries = walkNodes(doc);
    expect(entries.size).toBe(1);
    const entry = entries.get(a.id)!;
    expect(entry.parentId).toBeNull();
    expect(entry.depth).toBe(0);
  });

  it('walkNodes includes nested children with correct depth', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(frameId, { name: 'Frame' });
    doc = addNode(doc, frame);
    const { id: childId, doc: d3, node: childNode } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, frameId, childNode);
    const entries = walkNodes(doc);
    expect(entries.size).toBe(2);
    const childEntry = entries.get(childId)!;
    expect(childEntry.parentId).toBe(frameId);
    expect(childEntry.depth).toBe(1);
  });

  it('getParent returns null for root-level nodes', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    expect(getParent(doc, a.id)).toBeNull();
  });

  it('getParent returns the frame for nested children', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: childId, doc: d3, node: childNode } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, frameId, childNode);
    expect(getParent(doc, childId)).toBe(frameId);
  });

  it('addChild adds a child to a frame', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: childId, doc: d3, node: childNode } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, frameId, childNode);
    const frame = getById(doc, frameId) as FrameNode;
    expect(frame.children).toEqual([childId]);
    expect(getById(doc, childId)?.name).toBe('child');
  });

  it('addChild with slotId fills the slot', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: childId, doc: d3, node: childNode } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, frameId, childNode, 'label');
    const frame = getById(doc, frameId) as FrameNode;
    expect(frame.slots).toEqual({ label: childId });
  });

  it('removeNode removes from a frame children', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: childId, doc: d3, node: childNode } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, frameId, childNode);
    doc = removeNode(doc, childId);
    const frame = getById(doc, frameId) as FrameNode;
    expect(frame.children).toEqual([]);
    expect(getById(doc, childId)).toBeUndefined();
  });

  it('removeNode recursively removes frame children', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Parent' }));
    const { id: childId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const childFrame = makeFrameNode(childId, { name: 'ChildFrame' });
    doc = addChild(doc, frameId, childFrame);
    const { id: grandchildId, doc: d4, node: grandchild } = shape(doc, 'grandchild');
    doc = d4;
    doc = addChild(doc, childId, grandchild);
    // Remove the child frame
    doc = removeNode(doc, childId);
    expect(getById(doc, frameId) as FrameNode).toBeDefined();
    expect((getById(doc, frameId) as FrameNode).children).toEqual([]);
    expect(getById(doc, childId)).toBeUndefined();
    expect(getById(doc, grandchildId)).toBeUndefined();
  });

  it('moveChild reorders within a frame', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: aId, doc: d3, node: aNode } = shape(doc, 'a');
    doc = d3;
    const { id: bId, doc: d4, node: bNode } = shape(doc, 'b');
    doc = d4;
    doc = addChild(doc, frameId, aNode);
    doc = addChild(doc, frameId, bNode);
    doc = moveChild(doc, frameId, bId, 0);
    const frame = getById(doc, frameId) as FrameNode;
    expect(frame.children).toEqual([bId, aId]);
  });

  it('addChild returns doc unchanged if parent is not a frame', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const { node: child } = shape(doc, 'child');
    const result = addChild(doc, a.id, child);
    expect(result).toBe(doc);
  });
});
