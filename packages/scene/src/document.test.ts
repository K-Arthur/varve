import { describe, expect, it } from 'vitest';
import {
  addChild,
  addGuide,
  addNode,
  arrangeNode,
  clearGuides,
  createDocument,
  detachInstance,
  duplicateGuide,
  getById,
  getChildren,
  getGuidesForPage,
  getParent,
  groupNodes,
  insertNode,
  isContainer,
  isInIsolatedSubtree,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
  moveChild,
  moveGuide,
  moveNode,
  nextNodeId,
  pasteGuides,
  removeGuide,
  removeNode,
  renameNode,
  reparentNode,
  rootNodes,
  setAllGuidesLocked,
  setLayerColor,
  toggleGuideLock,
  ungroupNode,
  walkNodes,
} from './document';
import type { FrameNode, GroupNode, LayerColor, NodeId, TextNode } from './types';
import { CURRENT_DOCUMENT_VERSION } from './version';

function shape(doc: ReturnType<typeof createDocument>, name: string) {
  const { id, doc: d2 } = nextNodeId(doc);
  doc = d2;
  return { id, node: makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name }), doc };
}

/** Return the contentRoot node id from the default page (used to account for it in rootChildren assertions). */
function pageContentRoot(doc: ReturnType<typeof createDocument>): string {
  return doc.pages?.[0]?.contentRoot ?? doc.rootChildren[0] ?? '';
}

describe('Document (root-level ops)', () => {
  it('adds nodes in paint order with sequential ids', () => {
    let doc = createDocument();
    const cr = pageContentRoot(doc);
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    expect(doc.rootChildren).toEqual([cr, a.id, b.id]);
    expect(getById(doc, a.id)?.order).toBeTruthy();
    expect(getById(doc, b.id)?.order).toBeTruthy();
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['Page 1 content', 'a', 'b']);
  });

  it('removes a node and keeps the rest', () => {
    let doc = createDocument();
    const cr = pageContentRoot(doc);
    const a = shape(doc, 'a');
    doc = a.doc;
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addNode(doc, a.node);
    doc = addNode(doc, b.node);
    doc = removeNode(doc, a.id);
    expect(doc.rootChildren).toEqual([cr, b.id]);
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
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['c', 'Page 1 content', 'a', 'b']);
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
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['Page 1 content', 'x', 'a', 'b']);
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
    expect(doc.nextId).toBe(4);
  });

  it('clone-and-add preserves all existing nodes (no accidental replacement)', () => {
    let doc = createDocument();
    // Add 3 nodes
    const nodes: ReturnType<typeof shape>[] = [];
    for (let i = 0; i < 3; i++) {
      const s = shape(doc, `Node ${i}`);
      doc = s.doc;
      doc = addNode(doc, s.node);
      nodes.push(s);
    }
    expect(doc.rootChildren.length).toBe(4);

    // Clone the last node and add it (simulating duplicateSelected's core pattern)
    const last = nodes[2];
    if (!last) throw new Error('expected node');
    const { id: newId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const cloned = {
      ...doc.nodes[last.id],
      id: newId,
      name: `${last.node.name} copy`,
    } as import('./types').SceneNode;
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [newId]: cloned },
      rootChildren: [...doc.rootChildren, newId],
    };

    // All 5 nodes exist
    expect(doc.rootChildren.length).toBe(5);
    expect(rootNodes(doc).map((n) => n.name)).toEqual([
      'Page 1 content',
      'Node 0',
      'Node 1',
      'Node 2',
      'Node 2 copy',
    ]);
    // Original nodes unaffected
    expect(doc.nodes[nodes[0]?.id ?? '']).toBeDefined();
    expect(doc.nodes[nodes[1]?.id ?? '']).toBeDefined();
  });
});

