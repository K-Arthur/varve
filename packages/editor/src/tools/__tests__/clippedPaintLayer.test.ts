import {
  addChild,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  makeGroupNode,
  makeRasterLayerNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { createClippedPaintLayer } from '../clippedPaintLayer';

function makeSurface() {
  const document = createDesignCanvas(createDocument('clipped paint'));
  const rootId = designCanvasContentRoot(document)!;
  const { id: sourceId, doc: allocated } = nextNodeId(document);
  const source = makeRasterLayerNode(sourceId, { width: 320, height: 240 }, { name: 'Ink' });
  source.transform = [1.5, 0, 0, 1.5, 40, 60];
  return {
    rootId,
    sourceId,
    document: addChild(allocated, rootId, source),
  };
}

describe('createClippedPaintLayer', () => {
  it('adds an editable raster layer in a live-alpha group and preserves source transforms', () => {
    const { document, rootId, sourceId } = makeSurface();
    const source = document.nodes[sourceId]!;

    const result = createClippedPaintLayer(document, 'design', sourceId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const group = result.document.nodes[result.groupId]!;
    const paint = result.document.nodes[result.layerId]!;
    expect(group).toMatchObject({
      kind: 'group',
      name: 'Ink clipped paint',
      children: [result.layerId],
      mask: {
        type: 'alpha',
        matteSource: { kind: 'scene-node', nodeId: sourceId },
        hideMaskSource: true,
      },
    });
    expect(paint).toMatchObject({
      kind: 'rasterLayer',
      name: 'Shading',
      width: 320,
      height: 240,
      transform: [1.5, 0, 0, 1.5, 40, 60],
    });
    expect(result.document.nodes[sourceId]).toBe(source);
    expect((result.document.nodes[rootId] as { children: string[] }).children).toEqual([
      sourceId,
      result.groupId,
    ]);
  });

  it('refuses missing, hidden, vector, and off-surface sources', () => {
    const { document, sourceId } = makeSurface();
    const hidden = {
      ...document,
      nodes: { ...document.nodes, [sourceId]: { ...document.nodes[sourceId]!, visible: false } },
    };
    const { id: shapeId, doc: withShapeId } = nextNodeId(document);
    const withShape = {
      ...withShapeId,
      rootChildren: [...withShapeId.rootChildren, shapeId],
      nodes: {
        ...withShapeId.nodes,
        [shapeId]: makeShapeNode(shapeId, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
      },
    };
    const withSecondCanvas = createDesignCanvas(document, { name: 'Other', activate: false });
    const otherRoot = designCanvasContentRoot(
      withSecondCanvas,
      withSecondCanvas.designCanvases?.[1]?.id,
    )!;
    const { id: otherId, doc: withOtherId } = nextNodeId(withSecondCanvas);
    const offSurface = addChild(
      { ...withOtherId, activeDesignCanvasId: document.activeDesignCanvasId },
      otherRoot,
      makeRasterLayerNode(otherId, { width: 20, height: 20 }),
    );

    expect(createClippedPaintLayer(document, 'design', 'missing').ok).toBe(false);
    expect(createClippedPaintLayer(hidden, 'design', sourceId)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('visible'),
    });
    expect(createClippedPaintLayer(withShape, 'design', shapeId)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('raster'),
    });
    expect(createClippedPaintLayer(offSurface, 'design', otherId)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('active canvas or page'),
    });
  });

  it('refuses a singular workspace transform before creating any layer', () => {
    const { document, rootId, sourceId } = makeSurface();
    const root = document.nodes[rootId]!;
    const singularDocument = {
      ...document,
      nodes: { ...document.nodes, [rootId]: { ...root, transform: [0, 0, 0, 0, 0, 0] as const } },
    };
    const result = createClippedPaintLayer(singularDocument, 'design', sourceId);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('transform') });
  });

  it('refuses cyclic source ancestry rather than selecting the wrong surface', () => {
    const { document, rootId, sourceId } = makeSurface();
    const { id: groupId, doc: allocated } = nextNodeId(document);
    const malformedGroup = makeGroupNode(groupId, { children: [sourceId] });
    const malformedSource = { ...document.nodes[sourceId]!, children: [groupId] };
    const cycle = {
      ...allocated,
      nodes: {
        ...allocated.nodes,
        [rootId]: { ...allocated.nodes[rootId]!, children: [] },
        [groupId]: malformedGroup,
        [sourceId]: malformedSource,
      },
    };
    const result = createClippedPaintLayer(cycle, 'design', sourceId);
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('active canvas') });
  });
});
