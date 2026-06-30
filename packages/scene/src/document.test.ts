import { describe, expect, it } from 'vitest';
import {
  addChild,
  addNode,
  createDocument,
  detachInstance,
  getById,
  getChildren,
  getParent,
  groupNodes,
  insertNode,
  isContainer,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  moveChild,
  moveNode,
  nextNodeId,
  removeNode,
  renameNode,
  reparentNode,
  rootNodes,
  ungroupNode,
  walkNodes,
} from './document';
import type { FrameNode, GroupNode, TextNode } from './types';

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
    const entry = entries.get(a.id);
    if (!entry) throw new Error('entry not found');
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
    const childEntry = entries.get(childId);
    if (!childEntry) throw new Error('childEntry not found');
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

describe('GroupNode', () => {
  it('creates a group with makeGroupNode', () => {
    const doc = createDocument();
    const { id } = nextNodeId(doc);
    const group = makeGroupNode(id, { name: 'MyGroup' });
    expect(group.kind).toBe('group');
    expect(group.name).toBe('MyGroup');
    expect(group.children).toEqual([]);
  });

  it('walkNodes includes group children', () => {
    let doc = createDocument();
    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(gId, { name: 'G' });
    doc = addNode(doc, group);
    const { id: cId, doc: d3, node: child } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, gId, child);
    const entries = walkNodes(doc);
    expect(entries.size).toBe(2);
    expect(entries.get(cId)?.parentId).toBe(gId);
    expect(entries.get(cId)?.depth).toBe(1);
  });

  it('getParent returns group for children', () => {
    let doc = createDocument();
    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeGroupNode(gId, { name: 'G' }));
    const { id: cId, doc: d3, node: child } = shape(doc, 'child');
    doc = d3;
    doc = addChild(doc, gId, child);
    expect(getParent(doc, cId)).toBe(gId);
  });

  it('isContainer returns true for groups and frames', () => {
    const s = makeShapeNode('s1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
    const f = makeFrameNode('f1');
    const g = makeGroupNode('g1');
    expect(isContainer(s)).toBe(false);
    expect(isContainer(f)).toBe(true);
    expect(isContainer(g)).toBe(true);
  });

  it('getChildren returns children array for containers', () => {
    let doc = createDocument();
    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeGroupNode(gId, { name: 'G' }));
    const { node: child } = shape(doc, 'c');
    doc = addChild(doc, gId, child);
    expect(getChildren(doc, gId)).toEqual([child.id]);
    expect(getChildren(doc, child.id)).toBeNull();
  });
});

describe('reparentNode', () => {
  it('moves a root node into a frame', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, makeFrameNode(fId, { name: 'F' }));
    doc = addNode(doc, a.node);
    doc = reparentNode(doc, a.id, fId, 0);
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['F']);
    const frame = getById(doc, fId) as FrameNode;
    expect(frame.children).toEqual([a.id]);
  });

  it('moves a child from a frame to root', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, makeFrameNode(fId, { name: 'F' }));
    doc = addChild(doc, fId, a.node);
    doc = reparentNode(doc, a.id, null, 0);
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['a', 'F']);
    expect((getById(doc, fId) as FrameNode).children).toEqual([]);
  });

  it('rejects reparenting into own descendant', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(fId, { name: 'F' }));
    const { id: cId, doc: d3, node: child } = shape(doc, 'c');
    doc = d3;
    doc = addChild(doc, fId, child);
    const result = reparentNode(doc, fId, cId, 0);
    expect(result).toBe(doc);
  });
});

describe('groupNodes / ungroupNode', () => {
  it('groups sibling nodes into a GroupNode', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(gId, { name: 'G' });
    doc = groupNodes(doc, [a.id, b.id], group);
    const grp = getById(doc, gId) as GroupNode;
    expect(grp.children).toEqual([a.id, b.id]);
    expect(rootNodes(doc).map((n) => n.name)).toContain('G');
  });

  it('ungroupNode moves children to parent and removes group', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(gId, { name: 'G' });
    doc = groupNodes(doc, [a.id, b.id], group);
    doc = ungroupNode(doc, gId);
    expect(getById(doc, gId)).toBeUndefined();
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['a', 'b']);
  });

  it('ungroupNode fails for non-group nodes', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const result = ungroupNode(doc, a.id);
    expect(result).toBe(doc);
  });
});

describe('detachInstance', () => {
  it('clears componentId on a frame', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(fId, { name: 'F', componentId: 'comp-1' }));
    doc = detachInstance(doc, fId);
    const frame = getById(doc, fId) as FrameNode;
    expect(frame.componentId).toBeUndefined();
  });

  it('returns doc unchanged for non-frame or no componentId', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    expect(detachInstance(doc, a.id)).toBe(doc);
  });
});

describe('makeTextNode', () => {
  it('creates a text node with defaults', () => {
    const node = makeTextNode('t1', 'Hello');
    expect(node.text).toBe('Hello');
    expect(node.fontSize).toBe(16);
    expect(node.fontFamily).toBe('Inter');
    expect(node.fontWeight).toBe(400);
    expect(node.fontStyle).toBe('normal');
    expect(node.textAlign).toBe('left');
    expect(node.lineHeight).toBe(1.2);
    expect(node.letterSpacing).toBe(0);
  });

  it('accepts overrides for font fields', () => {
    const node = makeTextNode('t2', 'Bold Italic', {
      fontSize: 24,
      fontFamily: 'Georgia',
      fontWeight: 700,
      fontStyle: 'italic',
      textAlign: 'center',
      lineHeight: 1.5,
      letterSpacing: 2,
    });
    expect(node.fontSize).toBe(24);
    expect(node.fontFamily).toBe('Georgia');
    expect(node.fontWeight).toBe(700);
    expect(node.fontStyle).toBe('italic');
    expect(node.textAlign).toBe('center');
    expect(node.lineHeight).toBe(1.5);
    expect(node.letterSpacing).toBe(2);
  });

  it('produces a valid TextNode that can be added to a document', () => {
    let doc = createDocument();
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeTextNode(id, 'Test node');
    doc = addNode(doc, node);
    const stored = doc.nodes[id] as TextNode | undefined;
    expect(stored).toBeDefined();
    expect(stored!.kind).toBe('text');
    expect(stored!.text).toBe('Test node');
  });
});
