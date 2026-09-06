import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  reparentNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { computeCanvasDropPositions, resolveCanvasMoveIds } from './layerCanvasDrop';

describe('Layers → Canvas placement plan', () => {
  it('preserves multi-selection spacing and document order at the drop anchor', () => {
    let doc = createDocument();
    doc = addNode(
      doc,
      makeShapeNode(
        'a',
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { transform: [1, 0, 0, 1, 20, 40] },
      ),
    );
    doc = addNode(
      doc,
      makeShapeNode(
        'b',
        { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
        { transform: [1, 0, 0, 1, 120, 90] },
      ),
    );

    const positions = computeCanvasDropPositions(doc, ['a', 'b'], [320, 240], null);

    expect(positions).toEqual([
      { id: 'a', x: 320, y: 240 },
      { id: 'b', x: 420, y: 290 },
    ]);
  });

  it('rebases the preserved world positions into a transformed destination root', () => {
    let doc = createDocument();
    doc = addNode(
      doc,
      makeFrameNode('frame', {
        w: 400,
        h: 300,
        children: [],
        transform: [0, 1, -1, 0, 100, 100],
      }),
    );
    doc = addNode(doc, makeShapeNode('a', { kind: 'rect', x: 20, y: 40, w: 10, h: 10 }));

    const positions = computeCanvasDropPositions(doc, ['a'], [300, 200], 'frame');

    // The frame maps local (x, y) to world (100-y, 100+x). The new world
    // anchor (300, 200) therefore maps to local (100, -200).
    expect(positions?.[0]).toEqual({ id: 'a', x: 100, y: -200 });
  });

  it('canonicalizes selected descendants and ignores selection-array order', () => {
    let doc = createDocument();
    doc = addNode(doc, makeFrameNode('frame', { w: 200, h: 200, children: [] }));
    doc = addChild(
      doc,
      'frame',
      makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }),
    );
    doc = addNode(doc, makeShapeNode('sibling', { kind: 'rect', x: 30, y: 0, w: 10, h: 10 }));
    // Add the source frame after its child is attached, matching a normal
    // multi-selection where click order is unrelated to paint order.
    doc = reparentNode(doc, 'frame', null, 0);

    expect(resolveCanvasMoveIds(doc, ['sibling', 'child', 'frame'], 'sibling')).toEqual([
      'frame',
      'sibling',
    ]);
  });
});
