import type { Document, LayerColor, NodeId, SceneNode } from '@varve/scene';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  bulkSetLayerColorDoc,
  bulkSetNodeLockedDoc,
  bulkSetNodeVisibleDoc,
  findAllOfKindIds,
  findSameKindIds,
  findSameLayerColorIds,
} from './layerBulkOperations';

function setupDoc(): {
  doc: Document;
  rect1: string;
  rect2: string;
  text1: string;
  frame1: string;
  hiddenRect: string;
  lockedRect: string;
} {
  let doc = createDocument();

  const { id: rect1, doc: d1 } = nextNodeId(doc);
  doc = d1;
  doc = addNode(
    doc,
    makeShapeNode(rect1, { kind: 'rect', x: 0, y: 0, w: 50, h: 50 }, { name: 'Rect 1' }),
  );

  const { id: rect2, doc: d2 } = nextNodeId(doc);
  doc = d2;
  doc = addNode(
    doc,
    makeShapeNode(rect2, { kind: 'rect', x: 60, y: 0, w: 50, h: 50 }, { name: 'Rect 2' }),
  );

  const { id: text1, doc: d3 } = nextNodeId(doc);
  doc = d3;
  doc = addNode(doc, makeTextNode(text1, 'Hello', { name: 'Text 1' }));

  const { id: frame1, doc: d4 } = nextNodeId(doc);
  doc = d4;
  doc = addNode(doc, makeFrameNode(frame1, { name: 'Frame 1', w: 200, h: 200, children: [] }));

  const { id: hiddenRect, doc: d5 } = nextNodeId(doc);
  doc = d5;
  doc = addNode(
    doc,
    makeShapeNode(
      hiddenRect,
      { kind: 'rect', x: 0, y: 60, w: 50, h: 50 },
      { name: 'Hidden Rect', visible: false },
    ),
  );

  const { id: lockedRect, doc: d6 } = nextNodeId(doc);
  doc = d6;
  doc = addNode(
    doc,
    makeShapeNode(
      lockedRect,
      { kind: 'rect', x: 0, y: 120, w: 50, h: 50 },
      { name: 'Locked Rect', locked: true },
    ),
  );

  return { doc, rect1, rect2, text1, frame1, hiddenRect, lockedRect };
}

function withLayerColor(doc: Document, ids: NodeId[], color: LayerColor): Document {
  return bulkSetLayerColorDoc(doc, ids, color);
}

describe('findSameKindIds', () => {
  it('selects nodes of the same kind (visible + unlocked only), including itself', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = findSameKindIds(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
  });

  it('excludes hidden nodes', () => {
    const { doc, rect1, hiddenRect } = setupDoc();
    const result = findSameKindIds(doc, [rect1]);
    expect(result).not.toContain(hiddenRect);
  });

  it('excludes locked nodes', () => {
    const { doc, rect1, lockedRect } = setupDoc();
    const result = findSameKindIds(doc, [rect1]);
    expect(result).not.toContain(lockedRect);
  });

  it('does not select nodes of different kinds', () => {
    const { doc, rect1, text1, frame1 } = setupDoc();
    const result = findSameKindIds(doc, [rect1]);
    expect(result).not.toContain(text1);
    expect(result).not.toContain(frame1);
  });

  it('returns empty array for an empty selection', () => {
    const { doc } = setupDoc();
    expect(findSameKindIds(doc, [])).toEqual([]);
  });
});

describe('findSameLayerColorIds', () => {
  it('selects nodes with the same layerColor tag, including itself', () => {
    const { doc, rect1, rect2, text1 } = setupDoc();
    const tagged = withLayerColor(doc, [rect1, rect2, text1], 'red');

    const result = findSameLayerColorIds(tagged, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
    expect(result).toContain(text1);
  });

  it('returns empty array when no other node shares the color (matches real no-op behavior)', () => {
    const { doc, rect1, rect2 } = setupDoc();
    let tagged = withLayerColor(doc, [rect1], 'red');
    tagged = withLayerColor(tagged, [rect2], 'blue');

    // rect1 is uniquely 'red' — nothing else to select, so this is a no-op
    // (the real context.tsx action gates on matches.length > 0 and does
    // nothing at all in this case, rather than reselecting just rect1).
    const result = findSameLayerColorIds(tagged, [rect1]);
    expect(result).toEqual([]);
  });

  it('matches other untagged (null-color) nodes too', () => {
    const { doc, rect1, rect2 } = setupDoc();
    // rect1 and rect2 both have no layerColor (null) — they match each other.
    const result = findSameLayerColorIds(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
  });

  it('returns empty array for an empty selection', () => {
    const { doc } = setupDoc();
    expect(findSameLayerColorIds(doc, [])).toEqual([]);
  });
});

describe('findAllOfKindIds', () => {
  it('selects ALL nodes of same kind including hidden and locked', () => {
    const { doc, rect1, rect2, hiddenRect, lockedRect } = setupDoc();
    const result = findAllOfKindIds(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
    expect(result).toContain(hiddenRect);
    expect(result).toContain(lockedRect);
  });

  it('excludes nodes of different kinds', () => {
    const { doc, rect1, text1, frame1 } = setupDoc();
    const result = findAllOfKindIds(doc, [rect1]);
    expect(result).not.toContain(text1);
    expect(result).not.toContain(frame1);
  });

  it('returns empty array for an empty selection', () => {
    const { doc } = setupDoc();
    expect(findAllOfKindIds(doc, [])).toEqual([]);
  });
});

describe('bulkSetNodeLockedDoc', () => {
  it('locks all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = bulkSetNodeLockedDoc(doc, [rect1, rect2], true);
    expect((result.nodes[rect1] as SceneNode).locked).toBe(true);
    expect((result.nodes[rect2] as SceneNode).locked).toBe(true);
  });

  it('does not lock unspecified nodes', () => {
    const { doc, rect1, text1 } = setupDoc();
    const result = bulkSetNodeLockedDoc(doc, [rect1], true);
    expect((result.nodes[rect1] as SceneNode).locked).toBe(true);
    expect((result.nodes[text1] as SceneNode).locked).toBe(false);
  });
});

describe('bulkSetNodeVisibleDoc', () => {
  it('hides all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = bulkSetNodeVisibleDoc(doc, [rect1, rect2], false);
    expect((result.nodes[rect1] as SceneNode).visible).toBe(false);
    expect((result.nodes[rect2] as SceneNode).visible).toBe(false);
  });

  it('does not hide unspecified nodes', () => {
    const { doc, rect1, text1 } = setupDoc();
    const result = bulkSetNodeVisibleDoc(doc, [rect1], false);
    expect((result.nodes[rect1] as SceneNode).visible).toBe(false);
    expect((result.nodes[text1] as SceneNode).visible).toBe(true);
  });
});

describe('bulkSetLayerColorDoc', () => {
  it('sets color tag on all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = bulkSetLayerColorDoc(doc, [rect1, rect2], 'green');
    expect((result.nodes[rect1] as SceneNode).layerColor).toBe('green');
    expect((result.nodes[rect2] as SceneNode).layerColor).toBe('green');
  });
});
