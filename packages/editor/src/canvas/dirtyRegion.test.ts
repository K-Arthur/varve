import {
  addNode,
  addPage,
  compositeDabOnNode,
  createDocument,
  defaultBrushPreset,
  generateDabs,
  makeFrameNode,
  makeRasterLayerNode,
  makeShapeNode,
  strokePoint,
} from '@varve/scene';
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

  it('produces a partial region for a top-level z-order reorder', () => {
    let before = createDocument('Dirty', true);
    before = addNode(before, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }));
    before = addNode(before, makeShapeNode('b', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }));
    // Reorder: b moves in front of a (paint order swap).
    const after = { ...before, rootChildren: ['b', 'a'] };
    const dirty = computeDocumentDirtyRegion(before, after);
    // Both nodes' bounds repaint: the overlap pixels change (order) and each
    // node's non-overlap pixels are unchanged but covered by the union.
    expect(dirty.kind).toBe('partial');
    if (dirty.kind === 'partial') {
      // Both nodes changed paint position; each contributes old+new bounds.
      expect(dirty.bounds).toEqual({ x: 0, y: 0, w: 20, h: 10 });
      expect(dirty.rectCount).toBe(4);
    }
  });

  it('covers old and new positions when a reorder moves a node between positions', () => {
    let before = createDocument('Dirty', true);
    for (let i = 0; i < 4; i++) {
      before = addNode(
        before,
        makeShapeNode(`n${i}`, { kind: 'rect', x: i * 100, y: 0, w: 20, h: 10 }),
      );
    }
    // Move n0 to the end.
    const after = { ...before, rootChildren: ['n1', 'n2', 'n3', 'n0'] };
    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('partial');
    if (dirty.kind === 'partial') {
      // All four nodes shifted position; old+new bounds cover 0..320.
      expect(dirty.bounds.x).toBe(0);
      expect(dirty.bounds.w).toBe(320);
      expect(dirty.rectCount).toBe(8);
    }
  });

  it('keeps z-order changes partial even when combined with a leaf edit', () => {
    let before = createDocument('Dirty', true);
    before = addNode(before, makeShapeNode('a', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }));
    before = addNode(before, makeShapeNode('b', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }));
    const a = before.nodes.a!;
    const after = {
      ...before,
      rootChildren: ['b', 'a'],
      nodes: { ...before.nodes, a: { ...a, transform: [1, 0, 0, 1, 40, 0] as const } },
    };
    expect(computeDocumentDirtyRegion(before, after).kind).toBe('partial');
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

  it('repaints leaf effect dependents when a live matte source changes', () => {
    let before = createDocument('Dirty matte dependency', true);
    before = addNode(before, makeShapeNode('source', { kind: 'rect', x: 0, y: 0, w: 20, h: 20 }));
    const target = makeShapeNode('target', { kind: 'rect', x: 100, y: 0, w: 30, h: 30 });
    before = addNode(before, {
      ...target,
      effects: [
        {
          id: 'fx-target-1',
          type: 'dropShadow',
          x: 0,
          y: 0,
          blur: 4,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 255 },
          opacity: 1,
          blendMode: 'normal',
          visible: true,
          mask: {
            source: { kind: 'scene-node', nodeId: 'source' },
            type: 'alpha',
            coordinateSpace: 'world',
          },
        },
      ],
    });
    const source = before.nodes.source!;
    const after = {
      ...before,
      nodes: {
        ...before.nodes,
        source: { ...source, transform: [1, 0, 0, 1, 40, 0] as const },
      },
    };

    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('partial');
    if (dirty.kind === 'partial') {
      expect(dirty.rectCount).toBe(3);
      expect(dirty.bounds.x).toBe(0);
      expect(dirty.bounds.w).toBe(142);
    }
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
    let rasterNode = withNode.nodes.raster! as import('@varve/scene').RasterLayerNode;
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

describe('page placement/size dirty regions (ADR-0124)', () => {
  function pagedDoc(): Document {
    let doc = createDocument('Dirty', false);
    // Explicit placement makes the test independent of auto layout.
    doc = { ...doc, pages: [{ ...doc.pages![0]!, placement: { x: 0, y: 0 } }] };
    return doc;
  }

  it('contributes old and new page bounds on placement change', () => {
    const before = pagedDoc();
    const after = { ...before, pages: [{ ...before.pages![0]!, placement: { x: 400, y: 200 } }] };
    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('partial');
    if (dirty.kind !== 'partial') return;
    // old bounds (0,0,1920,1080) and new bounds (400,200,1920,1080), each
    // expanded by the label band (26) — shadow + label pixels move too.
    const pad = 26;
    expect(dirty.bounds).toEqual({
      x: -pad,
      y: -pad,
      w: 1920 + 400 + pad * 2,
      h: 1080 + 200 + pad * 2,
    });
    expect(dirty.rectCount).toBe(2);
  });

  it('contributes page bounds when only the page size changes (no node edits)', () => {
    const before = pagedDoc();
    const after = {
      ...before,
      pages: [{ ...before.pages![0]!, width: 1024, height: 768, placement: { x: 0, y: 0 } }],
    };
    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('partial');
    if (dirty.kind !== 'partial') return;
    expect(dirty.rectCount).toBe(2);
  });

  it('reports none for page metadata edits that do not move decoration pixels', () => {
    const before = pagedDoc();
    const after = { ...before, pages: [{ ...before.pages![0]!, name: 'Renamed' }] };
    // No node identity change and no placement/size change: the paint path
    // treats a doc change with a 'none' region as a full redraw, so page
    // number/name changes still repaint labels.
    expect(computeDocumentDirtyRegion(before, after)).toEqual({ kind: 'none' });
  });

  it('reports none when the pages array identity changes but bounds are stable', () => {
    const before = pagedDoc();
    const after = {
      ...before,
      pages: [{ ...before.pages![0]!, placement: { x: 0, y: 0 } }],
    };
    expect(computeDocumentDirtyRegion(before, after)).toEqual({ kind: 'none' });
  });

  it('ignores page add/remove for the placement branch (structural path handles it)', () => {
    const before = pagedDoc();
    // Adding a page creates a new content-root group: a container node
    // change, which the node diff reports as a full redraw.
    const after = addPage(before, {});
    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('full');
  });

  it('combines placement changes with concurrent leaf edits in one region', () => {
    let before = pagedDoc();
    before = addNode(
      before,
      makeShapeNode(
        'shape',
        { kind: 'rect', x: 0, y: 0, w: 20, h: 10 },
        { transform: [1, 0, 0, 1, 10, 15] as const },
      ),
    );
    before = { ...before, nodes: { ...before.nodes, shape: before.nodes.shape! } };
    const after = {
      ...before,
      pages: [{ ...before.pages![0]!, placement: { x: 300, y: 0 } }],
      nodes: {
        ...before.nodes,
        shape: { ...before.nodes.shape!, transform: [1, 0, 0, 1, 60, 15] as const },
      },
    };
    const dirty = computeDocumentDirtyRegion(before, after);
    expect(dirty.kind).toBe('partial');
    if (dirty.kind !== 'partial') return;
    expect(dirty.rectCount).toBeGreaterThanOrEqual(2);
  });
});

type Document = import('@varve/scene').Document;
