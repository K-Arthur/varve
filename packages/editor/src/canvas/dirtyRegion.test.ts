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
    });
  });
});
