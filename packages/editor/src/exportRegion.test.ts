/**
 * Export Region is an export marker, not a frame.
 *
 * The Slice tool used to emit an ordinary FrameNode: it painted the frame
 * grey, adopted any artwork drawn over it, and carried no export
 * configuration, so the "slice" a user drew was indistinguishable from a
 * frame and never reached the export dialog. These tests pin the three
 * behaviours that separate the two concepts.
 */
import {
  addChild,
  addNode,
  createDocument,
  isContainer,
  isExportRegion,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { sceneNodeToEngineNode } from './render/sceneToEngine';
import { findContainingFrameInDoc } from './scene/findContainingFrame';

function exportRegion(id: string, x: number, y: number, w: number, h: number) {
  return makeFrameNode(id, {
    name: 'Export Region 1',
    frameRole: 'exportRegion',
    transform: [1, 0, 0, 1, x, y],
    fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
    children: [],
    w,
    h,
    clipContent: false,
  });
}

describe('isExportRegion', () => {
  it('separates export regions from ordinary frames', () => {
    expect(isExportRegion(exportRegion('r', 0, 0, 10, 10))).toBe(true);
    expect(isExportRegion(makeFrameNode('f', { name: 'Frame', children: [] }))).toBe(false);
    expect(isExportRegion(makeShapeNode('s', { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }))).toBe(
      false,
    );
  });

  it('still reports as a container, so adoption must be guarded explicitly', () => {
    // The node genuinely has a children array; callers that only check `kind`
    // would happily reparent into it. This is why the predicate exists.
    expect(isContainer(exportRegion('r', 0, 0, 10, 10))).toBe(true);
  });
});

describe('export regions never adopt artwork', () => {
  it('is not returned as the containing surface for a point inside it', () => {
    let doc = createDocument('Export region adoption', true);
    doc = addNode(doc, exportRegion('region', 0, 0, 200, 200));

    expect(findContainingFrameInDoc(doc, { x: 100, y: 100 })).toBeNull();
  });

  it('does not shadow a real frame underneath it', () => {
    let doc = createDocument('Export region over frame', true);
    const frame = makeFrameNode('frame', {
      name: 'Frame',
      transform: [1, 0, 0, 1, 0, 0],
      w: 200,
      h: 200,
      children: [],
    });
    doc = addNode(doc, frame);
    doc = addNode(doc, exportRegion('region', 0, 0, 200, 200));

    expect(findContainingFrameInDoc(doc, { x: 100, y: 100 })).toBe('frame');
  });
});

describe('export regions paint nothing', () => {
  it('compiles to a fully transparent rect with no strokes or effects', () => {
    let doc = createDocument('Export region paint', true);
    const region = exportRegion('region', 10, 20, 120, 90);
    doc = addNode(doc, region);

    const engineNode = sceneNodeToEngineNode(doc.nodes.region!, {}, doc);

    expect(engineNode.shape).toEqual({ kind: 'rect', x: 0, y: 0, w: 120, h: 90 });
    expect(engineNode.fill).toEqual({ space: 'rgb', r: 0, g: 0, b: 0, a: 0 });
    expect(engineNode.fills).toEqual([]);
    expect(engineNode.strokes).toEqual([]);
    expect(engineNode.effects).toEqual([]);
  });

  it('leaves an ordinary frame painting its fill', () => {
    let doc = createDocument('Frame paint', true);
    const frame = makeFrameNode('frame', {
      name: 'Frame',
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      w: 100,
      h: 100,
      children: [],
    });
    doc = addNode(doc, frame);

    const engineNode = sceneNodeToEngineNode(doc.nodes.frame!, {}, doc);

    expect(engineNode.fill).toEqual({ space: 'rgb', r: 200, g: 200, b: 200, a: 255 });
  });

  it('paints nothing even when a document carries a legacy grey region fill', () => {
    // Documents saved before the region became non-painting still hold the
    // frame grey. Reopening one must not show an opaque rectangle.
    let doc = createDocument('Legacy region', true);
    const legacy = makeFrameNode('legacy', {
      name: 'Export Region 1',
      frameRole: 'exportRegion',
      fill: { space: 'rgb', r: 200, g: 200, b: 200, a: 255 },
      w: 100,
      h: 100,
      children: [],
    });
    doc = addNode(doc, legacy);

    expect(sceneNodeToEngineNode(doc.nodes.legacy!, {}, doc).fill).toEqual({
      space: 'rgb',
      r: 0,
      g: 0,
      b: 0,
      a: 0,
    });
  });
});

describe('export regions survive the scene graph unchanged', () => {
  it('keeps its role when nested under a frame', () => {
    let doc = createDocument('Nested region', true);
    const frame = makeFrameNode('frame', { name: 'Frame', w: 400, h: 400, children: [] });
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, exportRegion('region', 10, 10, 50, 50));

    expect(isExportRegion(doc.nodes.region!)).toBe(true);
  });
});
