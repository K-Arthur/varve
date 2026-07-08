import {
  addNode,
  createDocument,
  imageFill,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  solidFill,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { sceneHasImageFills, sceneNeedsStructuralCompositing } from './sceneCompositing';

describe('sceneNeedsStructuralCompositing', () => {
  it('returns false for flat shapes only', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeShapeNode('r1', { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }, { name: 'Rect' }),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(false);
  });

  it('returns true when a visible mask is present', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      makeFrameNode('f1', {
        name: 'Frame',
        w: 200,
        h: 160,
      }),
    );
    doc.nodes.f1 = {
      ...(doc.nodes.f1 as import('@strata/scene').FrameNode),
      mask: { type: 'clip', sourceNodeId: 'm1', visible: true },
    };
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for isolated groups with children', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeGroupNode('g1', { name: 'Group', children: ['r1'], isolated: true }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });

  it('returns true for frames with children and default clipContent', () => {
    let doc = createDocument('test');
    doc = addNode(doc, makeFrameNode('f1', { name: 'Frame', w: 200, h: 160, children: ['r1'] }));
    doc = addNode(
      doc,
      makeShapeNode(
        'r1',
        { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
        { name: 'Rect', transform: [1, 0, 0, 1, 10, 10] },
      ),
    );
    expect(sceneNeedsStructuralCompositing(doc)).toBe(true);
  });
});

describe('sceneHasImageFills', () => {
  // The render worker cannot decode images (no `Image` in a Worker, separate
  // ImageCache), so image scenes must be detected and kept on the main thread.
  // `fills` is not a `makeShapeNode` opt, so we assign it the way the importer
  // does: directly on the node (see importImageAsFile).
  function shapeWithFills(id: string, fills: unknown[]) {
    const node = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 120, h: 120 }, { name: id });
    return { ...node, fills } as typeof node;
  }

  it('returns false when no node has an image fill', () => {
    let doc = createDocument('test');
    doc = addNode(
      doc,
      shapeWithFills('r1', [solidFill({ space: 'rgb', r: 1, g: 2, b: 3, a: 255 })]),
    );
    expect(sceneHasImageFills(doc)).toBe(false);
  });

  it('returns true when a shape carries an image fill', () => {
    let doc = createDocument('test');
    doc = addNode(doc, shapeWithFills('img1', [imageFill('data:image/png;base64,AAAA')]));
    expect(sceneHasImageFills(doc)).toBe(true);
  });

  it('ignores hidden image fills', () => {
    let doc = createDocument('test');
    const hidden = { ...imageFill('data:image/png;base64,AAAA'), visible: false };
    doc = addNode(doc, shapeWithFills('img1', [hidden]));
    expect(sceneHasImageFills(doc)).toBe(false);
  });
});
