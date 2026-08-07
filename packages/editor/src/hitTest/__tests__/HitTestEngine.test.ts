import {
  addChild,
  addPage as addPage2,
  createClippingMask,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { HitTestEngine } from '..';

function makeDocWithRect(x = 0, y = 0, w = 10, h = 10) {
  let doc = createDocument('test', true);
  const { id: rectId, doc: d1 } = nextNodeId(doc);
  doc = d1;
  const rect = makeShapeNode(
    rectId,
    { kind: 'rect', x: 0, y: 0, w, h },
    { transform: [1, 0, 0, 1, x, y] as Affine },
  );
  doc = { ...doc, nodes: { ...doc.nodes, [rectId]: rect }, rootChildren: [rectId] };
  return { doc, rectId };
}

describe('HitTestEngine', () => {
  it('returns null for an empty document', () => {
    const doc = createDocument('test', true);
    const engine = new HitTestEngine(doc);
    expect(engine.hitTest({ x: 0, y: 0 })).toBeNull();
  });

  it('hits a single rect', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new HitTestEngine(doc);
    const hit = engine.hitTest({ x: 5, y: 5 });
    expect(hit).not.toBeNull();
    expect(hit?.nodeId).toBe(rectId);
  });

  it('returns null when point is outside the rect', () => {
    const { doc } = makeDocWithRect(0, 0, 10, 10);
    const engine = new HitTestEngine(doc);
    expect(engine.hitTest({ x: 20, y: 20 })).toBeNull();
  });

  it('skips locked nodes', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const locked = { ...doc.nodes[rectId]!, locked: true };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [rectId]: locked } };
    const engine = new HitTestEngine(doc2);
    expect(engine.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('skips invisible nodes', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const hidden = { ...doc.nodes[rectId]!, visible: false };
    const doc2 = { ...doc, nodes: { ...doc.nodes, [rectId]: hidden } };
    const engine = new HitTestEngine(doc2);
    expect(engine.hitTest({ x: 5, y: 5 })).toBeNull();
  });

  it('returns topmost node for overlapping shapes', () => {
    let doc = createDocument('test', true);
    const { id: aId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: bId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = makeShapeNode(
      aId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    const b = makeShapeNode(
      bId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 2, 2] as Affine },
    );
    doc = { ...doc, nodes: { ...doc.nodes, [aId]: a, [bId]: b }, rootChildren: [aId, bId] };
    const engine = new HitTestEngine(doc);
    const hit = engine.hitTest({ x: 5, y: 5 });
    expect(hit?.nodeId).toBe(bId);
  });

  it('finds all nodes at a point in paint order (topmost last)', () => {
    let doc = createDocument('test', true);
    const { id: aId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: bId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const a = makeShapeNode(
      aId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    const b = makeShapeNode(
      bId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    doc = { ...doc, nodes: { ...doc.nodes, [aId]: a, [bId]: b }, rootChildren: [aId, bId] };
    const engine = new HitTestEngine(doc);
    const all = engine.findNodesAtPoint({ x: 5, y: 5 });
    expect(all.map((n) => n.nodeId)).toEqual([bId, aId]);
  });

  it('respects isolation mode', () => {
    let doc = createDocument('test', true);
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: rectId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [rectId],
    });
    const rect = makeShapeNode(
      rectId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 5, 5] as Affine },
    );
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, [rectId]: rect },
      rootChildren: [frameId],
    };
    const engine = new HitTestEngine(doc, { isolatedNodeId: rectId });
    const hit = engine.hitTest({ x: 7, y: 7 });
    expect(hit?.nodeId).toBe(rectId);

    const engine2 = new HitTestEngine(doc, { isolatedNodeId: frameId });
    expect(engine2.hitTest({ x: 50, y: 50 })?.nodeId).toBe(frameId);
  });

  it('does not hit clipped content outside the mask geometry', () => {
    let doc = createDocument('test', true);
    const maskId = 'mask';
    const contentId = 'content';
    doc = {
      ...doc,
      nodes: {
        [maskId]: makeShapeNode(maskId, { kind: 'circle', cx: 10, cy: 10, r: 10 }),
        [contentId]: makeShapeNode(contentId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      },
      rootChildren: [maskId, contentId],
    };
    doc = createClippingMask(doc, maskId, [contentId]).doc;

    const engine = new HitTestEngine(doc, { zoom: 100 });
    expect(engine.hitTest({ x: 10, y: 10 })?.nodeId).toBeTruthy();
    expect(engine.hitTest({ x: 80, y: 80 })).toBeNull();
  });

  it('deepSelect returns deepest non-container child instead of parent container', () => {
    let doc = createDocument('test', true);
    // Create child rect before frame so frameId is larger (later in paint order)
    const { id: rectId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: frameId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const rect = makeShapeNode(
      rectId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 5, 5] as Affine },
    );
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [rectId],
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, [rectId]: rect },
      rootChildren: [frameId],
    };
    // Without deepSelect: returns the frame (topmost)
    const normal = new HitTestEngine(doc);
    const normalHit = normal.hitTest({ x: 7, y: 7 });
    expect(normalHit?.nodeId).toBeDefined();
    // With deepSelect: returns the child rect (deepest non-container)
    const deep = new HitTestEngine(doc, { deepSelect: true });
    const deepHit = deep.hitTest({ x: 7, y: 7 });
    expect(deepHit?.nodeId).toBe(rectId);
  });

  it('deepSelect returns container when no non-container child is hit', () => {
    let doc = createDocument('test', true);
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 0, 0] as Affine,
      w: 100,
      h: 100,
      children: [],
    });
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame },
      rootChildren: [frameId],
    };
    // No children, so deepSelect falls back to the container
    const engine = new HitTestEngine(doc, { deepSelect: true });
    expect(engine.hitTest({ x: 50, y: 50 })?.nodeId).toBe(frameId);
  });

  it('honours compound-path holes and inverted clipping during hit testing', () => {
    let doc = createDocument('test', true);
    const maskId = 'mask';
    const contentId = 'content';
    const ring = (x0: number, y0: number, x1: number, y1: number) => [
      { x: x0, y: y0, handleIn: null, handleOut: null },
      { x: x1, y: y0, handleIn: null, handleOut: null },
      { x: x1, y: y1, handleIn: null, handleOut: null },
      { x: x0, y: y1, handleIn: null, handleOut: null },
    ];
    doc = {
      ...doc,
      nodes: {
        [maskId]: makeShapeNode(maskId, {
          kind: 'path',
          points: ring(0, 0, 100, 100),
          holes: [ring(25, 25, 75, 75)],
          closed: true,
          tolerance: 1,
          fillRule: 'evenodd',
        }),
        [contentId]: makeShapeNode(contentId, { kind: 'rect', x: 0, y: 0, w: 100, h: 100 }),
      },
      rootChildren: [maskId, contentId],
    };
    doc = createClippingMask(doc, maskId, [contentId]).doc;
    const groupId = doc.rootChildren[0]!;
    const engine = new HitTestEngine(doc, { zoom: 100 });
    expect(engine.hitTest({ x: 10, y: 10 })?.nodeId).toBeTruthy();
    expect(engine.hitTest({ x: 50, y: 50 })).toBeNull();

    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [groupId]: {
          ...doc.nodes[groupId]!,
          mask: { ...doc.nodes[groupId]!.mask!, inverted: true },
        },
      },
    };
    const inverted = new HitTestEngine(doc, { zoom: 100 });
    expect(inverted.hitTest({ x: 10, y: 10 })).toBeNull();
    expect(inverted.hitTest({ x: 50, y: 50 })?.nodeId).toBeTruthy();
  });

  describe('scaling with overlapping candidates', () => {
    /** N overlapping rects at the same point -- all survive spatial filtering. */
    function makeStackedDoc(count: number) {
      let doc = createDocument('test', true);
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const { id, doc: d1 } = nextNodeId(doc);
        doc = d1;
        const rect = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, {});
        doc = { ...doc, nodes: { ...doc.nodes, [id]: rect } };
        ids.push(id);
      }
      return { ...doc, rootChildren: ids };
    }

    it('hitTest scales near-linearly with candidate count, not quadratically', () => {
      // Regression guard: hitTest()/findNodesAtPoint() call nodeWorldTransform/
      // nodeWorldBounds once per candidate without the engine's own
      // `this.parentIndex` (built once in the constructor for exactly this
      // purpose, but left unwired at these call sites) -- so each candidate
      // fell back to an O(n) linear scan (getParent), making a single
      // hitTest() call O(candidates^2) when most nodes overlap the query
      // point. 8x nodes should cost nowhere near 8x^2 = 64x time.
      const small = makeStackedDoc(300);
      const large = makeStackedDoc(2400); // 8x

      const engineSmall = new HitTestEngine(small);
      const t0 = performance.now();
      engineSmall.hitTest({ x: 5, y: 5 });
      const smallMs = performance.now() - t0;

      const engineLarge = new HitTestEngine(large);
      const t1 = performance.now();
      engineLarge.hitTest({ x: 5, y: 5 });
      const largeMs = performance.now() - t1;

      expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 200));
    });

    it('findNodesAtPoint scales near-linearly with candidate count, not quadratically', () => {
      const small = makeStackedDoc(300);
      const large = makeStackedDoc(2400);

      const engineSmall = new HitTestEngine(small);
      const t0 = performance.now();
      engineSmall.findNodesAtPoint({ x: 5, y: 5 });
      const smallMs = performance.now() - t0;

      const engineLarge = new HitTestEngine(large);
      const t1 = performance.now();
      engineLarge.findNodesAtPoint({ x: 5, y: 5 });
      const largeMs = performance.now() - t1;

      expect(largeMs).toBeLessThan(Math.max(smallMs * 20, 200));
    });
  });

  describe('cross-page hit testing (ADR-0144 shared canvas)', () => {
    it('hits content on any placed page, not just the active page', () => {
      let doc = createDocument('test', false);
      // Two pages with explicit placements, page 2 inactive.
      const [p1] = [doc.pages![0]!];
      const { doc: d1 } = nextNodeId(doc);
      doc = addPage2(d1);
      const [p1b, p2] = [doc.pages![0]!, doc.pages![1]!];
      doc = {
        ...doc,
        pages: [
          { ...p1b, placement: { x: 0, y: 0 } },
          { ...p2, placement: { x: 220, y: 0 } },
        ],
      };
      void p1;

      // Shape on page 1 at page-local (10,10) and shape on page 2 at (10,10).
      const { id: shapeA, doc: d2 } = nextNodeId(doc);
      doc = addChild(
        d2,
        p1b.contentRoot,
        makeShapeNode(
          shapeA,
          { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );
      const { id: shapeB, doc: d3 } = nextNodeId(doc);
      doc = addChild(
        d3,
        p2.contentRoot,
        makeShapeNode(
          shapeB,
          { kind: 'rect', x: 0, y: 0, w: 50, h: 50 },
          { transform: [1, 0, 0, 1, 10, 10] as Affine },
        ),
      );

      const engine = new HitTestEngine(doc);
      // World point inside page 2's placed bounds (page-local 30,30).
      const hit = engine.hitTest({ x: 220 + 30, y: 30 });
      expect(hit?.nodeId).toBe(shapeB);
      // Active page stays page 1 — hit testing is not gated on it.
      expect(doc.activePageId).toBe(p1b.id);
      // Pasteboard point between pages hits nothing.
      expect(engine.hitTest({ x: 210, y: 30 })).toBeNull();
    });
  });
});