describe('Document (nested child ops)', () => {
  it('walkNodes returns root-level nodes with parentId null', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const entries = walkNodes(doc);
    expect(entries.size).toBe(2);
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
    expect(entries.size).toBe(3);
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

  it('addChild sets order via generateKeyBetween', () => {
    let doc = createDocument();
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(frameId, { name: 'Frame' }));
    const { id: firstId, doc: d3, node: first } = shape(doc, 'first');
    doc = d3;
    doc = addChild(doc, frameId, first);
    const child1 = getById(doc, firstId);
    expect(child1?.order).toBeTruthy();

    const firstOrder = child1?.order;
    const { id: secondId, doc: d4, node: second } = shape(doc, 'second');
    doc = d4;
    doc = addChild(doc, frameId, second);
    const child2 = getById(doc, secondId);
    expect(child2?.order).toBeTruthy();
    expect((child2?.order ?? '') > (firstOrder ?? '')).toBe(true);
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
    expect(entries.size).toBe(3);
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
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['Page 1 content', 'F']);
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
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['a', 'Page 1 content', 'F']);
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

  it('rejects reparenting a frame into its own descendant frame (exercises isAncestor, not just the container-type guard)', () => {
    // The test above moves a frame into a leaf shape, which is already
    // rejected by the "!isContainer(newParent)" guard before isAncestor
    // ever runs — it doesn't prove isAncestor itself is correct. This one
    // targets a container descendant so only isAncestor can catch it.
    let doc = createDocument();
    const { id: outerId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const { id: innerId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    doc = addNode(doc, makeFrameNode(outerId, { name: 'Outer' }));
    doc = addChild(doc, outerId, makeFrameNode(innerId, { name: 'Inner' }));
    const result = reparentNode(doc, outerId, innerId, 0);
    expect(result).toBe(doc);
  });

  it('reorders within the same parent (regression: isAncestor(doc, id, newParentId) previously rejected every same-parent move, since newParentId trivially contains id as a child)', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    doc = addNode(doc, makeFrameNode(fId, { name: 'F' }));
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addChild(doc, fId, a.node);
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addChild(doc, fId, b.node);
    expect((getById(doc, fId) as FrameNode).children).toEqual([a.id, b.id]);

    doc = reparentNode(doc, a.id, fId, 1);
    expect((getById(doc, fId) as FrameNode).children).toEqual([b.id, a.id]);
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
    expect(rootNodes(doc).map((n) => n.name)).toEqual(['Page 1 content', 'a', 'b']);
  });

  it('ungroupNode fails for non-group nodes', () => {
    let doc = createDocument();
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addNode(doc, a.node);
    const result = ungroupNode(doc, a.id);
    expect(result).toBe(doc);
  });

  it('groups siblings nested inside a real container, not just rootChildren (regression: groupNodes created the group via addNode, which always appends to doc.rootChildren — for a non-null parentId the group was never reparented into it, leaving it orphaned in rootChildren while its members vanished from the visible tree)', () => {
    let doc = createDocument();
    const cr = pageContentRoot(doc);
    const a = shape(doc, 'a');
    doc = a.doc;
    doc = addChild(doc, cr, a.node);
    const b = shape(doc, 'b');
    doc = b.doc;
    doc = addChild(doc, cr, b.node);
    const c = shape(doc, 'c');
    doc = c.doc;
    doc = addChild(doc, cr, c.node);
    expect((getById(doc, cr) as FrameNode).children).toEqual([a.id, b.id, c.id]);

    const { id: gId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const group = makeGroupNode(gId, { name: 'G' });
    doc = groupNodes(doc, [a.id, b.id], group);

    // The group must land inside the real parent, at the position its
    // first member occupied — not be left dangling in rootChildren.
    expect((getById(doc, cr) as FrameNode).children).toEqual([gId, c.id]);
    expect(doc.rootChildren).not.toContain(gId);
    const grp = getById(doc, gId) as GroupNode;
    expect(grp.children).toEqual([a.id, b.id]);
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
    expect(node.fontFamily).toBe('IBM Plex Sans Variable');
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

  it('accepts advanced typography properties', () => {
    const node = makeTextNode('t4', 'Advanced', {
      textAlignVertical: 'middle',
      paragraphSpacing: 12,
      listStyle: 'disc',
      textOverflow: 'ellipsis',
      textResizing: 'autoHeight',
      openTypeFeatures: { liga: true, kern: true },
    });
    expect(node.textAlignVertical).toBe('middle');
    expect(node.paragraphSpacing).toBe(12);
    expect(node.listStyle).toBe('disc');
    expect(node.textOverflow).toBe('ellipsis');
    expect(node.textResizing).toBe('autoHeight');
    expect(node.openTypeFeatures).toEqual({ liga: true, kern: true });
  });

  it('preserves explicit area-text container dimensions', () => {
    const node = makeTextNode('t-area', 'Wrapped text', {
      w: 240,
      h: 120,
      textMode: 'area',
      textResizing: 'fixed',
    });
    expect(node.w).toBe(240);
    expect(node.h).toBe(120);
    expect(node.textMode).toBe('area');
    expect(node.textResizing).toBe('fixed');
  });

  it('produces a valid TextNode that can be added to a document', () => {
    let doc = createDocument();
    const { id, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const node = makeTextNode(id, 'Test node');
    doc = addNode(doc, node);
    const stored = doc.nodes[id] as TextNode | undefined;
    expect(stored).toBeDefined();
    expect(stored?.kind).toBe('text');
    expect(stored?.text).toBe('Test node');
  });
});

describe('arrangeNode', () => {
  function threeRoots() {
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
    return { doc, a: a.id, b: b.id, c: c.id };
  }

  it('bringToFront moves node to end of siblings', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    // rootChildren = [cr, a, b, c]; bring a to front → [cr, b, c, a]
    const d2 = arrangeNode(doc, a, 'front');
    expect(d2.rootChildren).toEqual([cr, b, c, a]);
  });

  it('sendToBack moves node to start of siblings', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    // rootChildren = [cr, a, b, c]; send c to back → [c, cr, a, b]
    const d2 = arrangeNode(doc, c, 'back');
    expect(d2.rootChildren).toEqual([c, cr, a, b]);
  });

  it('bringForward moves node one position toward end', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    // rootChildren = [cr, a, b, c]; move b forward → [cr, a, c, b]
    const d2 = arrangeNode(doc, b, 'forward');
    expect(d2.rootChildren).toEqual([cr, a, c, b]);
  });

  it('sendBackward moves node one position toward start', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    // rootChildren = [cr, a, b, c]; move b backward → [cr, b, a, c]
    const d2 = arrangeNode(doc, b, 'backward');
    expect(d2.rootChildren).toEqual([cr, b, a, c]);
  });

  it('bringToFront is no-op when already at front', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    const d2 = arrangeNode(doc, c, 'front');
    expect(d2.rootChildren).toEqual([cr, a, b, c]);
  });

  it('sendToBack is no-op when already at back', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    const d2 = arrangeNode(doc, cr, 'back');
    expect(d2.rootChildren).toEqual([cr, a, b, c]);
  });

  it('bringForward is no-op when already at front', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    const d2 = arrangeNode(doc, c, 'forward');
    expect(d2.rootChildren).toEqual([cr, a, b, c]);
  });

  it('sendBackward is no-op when already at back', () => {
    const { doc, a, b, c } = threeRoots();
    const cr = pageContentRoot(doc);
    const d2 = arrangeNode(doc, cr, 'backward');
    expect(d2.rootChildren).toEqual([cr, a, b, c]);
  });

  it('works for children inside a container', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Frame' });
    doc = addNode(doc, frame);

    const x = shape(doc, 'x');
    doc = x.doc;
    const y = shape(doc, 'y');
    doc = y.doc;
    doc = addChild(doc, fId, x.node);
    doc = addChild(doc, fId, y.node);

    // children = [x, y]; bring x forward → [y, x]
    const d3 = arrangeNode(doc, x.id, 'forward');
    const fr = d3.nodes[fId] as FrameNode;
    expect(fr.children).toEqual([y.id, x.id]);
  });

  it('returns doc unchanged for unknown node id', () => {
    const { doc } = threeRoots();
    const d2 = arrangeNode(doc, 'nonexistent', 'front');
    expect(d2).toBe(doc);
  });
});

