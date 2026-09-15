import { describe, expect, it } from 'vitest';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from './document';
import { listSurfaces, surfaceForNode } from './surfaceModel';

describe('surface read model', () => {
  it('keeps publishing pages distinct from design frames', () => {
    let doc = createDocument('surface model');
    const page = doc.pages![0]!;
    const { id: frameId, doc: withId } = nextNodeId(doc);
    const frame = makeFrameNode(frameId, {
      name: 'UI artboard',
      w: 320,
      h: 240,
      transform: [1, 0, 0, 1, 40, 50],
      children: [],
    });
    doc = addChild(withId, page.contentRoot, frame);

    const surfaces = listSurfaces(doc);
    const pageSurface = surfaces.find((surface) => surface.kind === 'page');
    const frameSurface = surfaces.find((surface) => surface.id === frameId);

    expect(pageSurface).toMatchObject({
      kind: 'page',
      id: page.id,
      clipContent: false,
      exportClip: 'trim-and-bleed',
      includedInPageExport: true,
    });
    expect(pageSurface?.print?.trim).toEqual({ x: 0, y: 0, w: page.width, h: page.height });
    expect(frameSurface).toMatchObject({
      kind: 'artboard',
      parent: { kind: 'page', id: page.id },
      size: { w: 320, h: 240 },
      clipContent: true,
      exportClip: 'bounds',
      includedInPageExport: true,
    });
    expect(frameSurface?.placement).toEqual({ x: 40, y: 50 });
    expect(surfaceForNode(doc, frameId)).toEqual({ kind: 'artboard', id: frameId });
  });

  it('places page-owned frames in the page pasteboard position without mutating node transforms', () => {
    let doc = createDocument('placed page');
    const page = doc.pages![0]!;
    const { id: frameId, doc: withId } = nextNodeId(doc);
    doc = addChild(
      withId,
      page.contentRoot,
      makeFrameNode(frameId, {
        w: 100,
        h: 80,
        transform: [1, 0, 0, 1, 12, 18],
        children: [],
      }),
    );
    const before = doc.nodes[frameId]!.transform;
    doc = {
      ...doc,
      pages: [{ ...page, placement: { x: 500, y: 700 } }],
    };

    const frame = listSurfaces(doc).find((surface) => surface.id === frameId)!;
    expect(frame.placement).toEqual({ x: 512, y: 718 });
    expect(frame.bounds).toMatchObject({ x: 512, y: 718, w: 100, h: 80 });
    expect(doc.nodes[frameId]!.transform).toEqual(before);
  });

  it('resolves a nested node to its nearest frame surface', () => {
    let doc = createDocument('nested frame');
    const page = doc.pages![0]!;
    const outerAllocation = nextNodeId(doc);
    const outer = makeFrameNode(outerAllocation.id, { w: 200, h: 120, children: [] });
    doc = addChild(outerAllocation.doc, page.contentRoot, outer);
    const innerAllocation = nextNodeId(doc);
    const inner = makeFrameNode(innerAllocation.id, { w: 100, h: 60, children: [] });
    doc = addChild(innerAllocation.doc, outer.id, inner);
    const shapeAllocation = nextNodeId(doc);
    doc = addChild(
      shapeAllocation.doc,
      inner.id,
      makeShapeNode(shapeAllocation.id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );

    expect(surfaceForNode(doc, shapeAllocation.id)).toEqual({ kind: 'frame', id: inner.id });
  });

  it('does not expose export regions as design surfaces', () => {
    let doc = createDocument('export region');
    const { id: regionId, doc: withId } = nextNodeId(doc);
    doc = addNode(
      withId,
      makeFrameNode(regionId, {
        frameRole: 'exportRegion',
        name: 'Slice',
        w: 200,
        h: 100,
        children: [],
      }),
    );

    expect(listSurfaces(doc).some((surface) => surface.id === regionId)).toBe(false);
    expect(surfaceForNode(doc, regionId)).toBeNull();
  });

  it('keeps page and master provenance separate from local page ownership', () => {
    let doc = createDocument('master surfaces');
    const page = doc.pages![0]!;
    doc = {
      ...doc,
      bleed: { top: 3, right: 3, bottom: 3, left: 3, linked: true, unit: 'mm' },
    };
    const { id: masterRootId, doc: withRootId } = nextNodeId(doc);
    const masterRoot = makeFrameNode(masterRootId, { w: 100, h: 50, children: [] });
    doc = addNode(withRootId, masterRoot);
    // A root frame demonstrates that an authored frame has no print metadata;
    // it is not promoted to a page simply because a document also has pages.
    const surfaces = listSurfaces(doc);
    const rootFrame = surfaces.find((surface) => surface.id === masterRootId)!;
    expect(rootFrame.print).toBeUndefined();
    expect(rootFrame.owner.kind).toBe('pasteboard');
    const pageSurface = surfaces.find((surface) => surface.id === page.id)!;
    expect(pageSurface.print?.bleed.left).toBeGreaterThan(0);
  });
});
