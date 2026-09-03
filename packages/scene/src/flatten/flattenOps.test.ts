import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import type { ShapeNode } from '../types';
import type { FlattenReplacement } from './flattenOps';
import { insertFlattenedCopy, mergeNodes, replaceNodesWithFlattened } from './flattenOps';

function makeShape(id: string, x: number, y: number, w: number, h: number): ShapeNode {
  return {
    id,
    kind: 'shape',
    name: `Shape ${id}`,
    layerColor: null,
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y],
    fills: [],
    strokes: [],
    effects: [],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
  };
}

function makeDoc(nodes: ShapeNode[], rootChildren?: string[]): Document {
  const nodeMap: Document['nodes'] = {};
  for (const n of nodes) {
    nodeMap[n.id] = n;
  }
  return {
    id: 'test-doc',
    name: 'Test',
    formatVersion: '2.6',
    nodes: nodeMap,
    rootChildren: rootChildren ?? nodes.map((n) => n.id),
    nextId: 100,
    components: {},
  };
}

function makeReplacement(nodeId: string): FlattenReplacement {
  return {
    nodeId,
    bounds: { x: 0, y: 0, w: 100, h: 100 },
    dataUrl: 'data:image/png;base64,AAAA',
    assetId: 'asset-test',
    placement: { dx: 0, dy: 0 },
    cssWidth: 100,
    cssHeight: 100,
  };
}

describe('replaceNodesWithFlattened', () => {
  it('returns the same document for empty node set', () => {
    const doc = makeDoc([makeShape('s1', 0, 0, 50, 50)]);
    const result = replaceNodesWithFlattened(doc, [], makeReplacement('r1'));
    expect(result).toBe(doc);
  });

  it('replaces a single node with a flattened shape', () => {
    const s1 = makeShape('s1', 10, 20, 50, 50);
    const doc = makeDoc([s1]);
    const replacement = makeReplacement('r1');
    replacement.placement = { dx: 10, dy: 20 };
    replacement.bounds = { x: 10, y: 20, w: 50, h: 50 };

    const result = replaceNodesWithFlattened(doc, ['s1'], replacement);

    // Original node removed
    expect(result.nodes.s1).toBeUndefined();
    // Replacement added
    expect(result.nodes.r1).toBeDefined();
    expect(result.nodes.r1!.kind).toBe('shape');
    // Root children updated
    expect(result.rootChildren).toContain('r1');
    expect(result.rootChildren).not.toContain('s1');
  });

  it('preserves paint order position', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 0, 50, 50);
    const s3 = makeShape('s3', 200, 0, 50, 50);
    const doc = makeDoc([s1, s2, s3]);
    const replacement = makeReplacement('r1');

    const result = replaceNodesWithFlattened(doc, ['s2'], replacement);

    // Replacement should be at index 1 (where s2 was)
    expect(result.rootChildren).toEqual(['s1', 'r1', 's3']);
  });

  it('replaces multiple nodes with a single flattened shape', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 0, 50, 50);
    const doc = makeDoc([s1, s2]);
    const replacement = makeReplacement('r1');

    const result = replaceNodesWithFlattened(doc, ['s1', 's2'], replacement);

    expect(result.nodes.s1).toBeUndefined();
    expect(result.nodes.s2).toBeUndefined();
    expect(result.nodes.r1).toBeDefined();
    expect(result.rootChildren).toEqual(['r1']);
  });

  it('sets the replacement transform from placement', () => {
    const s1 = makeShape('s1', 10, 20, 50, 50);
    const doc = makeDoc([s1]);
    const replacement = makeReplacement('r1');
    replacement.placement = { dx: 10, dy: 20 };

    const result = replaceNodesWithFlattened(doc, ['s1'], replacement);
    const node = result.nodes.r1 as ShapeNode;
    expect(node.transform[4]).toBe(10);
    expect(node.transform[5]).toBe(20);
  });

  it('sets the replacement shape dimensions from bounds', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const doc = makeDoc([s1]);
    const replacement = makeReplacement('r1');
    replacement.bounds = { x: 0, y: 0, w: 200, h: 150 };

    const result = replaceNodesWithFlattened(doc, ['s1'], replacement);
    const node = result.nodes.r1 as ShapeNode;
    expect(node.shape.kind).toBe('rect');
    if (node.shape.kind === 'rect') {
      expect(node.shape.w).toBe(200);
      expect(node.shape.h).toBe(150);
    }
  });

  it('does not mutate the original document', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const doc = makeDoc([s1]);
    const replacement = makeReplacement('r1');

    replaceNodesWithFlattened(doc, ['s1'], replacement);

    expect(doc.nodes.s1).toBeDefined();
    expect(doc.rootChildren).toContain('s1');
  });
});

describe('mergeNodes', () => {
  it('returns the same document for empty node set', () => {
    const doc = makeDoc([makeShape('s1', 0, 0, 50, 50)]);
    const result = mergeNodes(doc, [], makeReplacement('r1'));
    expect(result).toBe(doc);
  });

  it('merges nodes into a single shape', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 0, 50, 50);
    const doc = makeDoc([s1, s2]);
    const replacement = makeReplacement('merged');

    const result = mergeNodes(doc, ['s1', 's2'], replacement);

    expect(result.nodes.s1).toBeUndefined();
    expect(result.nodes.s2).toBeUndefined();
    expect(result.nodes.merged).toBeDefined();
    expect(result.nodes.merged!.name).toBe('Merged');
  });
});

describe('insertFlattenedCopy', () => {
  it('keeps the source nodes hidden and inserts the copy at their paint position', () => {
    const s1 = makeShape('s1', 0, 0, 50, 50);
    const s2 = makeShape('s2', 100, 0, 50, 50);
    const s3 = makeShape('s3', 200, 0, 50, 50);
    const doc = makeDoc([s1, s2, s3]);

    const result = insertFlattenedCopy(doc, ['s2'], makeReplacement('r1'));

    expect(result.rootChildren).toEqual(['s1', 'r1', 's2', 's3']);
    expect(result.nodes.s2?.visible).toBe(false);
    expect(result.nodes.s1?.visible).toBe(true);
    expect(result.nodes.r1?.name).toBe('Rasterized Copy');
  });

  it('does not mutate the source document', () => {
    const source = makeShape('s1', 0, 0, 50, 50);
    const doc = makeDoc([source]);

    insertFlattenedCopy(doc, ['s1'], makeReplacement('r1'));

    expect(doc.nodes.s1?.visible).toBe(true);
    expect(doc.rootChildren).toEqual(['s1']);
  });
});
