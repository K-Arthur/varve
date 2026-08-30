import { addChild, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { layoutDropInsertionIndex } from './layoutDrop';

function makeLayoutDoc() {
  let doc = createDocument('layout-drop');
  const root = doc.pages![0]!.contentRoot;
  const frame = makeFrameNode('frame', {
    w: 400,
    h: 100,
    layoutStyle: {
      mode: 'flex',
      direction: 'row',
      gap: 0,
      wrap: false,
      padding: [0, 0, 0, 0],
      grow: 0,
      shrink: 0,
    },
  });
  doc = addChild(doc, root, frame);
  doc = addChild(
    doc,
    frame.id,
    makeShapeNode(
      'a',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 20 },
      { transform: [1, 0, 0, 1, 0, 0] },
    ),
  );
  doc = addChild(
    doc,
    frame.id,
    makeShapeNode(
      'b',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 20 },
      { transform: [1, 0, 0, 1, 100, 0] },
    ),
  );
  doc = addChild(
    doc,
    frame.id,
    makeShapeNode(
      'c',
      { kind: 'rect', x: 0, y: 0, w: 50, h: 20 },
      { transform: [1, 0, 0, 1, 200, 0] },
    ),
  );
  return doc;
}

describe('layoutDropInsertionIndex', () => {
  it('inserts a flow child after the nearest sibling when dropped past it', () => {
    const doc = makeLayoutDoc();
    expect(layoutDropInsertionIndex(doc, 'frame', 'b', { x: 350, y: 10 })).toBe(2);
  });

  it('does not reorder an absolute child', () => {
    let doc = makeLayoutDoc();
    const b = doc.nodes.b!;
    doc = { ...doc, nodes: { ...doc.nodes, b: { ...b, layoutPosition: 'absolute' } } };
    expect(layoutDropInsertionIndex(doc, 'frame', 'b', { x: 350, y: 10 })).toBeNull();
  });
});
