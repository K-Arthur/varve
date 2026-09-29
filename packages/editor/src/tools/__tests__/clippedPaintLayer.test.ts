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
import { multiplyAffine, scaleXY, translate } from '@varve/shared';
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

  it('creates a bounded raster texture aligned to a transformed vector shape', () => {
    const document = createDesignCanvas(createDocument('vector clipped paint'));
    const rootId = designCanvasContentRoot(document)!;
    const { id: sourceId, doc: allocated } = nextNodeId(document);
    const source = makeShapeNode(sourceId, { kind: 'rect', x: 20, y: 10, w: 40, h: 30 });
    source.name = 'Contour';
    source.transform = [0, 2, -2, 0, 100, 50];
    const withSource = addChild(allocated, rootId, source);
    const rootToWorld = [2, 0, 0, 2, 10, 20] as const;
    const sourceToWorld = [0, 2, -2, 0, 100, 50] as const;

    const result = createClippedPaintLayer(withSource, 'design', sourceId, (nodeId) =>
      nodeId === rootId ? rootToWorld : sourceToWorld,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const group = result.document.nodes[result.groupId]!;
    const paint = result.document.nodes[result.layerId]!;
    const sourcePixelToWorld = multiplyAffine(
      sourceToWorld,
      multiplyAffine(translate(18, 8), scaleXY(44 / 44, 34 / 34)),
    );
    const expectedLayerTransform = multiplyAffine([0.5, 0, 0, 0.5, -5, -10], sourcePixelToWorld);
    expect(group).toMatchObject({
      kind: 'group',
      name: 'Contour clipped paint',
      mask: { type: 'alpha', matteSource: { kind: 'scene-node', nodeId: sourceId } },
    });
    expect(paint).toMatchObject({ kind: 'rasterLayer', name: 'Shading', width: 44, height: 34 });
    expect(paint?.kind === 'rasterLayer' ? paint.transform : null).toEqual(expectedLayerTransform);
  });

  it('refuses missing, hidden, and off-surface sources', () => {
    const { document, sourceId } = makeSurface();
    const hidden = {
      ...document,
      nodes: { ...document.nodes, [sourceId]: { ...document.nodes[sourceId]!, visible: false } },
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
    expect(createClippedPaintLayer(offSurface, 'design', otherId)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('active canvas or page'),
    });
  });

  it('refuses vector bounds beyond the bounded paint-layer dimensions', () => {
    const document = createDesignCanvas(createDocument('large vector clipped paint'));
    const rootId = designCanvasContentRoot(document)!;
    const { id: sourceId, doc: allocated } = nextNodeId(document);
    const source = makeShapeNode(sourceId, {
      kind: 'rect',
      x: 0,
      y: 0,
      w: 20_000,
      h: 20_000,
    });
    const withSource = addChild(allocated, rootId, source);

    expect(createClippedPaintLayer(withSource, 'design', sourceId)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('16,384 px'),
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
