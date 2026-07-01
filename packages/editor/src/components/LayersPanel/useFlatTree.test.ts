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

    expect(flat.length).toBe(5000);
    expect(elapsed).toBeLessThan(200);
    const first = flat[0];
    const last = flat[flat.length - 1];
    expect(first?.depth).toBe(0);
    expect(last?.depth).toBe(0);
    expect(first?.node.name).toBe('Node 0');
    expect(last?.node.name).toBe('Node 4999');
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
    expect(flatCollapsed.length).toBe(1);
    expect(flatCollapsed[0]?.node.name).toBe('Frame');

    const full = new Set<string>([fId]);
    const flatExpanded = flattenTree(doc, full);
    expect(flatExpanded.length).toBe(2);
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
    expect(flat.length).toBe(3);
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
    expect(flat.length).toBe(500);
    expect(flat.every((e) => e.depth === 0)).toBe(true);
  });
});
