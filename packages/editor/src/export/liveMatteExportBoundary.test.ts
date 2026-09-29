import {
  addChild,
  addMask,
  createDesignCanvas,
  createDocument,
  designCanvasContentRoot,
  makeGroupNode,
  makeRasterLayerNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { assessNodeCapability, findFlattenBoundaries } from './compositor';

describe('live scene-node matte export boundaries', () => {
  it('rasterizes only the matte group for SVG/PDF and keeps its vector sibling native', () => {
    let document = createDesignCanvas(createDocument('live matte export'));
    const rootId = designCanvasContentRoot(document)!;
    let allocated = nextNodeId(document);
    const sourceId = allocated.id;
    document = allocated.doc;
    allocated = nextNodeId(document);
    const groupId = allocated.id;
    document = allocated.doc;
    allocated = nextNodeId(document);
    const shadingId = allocated.id;
    document = allocated.doc;
    allocated = nextNodeId(document);
    const artworkId = allocated.id;
    document = allocated.doc;

    const source = makeShapeNode(sourceId, { kind: 'rect', x: 0, y: 0, w: 120, h: 90 });
    const clipGroup = makeGroupNode(groupId, {
      name: 'Contour clipped paint',
    });
    const shading = makeRasterLayerNode(shadingId, { width: 124, height: 94 }, { name: 'Shading' });
    shading.transform = [0, 1, -1, 0, 500, 150];
    const artwork = makeGroupNode(artworkId, {
      name: 'Artwork',
      children: [sourceId, groupId],
    });

    document = addChild(document, rootId, source);
    document = addChild(document, rootId, clipGroup);
    document = addChild(document, groupId, shading);
    document = {
      ...document,
      nodes: { ...document.nodes, [artworkId]: artwork },
    };
    document = addMask(document, groupId, undefined, 'alpha', {
      matteSource: { kind: 'scene-node', nodeId: sourceId },
      hideMaskSource: true,
    });

    expect(assessNodeCapability(source, document, 'svg')).toBe(true);
    expect(assessNodeCapability(document.nodes[groupId]!, document, 'svg')).toBe(false);
    const svgBoundaries = findFlattenBoundaries([artwork], document, 'svg');
    const pdfBoundaries = findFlattenBoundaries([artwork], document, 'pdf');
    expect(svgBoundaries.map((entry) => entry.nodeId)).toEqual([groupId]);
    expect(svgBoundaries[0]?.bounds).toEqual({ x: 406, y: 150, w: 94, h: 124 });
    expect(svgBoundaries[0]?.nodeId).toBe(groupId);
    expect(pdfBoundaries.map((entry) => entry.nodeId)).toEqual([groupId]);
  });
});
