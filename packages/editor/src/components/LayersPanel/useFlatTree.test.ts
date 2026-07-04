import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { flattenTree } from './useFlatTree';

describe('flattenTree (virtualization stress)', () => {
  it('flattens 5000 nodes quickly', () => {
    let doc = createDocument();
    for (let i = 0; i < 5000; i++) {
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

    expect(flat.length).toBe(5001);
    expect(elapsed).toBeLessThan(200);
    // First entry (topmost, last created): Node 4999
    expect(flat[0]?.node.name).toBe('Node 4999');
    expect(flat[0]?.depth).toBe(0);
    // Last entry (bottommost, first created): contentRoot from createDocument
    const last = flat[flat.length - 1];
    expect(last?.depth).toBe(0);
  });

  it('hides nested children when expanded set is empty', () => {
    let doc = createDocument();
    const { id: fId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(fId, { name: 'Frame', w: 100, h: 100 });
    doc = addNode(doc, frame);
    const { id: cId, doc: d3 } = nextNodeId(doc);
    doc = d3;
    const child = makeShapeNode(cId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, { name: 'Child' });
    doc = addChild(doc, fId, child);

    const empty = new Set<string>();
    const flatCollapsed = flattenTree(doc, empty);
    expect(flatCollapsed.length).toBe(2);
    expect(flatCollapsed[0]?.node.name).toBe('Frame');

    const full = new Set<string>([fId]);
    const flatExpanded = flattenTree(doc, full);
    expect(flatExpanded.length).toBe(3);
    expect(flatExpanded[0]?.node.name).toBe('Frame');
    expect(flatExpanded[1]?.node.name).toBe('Child');
  });

  it('returns all root-level nodes regardless of expanded set', () => {
    let doc = createDocument();
    for (let i = 0; i < 3; i++) {
      const { id, doc: d2 } = nextNodeId(doc);
      doc = d2;
      const node = makeShapeNode(
        id,
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { name: `Node ${i}` },
      );
      doc = addNode(doc, node);
    }
    const flat = flattenTree(doc, new Set<string>());
    expect(flat.length).toBe(4);
  });

  it('flattens 1000 nodes with depth', () => {
    let doc = createDocument();
    for (let i = 0; i < 500; i++) {
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
    const flat = flattenTree(doc, expanded);
    expect(flat.length).toBe(501);
    expect(flat.every((e) => e.depth === 0)).toBe(true);
  });
});
