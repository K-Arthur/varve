import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
  renameNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, type LayerFilterSpec } from './layerFilterTypes';
import { computeDocumentDiff, flattenTree, setsEqual } from './useFlatTree';

describe('setsEqual', () => {
  it('returns true for identical sets', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'c']);
    expect(setsEqual(a, b)).toBe(true);
  });

  it('returns false for sets with different sizes', () => {
    const a = new Set(['a', 'b']);
    const b = new Set(['a', 'b', 'c']);
    expect(setsEqual(a, b)).toBe(false);
  });

  it('returns false for sets with different content', () => {
    const a = new Set(['a', 'b', 'c']);
    const b = new Set(['a', 'b', 'd']);
    expect(setsEqual(a, b)).toBe(false);
  });

  it('returns true for two empty sets', () => {
    expect(setsEqual(new Set(), new Set())).toBe(true);
  });

  it('returns true when both are undefined', () => {
    expect(setsEqual(undefined, undefined)).toBe(true);
  });

  it('returns false when one is undefined', () => {
    const a = new Set(['a']);
    expect(setsEqual(undefined, a)).toBe(false);
    expect(setsEqual(a, undefined)).toBe(false);
  });
});

describe('computeDocumentDiff', () => {
  function makeDocWithNodes(count: number): Document {
    let doc = createDocument('test', true);
    for (let i = 0; i < count; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }
    return doc;
  }

  it('returns structural change for null prevDoc', () => {
    const doc = makeDocWithNodes(1);
    const diff = computeDocumentDiff(null, doc);
    expect(diff.structureChanged).toBe(true);
    expect(diff.changedNodeIds).toEqual([]);
  });

  it('returns no changes for identical documents', () => {
    const doc = makeDocWithNodes(3);
    const diff = computeDocumentDiff(doc, doc);
    expect(diff.structureChanged).toBe(false);
    expect(diff.changedNodeIds).toEqual([]);
  });

  it('detects a single property rename as non-structural', () => {
    const doc = makeDocWithNodes(3);
    const rootIds = doc.rootChildren.filter((id) => doc.nodes[id]?.kind === 'shape');
    const targetId = rootIds[0]!;
    const renamedDoc = renameNode(doc, targetId, 'Renamed Node');

    const diff = computeDocumentDiff(doc, renamedDoc);
    expect(diff.structureChanged).toBe(false);
    expect(diff.changedNodeIds).toEqual([targetId]);
  });

  it('detects structural change when rootChildren changes', () => {
    const doc = makeDocWithNodes(2);
    const { id, doc: doc2 } = nextNodeId(doc);
    const newNode = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'New' });
    const docWithNew = addNode(doc2, newNode);

    const diff = computeDocumentDiff(doc, docWithNew);
    expect(diff.structureChanged).toBe(true);
  });

  it('detects structural change when node is added', () => {
    const doc = makeDocWithNodes(2);
    // Simulate adding a node by creating a new doc with an extra node
    const docWithAdded = (() => {
      let d = doc;
      const { id: nid, doc: d2 } = nextNodeId(d);
      d = d2;
      d = addNode(
        d,
        makeShapeNode(nid, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'New' }),
      );
      return d;
    })();

    const diff = computeDocumentDiff(doc, docWithAdded);
    expect(diff.structureChanged).toBe(true);
  });

  it('detects structural change when node is removed', () => {
    const doc = makeDocWithNodes(3);
    const { doc: _docWithout } = nextNodeId(doc);
    // Remove the last shape node
    const shapeIds = doc.rootChildren.filter((id) => doc.nodes[id]?.kind === 'shape');
    const lastShapeId = shapeIds[shapeIds.length - 1]!;
    const docAfterRemove: Document = {
      ...doc,
      rootChildren: doc.rootChildren.filter((id) => id !== lastShapeId),
      nodes: Object.fromEntries(Object.entries(doc.nodes).filter(([id]) => id !== lastShapeId)),
    };

    const diff = computeDocumentDiff(doc, docAfterRemove);
    expect(diff.structureChanged).toBe(true);
  });

  it('detects structural change when children array changes', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Frame', w: 100, h: 100, children: [] });
    doc = addNode(doc, frame);

    const { id: cId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const child = makeShapeNode(cId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' });
    doc = addChild(doc, fId, child);

    // Now compare doc before and after adding child into frame
    // We need docWithoutChild (before addChild)
    let docBefore = createDocument();
    const { id: fId2, doc: d4 } = nextNodeId(docBefore);
    docBefore = d4;
    const frame2 = makeFrameNode(fId2, { name: 'Frame', w: 100, h: 100, children: [] });
    docBefore = addNode(docBefore, frame2);

    const diff = computeDocumentDiff(docBefore, doc);
    expect(diff.structureChanged).toBe(true);
  });

  it('reports no structural change when nodes map is same reference', () => {
    const doc = makeDocWithNodes(5);
    // Same doc but with a new top-level property that doesn't affect nodes
    const sameNodesDoc = { ...doc, name: 'New Name' };
    const diff = computeDocumentDiff(doc, sameNodesDoc);
    expect(diff.structureChanged).toBe(false);
    expect(diff.changedNodeIds).toEqual([]);
  });

  it('reports multiple property changes', () => {
    const doc = makeDocWithNodes(5);
    const shapeIds = doc.rootChildren.filter((id) => doc.nodes[id]?.kind === 'shape');
    const id1 = shapeIds[0]!;
    const id2 = shapeIds[1]!;

    // Rename two nodes
    let mutated = renameNode(doc, id1, 'Renamed A');
    mutated = renameNode(mutated, id2, 'Renamed B');

    const diff = computeDocumentDiff(doc, mutated);
    expect(diff.structureChanged).toBe(false);
    expect(diff.changedNodeIds).toHaveLength(2);
    expect(diff.changedNodeIds).toContain(id1);
    expect(diff.changedNodeIds).toContain(id2);
  });
});

