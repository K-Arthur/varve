/**
 * Individual pre-merge dirty rectangles. The merged rectangle alone cannot
 * explain *why* the dirty area is large — a move contributes an old and a new
 * bound far apart, which merges into a rectangle covering the empty space
 * between them. Recording each contribution makes that visible.
 */
import {
  addNode,
  compositeDabOnNode,
  createDocument,
  defaultBrushPreset,
  generateDabs,
  makeRasterLayerNode,
  makeShapeNode,
  strokePoint,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { computeDocumentDirtyRegion, DirtyRegionRecorder } from '../dirtyRegion';

function docWithShape(transform: readonly [number, number, number, number, number, number]) {
  let doc = createDocument('Dirty', true);
  doc = addNode(
    doc,
    makeShapeNode('shape', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 }, { transform }),
  );
  return doc;
}

describe('DirtyRegionRecorder', () => {
  it('exposes the separate before and after rectangles behind one merged bound', () => {
    const before = docWithShape([1, 0, 0, 1, 10, 15]);
    const shape = before.nodes.shape!;
    const after = {
      ...before,
      nodes: { ...before.nodes, shape: { ...shape, transform: [1, 0, 0, 1, 50, 45] as const } },
    };
    const recorder = new DirtyRegionRecorder();
    const region = computeDocumentDirtyRegion(before, after, undefined, undefined, recorder);

    expect(region).toMatchObject({ kind: 'partial', rectCount: 2 });
    expect(recorder.rects).toHaveLength(2);
    expect(recorder.rects.map((r) => r.reason)).toEqual(['node-before', 'node-after']);
    expect(recorder.rects.every((r) => r.nodeId === 'shape')).toBe(true);
    // The merged bound is far larger than either contribution — that gap is
    // the empty space a single rectangle cannot distinguish from real work.
    const merged = region.kind === 'partial' ? region.bounds : null;
    expect(merged?.w).toBe(60);
    for (const record of recorder.rects) expect(record.rect.w).toBe(20);
  });

  it('attributes an added node distinctly from a moved one', () => {
    const before = createDocument('Dirty', true);
    const after = addNode(before, makeShapeNode('added', { kind: 'rect', x: 0, y: 0, w: 5, h: 5 }));
    const recorder = new DirtyRegionRecorder();
    computeDocumentDirtyRegion(before, after, undefined, undefined, recorder);
    expect(recorder.rects.map((r) => r.reason)).toEqual(['node-added']);
  });

  it('attributes a removed node distinctly', () => {
    const before = docWithShape([1, 0, 0, 1, 0, 0]);
    const after = { ...before, nodes: {} as typeof before.nodes };
    const recorder = new DirtyRegionRecorder();
    computeDocumentDirtyRegion(before, after, undefined, undefined, recorder);
    expect(recorder.rects.map((r) => r.reason)).toEqual(['node-removed']);
  });

  it('records raster tile contributions per changed tile', () => {
    const empty = createDocument('Dirty', true);
    // The *before* document must already contain the layer, otherwise the
    // diff takes the added-node path rather than the tile-version path.
    const withNode = addNode(empty, makeRasterLayerNode('raster', { width: 512, height: 512 }));
    let rasterNode = withNode.nodes.raster! as import('@strata/scene').RasterLayerNode;
    for (const dab of generateDabs(
      [strokePoint(100, 100), strokePoint(150, 100)],
      defaultBrushPreset('test', 'Test'),
    )) {
      rasterNode = compositeDabOnNode(rasterNode, dab, [0, 0, 0, 255]);
    }
    const after = { ...withNode, nodes: { ...withNode.nodes, raster: rasterNode } };
    const recorder = new DirtyRegionRecorder();
    computeDocumentDirtyRegion(withNode, after, undefined, undefined, recorder);

    expect(recorder.rects.length).toBeGreaterThan(0);
    expect(recorder.rects.every((r) => r.reason === 'raster-tile')).toBe(true);
    // Tiles are fixed-size, which is what makes them cheap to reason about.
    expect(recorder.rects.every((r) => r.rect.w === 128 && r.rect.h === 128)).toBe(true);
  });

  it('caps retention and reports truncation instead of dropping evidence silently', () => {
    const recorder = new DirtyRegionRecorder();
    const overflow = 25;
    for (let i = 0; i < DirtyRegionRecorder.MAX_RECORDED_RECTS + overflow; i++) {
      recorder.add({ x: i, y: 0, w: 1, h: 1 }, 'node-after', `n${i}`);
    }
    expect(recorder.rects).toHaveLength(DirtyRegionRecorder.MAX_RECORDED_RECTS);
    expect(recorder.truncated).toBe(overflow);
  });

  it('copies rectangles so a later mutation cannot rewrite recorded evidence', () => {
    const recorder = new DirtyRegionRecorder();
    const rect = { x: 1, y: 2, w: 3, h: 4 };
    recorder.add(rect, 'node-before', 'n');
    rect.x = 999;
    expect(recorder.rects[0]?.rect.x).toBe(1);
  });

  it('adds no cost to the production path when no recorder is passed', () => {
    const before = docWithShape([1, 0, 0, 1, 10, 15]);
    const shape = before.nodes.shape!;
    const after = {
      ...before,
      nodes: { ...before.nodes, shape: { ...shape, transform: [1, 0, 0, 1, 50, 45] as const } },
    };
    // Same result with and without the recorder — instrumentation must not
    // change the measured workload.
    const withRecorder = computeDocumentDirtyRegion(
      before,
      after,
      undefined,
      undefined,
      new DirtyRegionRecorder(),
    );
    expect(computeDocumentDirtyRegion(before, after)).toEqual(withRecorder);
  });

  it('clears on reset', () => {
    const recorder = new DirtyRegionRecorder();
    recorder.add({ x: 0, y: 0, w: 1, h: 1 }, 'node-after', 'n');
    recorder.reset();
    expect(recorder.rects).toHaveLength(0);
    expect(recorder.truncated).toBe(0);
  });
});
