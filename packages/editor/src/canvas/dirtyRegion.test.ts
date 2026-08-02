import {
  addNode,
  compositeDabOnNode,
  createDocument,
  defaultBrushPreset,
  generateDabs,
  makeFrameNode,
  makeRasterLayerNode,
  makeShapeNode,
  strokePoint,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentDirtyRegion } from './dirtyRegion';

describe('computeDocumentDirtyRegion', () => {
  it('unions old and new bounds for a moved leaf', () => {
    let before = createDocument('Dirty', true);
    before = addNode(
      before,
      makeShapeNode(
        'shape',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { transform: [1, 0, 0, 1, 10, 15] as const },
      ),
    );
    const shape = before.nodes.shape!;
    const after = {
      ...before,
      nodes: { ...before.nodes, shape: { ...shape, transform: [1, 0, 0, 1, 50, 45] as const } },
    };
    expect(computeDocumentDirtyRegion(before, after)).toEqual({
      kind: 'partial',
      bounds: { x: 10, y: 15, w: 60, h: 40 },
      rectCount: 2,
    });
  });

  it('requires a full redraw for structural container changes', () => {
    let before = createDocument('Dirty', true);
    before = addNode(before, makeFrameNode('frame', { w: 100, h: 100, children: [] }));
    const frame = before.nodes.frame!;
    const after = {
      ...before,
      nodes: { ...before.nodes, frame: { ...frame, clipContent: false } },
    };
    expect(computeDocumentDirtyRegion(before, after)).toEqual({ kind: 'full' });
  });

  it('unions the complete old and new shadow footprint for a moved leaf', () => {
    let before = createDocument('Dirty effects', true);
    const shape = makeShapeNode(
      'shape',
      { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
      { transform: [1, 0, 0, 1, 10, 15] as const },
    );
    before = addNode(before, {
      ...shape,
      effects: [
        {
          type: 'dropShadow',
          x: 10,
          y: 5,
          blur: 8,
          spread: 2,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
        },
      ],
    });
    const after = {
      ...before,
      nodes: {
        ...before.nodes,
        shape: { ...before.nodes.shape!, transform: [1, 0, 0, 1, 50, 45] as const },
      },
    };

    expect(computeDocumentDirtyRegion(before, after)).toEqual({
      kind: 'partial',
      bounds: { x: -26, y: -21, w: 132, h: 112 },
      rectCount: 2,
    });
  });

  it('reports no work for the same immutable document', () => {
    const document = createDocument('Dirty', true);
    expect(computeDocumentDirtyRegion(document, document)).toEqual({ kind: 'none' });
  });

  it('reports partial for raster layer dab changes', () => {
    const before = createDocument('RasterDirty', true);
    const withNode = addNode(before, makeRasterLayerNode('raster', { width: 512, height: 512 }));
    const preset = defaultBrushPreset('test', 'Test');
    const dabs = generateDabs([strokePoint(100, 100), strokePoint(150, 100)], preset);
    let rasterNode = withNode.nodes.raster! as import('@strata/scene').RasterLayerNode;
    for (const dab of dabs) {
      rasterNode = compositeDabOnNode(rasterNode, dab, [0, 0, 0, 255]);
    }
    const after = { ...withNode, nodes: { ...withNode.nodes, raster: rasterNode } };
    const result = computeDocumentDirtyRegion(before, after);
    expect(result.kind).toBe('partial');
    if (result.kind === 'partial') {
      expect(result.bounds.w).toBeGreaterThan(0);
    }
  });

  it('reports partial for new raster layer (leaf node)', () => {
    const before = createDocument('RasterNew', true);
    const after = addNode(before, makeRasterLayerNode('raster', { width: 512, height: 512 }));
    expect(computeDocumentDirtyRegion(before, after)).toEqual({
      kind: 'partial',
      bounds: { x: 0, y: 0, w: 512, h: 512 },
      rectCount: 1,
    });
  });
});

// ─── Regression: dirty-region cost must stay ~linear on large docs ─────────
// getParent() is O(n) per call. When nodeWorldTransform/nodeWorldBounds walk
// the ancestor chain without a parent index, a bulk-edit dirty-region scan is
// O(n²): on the dev machine this produced a 7.3s frame for a 900-node
// duplication. These tests pin the per-edit cost of a large-document scan
// within a generous budget that the O(n²) path blows through (pre-fix, 900
// nodes measured ~7000ms; the budget below is ~100x tighter).

function makeDoc(count: number): Document {
  const doc = createDocument('DirtyScale', true);
  const nodes = { ...doc.nodes } as Document['nodes'];
  const rootChildren = [...doc.rootChildren];
  for (let i = 0; i < count; i++) {
    const id = `n-${i}` as string;
    nodes[id] = makeShapeNode(
      id,
      { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
      {
        name: `r${i}`,
        transform: [1, 0, 0, 1, (i % 50) * 100, Math.floor(i / 50) * 100] as const,
      },
    );
    rootChildren.push(id);
  }
  return { ...doc, nodes, rootChildren } as Document;
}

function timeRuns(fn: () => unknown, runs: number): number {
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] ?? 0;
}

describe('computeDocumentDirtyRegion large-document cost', () => {
  it('single-node edit on a 2000-node doc stays cheap', () => {
    const before = makeDoc(2000);
    const after = {
      ...before,
      nodes: { ...before.nodes, 'n-0': { ...before.nodes['n-0'], name: 'moved' } },
    } as Document;
    const p50 = timeRuns(() => computeDocumentDirtyRegion(before, after), 5);
    // Pre-fix the ancestor-chain walk made single edits O(n) via getParent;
    // with the parent index it is O(1) per changed node plus one style pass.
    expect(p50).toBeLessThan(200);
  });

  it('bulk-edit (half the nodes) on a 2000-node doc stays cheap', () => {
    const before = makeDoc(2000);
    const ids = Object.keys(before.nodes).slice(0, 1000);
    const changed = Object.fromEntries(ids.map((id) => [id, { ...before.nodes[id] }]));
    const after = { ...before, nodes: { ...before.nodes, ...changed } } as Document;
    const p50 = timeRuns(() => computeDocumentDirtyRegion(before, after), 5);
    // Pre-fix this was O(n²): ~7.3s at 900 nodes on the dev machine.
    expect(p50).toBeLessThan(1000);
  });
});

type Document = import('@strata/scene').Document;