describe('Guide operations', () => {
  it('addGuide adds a vertical guide at a position', () => {
    const doc = createDocument('test');
    const d2 = addGuide(doc, 'vertical', 150);
    expect(d2.guides).toBeDefined();
    expect(d2.guides?.length).toBe(1);
    expect(d2.guides?.[0]?.axis).toBe('vertical');
    expect(d2.guides?.[0]?.position).toBe(150);
    expect(d2.guides?.[0]?.id).toBeDefined();
  });

  it('addGuide adds a horizontal guide at a position', () => {
    const doc = createDocument('test');
    const d2 = addGuide(doc, 'horizontal', 300);
    expect(d2.guides?.length).toBe(1);
    expect(d2.guides?.[0]?.axis).toBe('horizontal');
    expect(d2.guides?.[0]?.position).toBe(300);
  });

  it('addGuide appends guides without removing existing ones', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'vertical', 100);
    doc = addGuide(doc, 'horizontal', 200);
    expect(doc.guides?.length).toBe(2);
    expect(doc.guides?.[0]?.axis).toBe('vertical');
    expect(doc.guides?.[1]?.axis).toBe('horizontal');
  });

  it('removeGuide removes a guide by id', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'vertical', 100);
    const gid = doc.guides?.[0]?.id ?? 'fallback-id';
    const d2 = removeGuide(doc, gid);
    expect(d2.guides).toBeDefined();
    expect(d2.guides?.length).toBe(0);
  });

  it('removeGuide is a no-op for unknown id', () => {
    const doc = createDocument('test');
    const d2 = removeGuide(doc, 'nonexistent');
    expect(d2).toBe(doc);
  });

  it('removeGuide returns doc unchanged when no guides exist', () => {
    const doc = createDocument('test');
    const d2 = removeGuide(doc, 'any-id');
    expect(d2).toBe(doc);
  });

  it('moveGuide repositions a guide by id', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'vertical', 100);
    const gid = doc.guides?.[0]?.id ?? '';
    const d2 = moveGuide(doc, gid, 250);
    expect(d2.guides?.[0]?.position).toBe(250);
  });

  it('moveGuide is a no-op for unknown id', () => {
    const doc = createDocument('test');
    const d2 = moveGuide(doc, 'nonexistent', 100);
    expect(d2).toBe(doc);
  });

  it('moveGuide returns doc unchanged when no guides exist', () => {
    const doc = createDocument('test');
    const d2 = moveGuide(doc, 'any-id', 100);
    expect(d2).toBe(doc);
  });

  it('toggleGuideLock toggles a guide locked state', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'horizontal', 50);
    const gid = doc.guides?.[0]?.id ?? '';
    const d2 = toggleGuideLock(doc, gid);
    expect(d2.guides?.[0]?.locked).toBe(true);
    const d3 = toggleGuideLock(d2, gid);
    expect(d3.guides?.[0]?.locked).toBe(false);
  });

  it('toggleGuideLock is a no-op for unknown id', () => {
    const doc = createDocument('test');
    const d2 = toggleGuideLock(doc, 'nonexistent');
    expect(d2).toBe(doc);
  });

  it('toggleGuideLock returns doc unchanged when no guides exist', () => {
    const doc = createDocument('test');
    const d2 = toggleGuideLock(doc, 'any-id');
    expect(d2).toBe(doc);
  });

  it('setAllGuidesLocked locks every guide', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'vertical', 100);
    doc = addGuide(doc, 'horizontal', 200);
    const locked = setAllGuidesLocked(doc, true);
    expect(locked.guides?.every((g) => g.locked)).toBe(true);
    const unlocked = setAllGuidesLocked(locked, false);
    expect(unlocked.guides?.every((g) => !g.locked)).toBe(true);
  });

  it('duplicateGuide copies axis and creates a new id', () => {
    let doc = createDocument('test');
    doc = addGuide(doc, 'vertical', 100);
    const sourceId = doc.guides?.[0]?.id ?? '';
    const d2 = duplicateGuide(doc, sourceId, 250, 'copy-id');
    expect(d2.guides?.length).toBe(2);
    const copy = d2.guides?.find((g) => g.id === 'copy-id');
    expect(copy?.axis).toBe('vertical');
    expect(copy?.position).toBe(250);
    expect(copy?.locked).toBe(false);
  });

  it('getGuidesForPage returns only guides on the active page', () => {
    let doc = createDocument('test');
    const page1 = doc.activePageId ?? doc.pages?.[0]?.id ?? '';
    doc = addGuide(doc, 'vertical', 100, { pageId: page1 });
    doc = addGuide(doc, 'horizontal', 200, { pageId: 'other-page' });
    const visible = getGuidesForPage(doc, page1);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.position).toBe(100);
  });

  it('clearGuides with pageId removes only that page guides', () => {
    let doc = createDocument('test');
    const page1 = doc.activePageId ?? doc.pages?.[0]?.id ?? '';
    doc = addGuide(doc, 'vertical', 100, { pageId: page1 });
    doc = addGuide(doc, 'horizontal', 200, { pageId: 'other-page' });
    doc = clearGuides(doc, page1);
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides?.[0]?.pageId).toBe('other-page');
  });

  it('pasteGuides creates new guides on the target page with offset', () => {
    let doc = createDocument('test');
    const page1 = doc.activePageId ?? doc.pages?.[0]?.id ?? '';
    const source = [{ id: 'g1', axis: 'vertical' as const, position: 50, pageId: 'old' }];
    doc = pasteGuides(doc, source, page1, () => 'g-new', 10);
    expect(doc.guides).toHaveLength(1);
    expect(doc.guides?.[0]?.id).toBe('g-new');
    expect(doc.guides?.[0]?.pageId).toBe(page1);
    expect(doc.guides?.[0]?.position).toBe(60);
  });
});

