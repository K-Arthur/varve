import {
  addChild,
  createDocument,
  makeRasterLayerNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { activeWorkspaceContentRoot } from '../scene/activeWorkspace';
import { createPaintLayerForRecovery } from './paintLayerRecovery';

describe('createPaintLayerForRecovery', () => {
  it('adds a selected-ready paint layer to the active design surface', () => {
    const doc = createDocument();
    const result = createPaintLayerForRecovery(doc, 'design');
    const contentRoot = activeWorkspaceContentRoot(doc, 'design');

    expect(result.document.nodes[result.nodeId]).toMatchObject({
      kind: 'rasterLayer',
      name: 'Paint Layer',
      width: 4096,
      height: 4096,
    });
    if (contentRoot) {
      expect((result.document.nodes[contentRoot] as { children: string[] }).children).toContain(
        result.nodeId,
      );
    } else {
      expect(result.document.rootChildren).toContain(result.nodeId);
    }
    expect(result.document.nextId).toBe(doc.nextId + 1);
  });

  it('uses active page dimensions and paint resolution on publishing surfaces', () => {
    const doc = { ...createDocument(), paintingPpi: 192 };
    const result = createPaintLayerForRecovery(doc, 'print');

    expect(result.document.nodes[result.nodeId]).toMatchObject({
      kind: 'rasterLayer',
      width: 3840,
      height: 2160,
      transform: [0.5, 0, 0, 0.5, 0, 0],
    });
  });

  it('does not redirect to the selected vector or an existing raster layer', () => {
    let doc = createDocument();
    const contentRoot = activeWorkspaceContentRoot(doc, 'design') ?? '';
    const { id: shapeId, doc: withId } = nextNodeId(doc);
    const { id: rasterId, doc: withRasterId } = nextNodeId(withId);
    doc = addChild(
      withRasterId,
      contentRoot,
      makeShapeNode(
        shapeId,
        { kind: 'rect', x: 0, y: 0, w: 20, h: 20 },
        { name: 'Selected vector' },
      ),
    );
    doc = addChild(doc, contentRoot, makeRasterLayerNode(rasterId, { width: 20, height: 20 }));
    const result = createPaintLayerForRecovery(doc, 'design');

    expect(result.nodeId).not.toBe(shapeId);
    expect(result.nodeId).not.toBe(rasterId);
    const parentChildren = contentRoot
      ? (result.document.nodes[contentRoot] as { children: string[] }).children
      : result.document.rootChildren;
    expect(parentChildren.at(-1)).toBe(result.nodeId);
  });
});
