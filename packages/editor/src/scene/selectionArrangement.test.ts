import {
  addChild,
  addNode,
  createDocument,
  type Document,
  getParent,
  makeFrameNode,
  makeShapeNode,
  type SceneNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  alignSelectionInDocument,
  distributeSelectionInDocument,
  getAlignmentCapabilities,
} from './selectionArrangement';
import { nodeWorldBounds } from './world';

const EPSILON = 1e-8;

function rect(id: string, x: number, y: number, w: number, h: number): SceneNode {
  return makeShapeNode(
    id,
    { kind: 'rect', x: 0, y: 0, w, h },
    { name: id, transform: [1, 0, 0, 1, x, y] },
  );
}

function bounds(doc: Document, id: string) {
  const value = nodeWorldBounds(doc, id);
  if (!value) throw new Error(`Expected bounds for ${id}`);
  return value;
}

function expectClose(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(EPSILON);
}

describe('selectionArrangement', () => {
  it('aligns across transformed containers in world space without changing parentage or linear transforms', () => {
    let doc = createDocument('cross-container alignment');
    const frameA = makeFrameNode('frame-a', {
      w: 300,
      h: 200,
      transform: [1.0392304845, 0.6, -0.6, 1.0392304845, 120, 80],
    });
    const frameB = makeFrameNode('frame-b', {
      w: 300,
      h: 200,
      transform: [0.9659258263, -0.2588190451, 0.2588190451, 0.9659258263, 480, 220],
    });
    const a = rect('a', 25, 30, 90, 40);
    const b = rect('b', 45, 60, 70, 60);
    doc = addNode(doc, frameA);
    doc = addNode(doc, frameB);
    doc = addChild(doc, frameA.id, a);
    doc = addChild(doc, frameB.id, b);

    const originalATransform = [...a.transform];
    const originalBTransform = [...b.transform];
    const next = alignSelectionInDocument(doc, [a.id, b.id], 'left');
    const aBounds = bounds(next, a.id);
    const bBounds = bounds(next, b.id);

    expectClose(aBounds.x, bBounds.x);
    expect(getParent(next, a.id)).toBe(frameA.id);
    expect(getParent(next, b.id)).toBe(frameB.id);
    expect(next.nodes[a.id]?.transform.slice(0, 4)).toEqual(originalATransform.slice(0, 4));
    expect(next.nodes[b.id]?.transform.slice(0, 4)).toEqual(originalBTransform.slice(0, 4));
  });

  it('filters selected descendants so an aligned container never double-transforms its child', () => {
    let doc = createDocument('parent child alignment');
    const frame = makeFrameNode('frame', { w: 200, h: 120, transform: [1, 0, 0, 1, 80, 30] });
    const child = rect('child', 25, 10, 20, 20);
    const peer = rect('peer', 0, 70, 40, 20);
    doc = addNode(doc, frame);
    doc = addNode(doc, peer);
    doc = addChild(doc, frame.id, child);

    const before = bounds(doc, child.id);
    const next = alignSelectionInDocument(doc, [frame.id, child.id, peer.id], 'left');
    const after = bounds(next, child.id);

    expect(next.nodes[child.id]?.transform).toEqual(child.transform);
    expectClose(after.x, before.x - 80);
    expectClose(after.y, before.y);
  });

  it('keeps outer bounds fixed and uses equal negative gaps when selected objects exceed their span', () => {
    let doc = createDocument('negative gap distribution');
    const a = rect('a', 0, 0, 40, 10);
    const b = rect('b', 10, 20, 40, 10);
    const c = rect('c', 30, 40, 40, 10);
    doc = addNode(doc, a);
    doc = addNode(doc, b);
    doc = addNode(doc, c);

    const next = distributeSelectionInDocument(doc, [c.id, a.id, b.id], 'horizontal');
    const aBounds = bounds(next, a.id);
    const bBounds = bounds(next, b.id);
    const cBounds = bounds(next, c.id);

    expectClose(aBounds.x, 0);
    expectClose(cBounds.x + cBounds.w, 70);
    expectClose(bBounds.x - (aBounds.x + aBounds.w), cBounds.x - (bBounds.x + bBounds.w));
    expect(bBounds.x - (aBounds.x + aBounds.w)).toBeLessThan(0);
  });

  it('does not mutate locked or flow-managed children and exposes that capability state', () => {
    let doc = createDocument('manual positioning eligibility');
    const layoutFrame = makeFrameNode('layout', {
      w: 300,
      h: 120,
      layoutStyle: {
        mode: 'flex',
        direction: 'row',
        gap: 10,
        wrap: false,
        padding: [0, 0, 0, 0],
        grow: 0,
        shrink: 0,
      },
    });
    const flow = rect('flow', 10, 0, 40, 30);
    const locked = { ...rect('locked', 100, 0, 40, 30), locked: true } as SceneNode;
    doc = addNode(doc, layoutFrame);
    doc = addChild(doc, layoutFrame.id, flow);
    doc = addChild(doc, layoutFrame.id, locked);

    const capabilities = getAlignmentCapabilities(doc, [flow.id, locked.id]);
    const next = alignSelectionInDocument(doc, [flow.id, locked.id], 'left');

    expect(capabilities.canAlign).toBe(false);
    expect(capabilities.hasLayoutManagedSelection).toBe(true);
    expect(capabilities.hasLockedOrHiddenSelection).toBe(true);
    expect(next).toBe(doc);
  });

  it('returns the original document for an already-aligned selection', () => {
    let doc = createDocument('no-op alignment');
    const a = rect('a', 10, 0, 20, 10);
    const b = rect('b', 10, 30, 30, 10);
    doc = addNode(doc, a);
    doc = addNode(doc, b);

    expect(alignSelectionInDocument(doc, [a.id, b.id], 'left')).toBe(doc);
  });
});
