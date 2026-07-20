import {
  createClippingMask,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  nextNodeId,
} from '@strata/scene';
import type { Affine } from '@strata/shared';
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
});