describe('Document print production fields', () => {
  it('createDocument does not set print production fields by default', () => {
    const doc = createDocument('test');
    expect(doc.colorConfig).toBeUndefined();
    expect(doc.documentUnit).toBeUndefined();
    expect(doc.physicalWidth).toBeUndefined();
    expect(doc.physicalHeight).toBeUndefined();
    expect(doc.dpi).toBeUndefined();
    expect(doc.bleed).toBeUndefined();
    expect(doc.safeArea).toBeUndefined();
    expect(doc.swatches).toBeUndefined();
    expect(doc.spotColors).toBeUndefined();
  });

  it('createDocument stamps current format version', () => {
    const doc = createDocument('test');
    expect(doc.formatVersion).toBe(CURRENT_DOCUMENT_VERSION);
  });

  it('createDocument converts physicalWidth/Height to px page geometry via the documentUnit (regression: previously assigned raw mm values as px)', () => {
    const doc = createDocument('A4 print doc', {
      colorMode: 'cmyk',
      physicalWidth: 210,
      physicalHeight: 297,
      documentUnit: 'mm',
      dpi: 300,
    });
    const page = doc.pages?.[0];
    // 210mm/297mm at the fixed-96dpi world unit, NOT the raw mm numbers.
    expect(page?.width).toBeCloseTo(793.7, 0);
    expect(page?.height).toBeCloseTo(1122.5, 0);
    // Metadata is preserved verbatim in its original physical unit.
    expect(doc.physicalWidth).toBe(210);
    expect(doc.physicalHeight).toBe(297);
    expect(doc.documentUnit).toBe('mm');
    expect(doc.dpi).toBe(300);
  });

  it('createDocument treats an explicit px documentUnit as a no-op passthrough', () => {
    const doc = createDocument('screen doc', {
      physicalWidth: 1440,
      physicalHeight: 900,
      documentUnit: 'px',
    });
    expect(doc.pages?.[0]?.width).toBe(1440);
    expect(doc.pages?.[0]?.height).toBe(900);
  });

  it('createDocument defaults to px (no-op) when physicalWidth is set without a documentUnit', () => {
    const doc = createDocument('no unit doc', { physicalWidth: 640, physicalHeight: 480 });
    expect(doc.pages?.[0]?.width).toBe(640);
    expect(doc.pages?.[0]?.height).toBe(480);
  });

  it('Document interface accepts colorConfig and bleed', () => {
    const doc = createDocument('print-doc');
    const withPrint = {
      ...doc,
      colorConfig: {
        mode: 'cmyk' as const,
        rgbProfile: { id: 'srgb', name: 'sRGB IEC61966-2.1' },
        cmykProfile: { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' },
        outputIntent: {
          profile: { id: 'fogra39', name: 'Fogra39 (ISO Coated v2 300%)' },
          renderingIntent: 'relative' as const,
          blackPointCompensation: true,
        },
        blackGeneration: { mode: 'standard' as const, overprintBlack: false },
      },
      documentUnit: 'mm' as const,
      physicalWidth: 210,
      physicalHeight: 297,
      dpi: 300,
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' as const },
      safeArea: { top: 5, right: 5, bottom: 5, left: 5, unit: 'mm' as const, enabled: true },
    };
    expect(withPrint.colorConfig?.mode).toBe('cmyk');
    expect(withPrint.documentUnit).toBe('mm');
    expect(withPrint.physicalWidth).toBe(210);
    expect(withPrint.dpi).toBe(300);
    expect(withPrint.bleed?.top).toBe(3);
    expect(withPrint.safeArea?.enabled).toBe(true);
  });

  describe('setLayerColor', () => {
    it('sets a color tag on a node', () => {
      let doc = createDocument();
      const a = shape(doc, 'a');
      doc = a.doc;
      doc = addNode(doc, a.node);
      doc = setLayerColor(doc, a.id, 'red');
      expect(doc.nodes[a.id]?.layerColor).toBe('red');
    });

    it('removes a color tag when set to null', () => {
      let doc = createDocument();
      const a = shape(doc, 'a');
      doc = a.doc;
      doc = addNode(doc, a.node);
      doc = setLayerColor(doc, a.id, 'blue');
      expect(doc.nodes[a.id]?.layerColor).toBe('blue');
      doc = setLayerColor(doc, a.id, null);
      expect(doc.nodes[a.id]?.layerColor).toBeNull();
    });

    it('is a no-op for non-existent node ids', () => {
      let doc = createDocument();
      // Reference-identity check: the doc must be returned unchanged (ids are
      // randomized since ADR-0025, so structural equality is not the signal).
      doc = setLayerColor(doc, 'nonexistent' as NodeId, 'green');
      const unchanged = setLayerColor(doc, 'nonexistent' as NodeId, 'green');
      expect(unchanged).toBe(doc);
      expect(Object.keys(doc.nodes).length).toBe(Object.keys(createDocument().nodes).length);
    });

    it('works on all node kinds', () => {
      let doc = createDocument();
      const a = shape(doc, 'a');
      doc = a.doc;
      doc = addNode(doc, a.node);
      doc = setLayerColor(doc, a.id, 'purple');
      expect(doc.nodes[a.id]?.layerColor).toBe('purple');

      const { id: textId, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const textNode = makeTextNode(textId, 'hello');
      doc = addNode(doc, textNode);
      doc = setLayerColor(doc, textId, 'orange');
      expect(doc.nodes[textId]?.layerColor).toBe('orange');
    });

    it('supports all 7 color values', () => {
      const colors: LayerColor[] = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray'];
      let doc = createDocument();
      for (const c of colors) {
        const { id, doc: d } = nextNodeId(doc);
        doc = d;
        const shapeNode = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
        doc = addNode(doc, shapeNode);
        doc = setLayerColor(doc, id, c);
        expect(doc.nodes[id]?.layerColor).toBe(c);
      }
    });
  });

  describe('isInIsolatedSubtree', () => {
    it('returns true when no isolation is active', () => {
      let doc = createDocument();
      const a = shape(doc, 'a');
      doc = a.doc;
      doc = addNode(doc, a.node);
      expect(isInIsolatedSubtree(a.id, null, doc)).toBe(true);
    });

    it('returns true for the isolated root itself', () => {
      let doc = createDocument();
      const frame = makeFrameNode('frame1', { name: 'Frame', w: 100, h: 100 });
      doc = addNode(doc, frame);
      expect(isInIsolatedSubtree('frame1', 'frame1', doc)).toBe(true);
    });

    it('returns true for direct children of isolated root', () => {
      let doc = createDocument();
      const frame = makeFrameNode('frame1', { name: 'Frame', w: 100, h: 100 });
      doc = addNode(doc, frame);
      const child = shape(doc, 'child');
      doc = child.doc;
      doc = addChild(doc, 'frame1', child.node);
      expect(isInIsolatedSubtree(child.id, 'frame1', doc)).toBe(true);
    });

    it('returns true for nested descendants of isolated root', () => {
      let doc = createDocument();
      const frame = makeFrameNode('frame1', { name: 'Frame', w: 100, h: 100 });
      doc = addNode(doc, frame);
      const group = makeGroupNode('group1', { name: 'Group', children: [] });
      doc = addChild(doc, 'frame1', group);
      const child = shape(doc, 'child');
      doc = child.doc;
      doc = addChild(doc, 'group1', child.node);
      expect(isInIsolatedSubtree(child.id, 'frame1', doc)).toBe(true);
    });

    it('returns false for nodes outside isolated subtree', () => {
      let doc = createDocument();
      const frame = makeFrameNode('frame1', { name: 'Frame', w: 100, h: 100 });
      doc = addNode(doc, frame);
      const outside = shape(doc, 'outside');
      doc = outside.doc;
      doc = addNode(doc, outside.node);
      expect(isInIsolatedSubtree(outside.id, 'frame1', doc)).toBe(false);
    });

    it('returns false for siblings of isolated root', () => {
      let doc = createDocument();
      const frame = makeFrameNode('frame1', { name: 'Frame', w: 100, h: 100 });
      doc = addNode(doc, frame);
      const sibling = shape(doc, 'sibling');
      doc = sibling.doc;
      doc = addNode(doc, sibling.node);
      expect(isInIsolatedSubtree(sibling.id, 'frame1', doc)).toBe(false);
    });

    it('returns false for nodes in a different subtree', () => {
      let doc = createDocument();
      const frame1 = makeFrameNode('frame1', { name: 'Frame1', w: 100, h: 100 });
      doc = addNode(doc, frame1);
      const frame2 = makeFrameNode('frame2', { name: 'Frame2', w: 100, h: 100 });
      doc = addNode(doc, frame2);
      const child = shape(doc, 'child');
      doc = child.doc;
      doc = addChild(doc, 'frame2', child.node);
      expect(isInIsolatedSubtree(child.id, 'frame1', doc)).toBe(false);
    });
  });
});
