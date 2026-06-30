import { addNode, createDocument, makeShapeNode, nextNodeId } from '@strata/scene';
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