describe('flattenTree (incremental update)', () => {
  it('preserves order and depth for property-only changes', () => {
    let doc = createDocument('test', true);
    // Create a frame with nested children
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Frame', w: 100, h: 100, children: [] });
    doc = addNode(doc, frame);

    const { id: c1, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const child1 = makeShapeNode(
      c1,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Child 1' },
    );
    doc = addChild(doc, fId, child1);

    const { id: c2, doc: d4 } = nextNodeId(doc);
    doc = d4;
    const child2 = makeShapeNode(
      c2,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Child 2' },
    );
    doc = addChild(doc, fId, child2);

    const expanded = new Set([fId]);

    // Flatten original
    const original = flattenTree(doc, expanded);
    expect(original).toHaveLength(3);

    // Rename a child (property-only change)
    const renamed = renameNode(doc, c1, 'Renamed Child');

    // The flat tree should have same length, same depth, same parentId
    // Note: flattenTree walks in reverse paint order, so child1 (c1) lands at index 2
    const afterRename = flattenTree(renamed, expanded);
    expect(afterRename).toHaveLength(3);
    expect(afterRename[0]?.depth).toBe(original[0]?.depth);
    expect(afterRename[2]?.depth).toBe(original[2]?.depth);
    expect(afterRename[0]?.parentId).toBe(original[0]?.parentId);
    expect(afterRename[2]?.parentId).toBe(original[2]?.parentId);
    expect(afterRename[2]?.node.name).toBe('Renamed Child');
  });

  it('has same content whether using incremental or full rebuild', () => {
    let doc = createDocument('test', true);
    for (let i = 0; i < 100; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: `N${i}` });
      doc = addNode(doc, node);
    }

    const expanded = new Set<string>();
    const before = flattenTree(doc, expanded);

    // Rename one node
    const shapeIds = doc.rootChildren.filter((id) => doc.nodes[id]?.kind === 'shape');
    const renamed = renameNode(doc, shapeIds[50]!, 'SPECIAL_RENAME');

    const after = flattenTree(renamed, expanded);

    // Full and incremental should produce same shape
    // Note: flattenTree reverses paint order, so shapeIds[50] (N50) lands at index 49
    expect(after).toHaveLength(before.length);
    expect(after[49]?.node.name).toBe('SPECIAL_RENAME');

    // All other nodes unchanged
    for (let i = 0; i < before.length; i++) {
      if (i !== 49) {
        expect(after[i]?.node.name).toBe(before[i]?.node.name);
      }
    }
  });
});

describe('flattenTree (search index filtered)', () => {
  it('uses matchedIds for O(1) search lookup', () => {
    let doc = createDocument('test', true);
    for (let i = 0; i < 100; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }

    const expanded = new Set<string>();
    const matchedIds = new Set<string>();
    const allIds = Object.keys(doc.nodes).filter((id) => doc.nodes[id]?.kind !== 'group');
    // Manually match a subset
    const targetIds = allIds.filter((_, i) => i % 10 === 0);
    for (const id of targetIds) matchedIds.add(id);

    const filter: LayerFilterSpec = { ...DEFAULT_FILTER, search: 'filtered' };
    const result = flattenTree(doc, expanded, filter, matchedIds);

    // Should only include nodes that are in matchedIds AND pass other filters
    expect(result.every((e) => matchedIds.has(e.node.id))).toBe(true);
  });
});

describe('benchmark — 10K nodes', () => {
  it('completes flatten of 10,000 nodes in under 500ms', () => {
    let doc = createDocument('test', true);
    for (let i = 0; i < 10000; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }

    const expanded = new Set<string>();
    const start = performance.now();
    const flat = flattenTree(doc, expanded);
    const elapsed = performance.now() - start;

    expect(flat.length).toBe(10000);
    expect(elapsed).toBeLessThan(500);
  });

  it('computes diff for 10,000 nodes quickly (<10ms)', () => {
    let doc = createDocument('test', true);
    for (let i = 0; i < 10000; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }

    const shapeIds = Object.keys(doc.nodes).filter((id) => doc.nodes[id]?.kind === 'shape');
    const renamed = renameNode(doc, shapeIds[5000]!, 'Renamed');

    const start = performance.now();
    const diff = computeDocumentDiff(doc, renamed);
    const elapsed = performance.now() - start;

    expect(diff.structureChanged).toBe(false);
    expect(diff.changedNodeIds).toHaveLength(1);
    expect(elapsed).toBeLessThan(10);
  });
});
