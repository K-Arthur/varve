import type { Document, LayerColor, NodeId, SceneNode } from '@strata/scene';
import {
  addNode,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
  nextNodeId,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';

/** Verify selection logic: select visible+unlocked nodes matching first node's kind. */
function simulateSelectSameType(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetKind = firstNode.kind;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n && n.kind === targetKind && n.visible && !n.locked && n.id !== firstNode.id) {
      matches.push(n.id);
    }
  }
  return [firstNode.id, ...matches];
}

/** Verify selection logic: select visible+unlocked nodes matching first node's layerColor. */
function simulateSelectSameLayerColor(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetColor = firstNode.layerColor;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n && n.visible && !n.locked && n.id !== firstNode.id && n.layerColor === targetColor) {
      matches.push(n.id);
    }
  }
  return [firstNode.id, ...matches];
}

/** Verify selection logic: select ALL nodes (including locked/hidden) matching first node's kind. */
function simulateSelectAllOfType(doc: Document, selection: NodeId[]): NodeId[] {
  if (selection.length === 0) return [];
  const firstNode = doc.nodes[selection[0]!];
  if (!firstNode) return [];
  const targetKind = firstNode.kind;
  const matches: NodeId[] = [];
  for (const n of Object.values(doc.nodes)) {
    if (n && n.kind === targetKind && n.id !== firstNode.id) {
      matches.push(n.id);
    }
  }
  return [firstNode.id, ...matches];
}

/** Verify bulk lock: set locked=true on all given ids. */
function simulateBulkLock(doc: Document, ids: NodeId[]): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const n = nodes[id];
    if (!n) continue;
    nodes[id] = { ...n, locked: true } as SceneNode;
  }
  return { ...doc, nodes };
}

/** Verify bulk hide: set visible=false on all given ids. */
function simulateBulkHide(doc: Document, ids: NodeId[]): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const n = nodes[id];
    if (!n) continue;
    nodes[id] = { ...n, visible: false } as SceneNode;
  }
  return { ...doc, nodes };
}

/** Verify bulk color tag: set layerColor on all given ids. */
function simulateBulkColorTag(doc: Document, ids: NodeId[], color: LayerColor): Document {
  const nodes = { ...doc.nodes };
  for (const id of ids) {
    const n = nodes[id];
    if (!n) continue;
    nodes[id] = { ...n, layerColor: color } as SceneNode;
  }
  return { ...doc, nodes };
}

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

describe('selectAllWithSameType', () => {
  it('selects nodes of the same kind (visible + unlocked only)', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = simulateSelectSameType(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
  });

  it('excludes hidden nodes', () => {
    const { doc, rect1, hiddenRect } = setupDoc();
    const result = simulateSelectSameType(doc, [rect1]);
    expect(result).not.toContain(hiddenRect);
  });

  it('excludes locked nodes', () => {
    const { doc, rect1, lockedRect } = setupDoc();
    const result = simulateSelectSameType(doc, [rect1]);
    expect(result).not.toContain(lockedRect);
  });

  it('does not select nodes of different kinds', () => {
    const { doc, rect1, text1, frame1 } = setupDoc();
    const result = simulateSelectSameType(doc, [rect1]);
    expect(result).not.toContain(text1);
    expect(result).not.toContain(frame1);
  });
});

describe('selectAllWithSameLayerColor', () => {
  it('selects nodes with the same layerColor tag', () => {
    let doc = setupDoc().doc;
    const { rect1, rect2, text1 } = setupDoc();
    doc = simulateBulkColorTag(doc, [rect1, rect2, text1], 'red');

    const result = simulateSelectSameLayerColor(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
    expect(result).toContain(text1);
  });

  it('excludes nodes with different layerColor', () => {
    let doc = setupDoc().doc;
    const { rect1, rect2 } = setupDoc();
    doc = simulateBulkColorTag(doc, [rect1], 'red');
    doc = simulateBulkColorTag(doc, [rect2], 'blue');

    const result = simulateSelectSameLayerColor(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).not.toContain(rect2);
  });

  it('returns only the first node when no other nodes share the color', () => {
    const { doc, rect1, rect2 } = setupDoc();
    // rect1 has no layerColor (null), rect2 has no layerColor (null) — they match
    const noColor = simulateSelectSameLayerColor(doc, [rect1]);
    expect(noColor).toContain(rect1);
    expect(noColor).toContain(rect2);
  });
});

describe('selectAllOfType', () => {
  it('selects ALL nodes of same kind including hidden and locked', () => {
    const { doc, rect1, rect2, hiddenRect, lockedRect } = setupDoc();
    const result = simulateSelectAllOfType(doc, [rect1]);
    expect(result).toContain(rect1);
    expect(result).toContain(rect2);
    expect(result).toContain(hiddenRect);
    expect(result).toContain(lockedRect);
  });

  it('excludes nodes of different kinds', () => {
    const { doc, rect1, text1, frame1 } = setupDoc();
    const result = simulateSelectAllOfType(doc, [rect1]);
    expect(result).not.toContain(text1);
    expect(result).not.toContain(frame1);
  });
});

describe('bulkSetNodeLocked', () => {
  it('locks all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = simulateBulkLock(doc, [rect1, rect2]);
    expect((result.nodes[rect1] as SceneNode).locked).toBe(true);
    expect((result.nodes[rect2] as SceneNode).locked).toBe(true);
  });

  it('does not lock unspecified nodes', () => {
    const { doc, rect1, text1 } = setupDoc();
    const result = simulateBulkLock(doc, [rect1]);
    expect((result.nodes[rect1] as SceneNode).locked).toBe(true);
    expect((result.nodes[text1] as SceneNode).locked).toBe(false);
  });
});

describe('bulkSetNodeVisible', () => {
  it('hides all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = simulateBulkHide(doc, [rect1, rect2]);
    expect((result.nodes[rect1] as SceneNode).visible).toBe(false);
    expect((result.nodes[rect2] as SceneNode).visible).toBe(false);
  });

  it('does not hide unspecified nodes', () => {
    const { doc, rect1, text1 } = setupDoc();
    const result = simulateBulkHide(doc, [rect1]);
    expect((result.nodes[rect1] as SceneNode).visible).toBe(false);
    expect((result.nodes[text1] as SceneNode).visible).toBe(true);
  });
});

describe('bulkSetLayerColor', () => {
  it('sets color tag on all specified nodes', () => {
    const { doc, rect1, rect2 } = setupDoc();
    const result = simulateBulkColorTag(doc, [rect1, rect2], 'green');
    expect((result.nodes[rect1] as SceneNode).layerColor).toBe('green');
    expect((result.nodes[rect2] as SceneNode).layerColor).toBe('green');
  });
});
