import {
  addChild,
  addNode,
  createDocument,
  type Document,
  getParent,
  makeFrameNode,
  makeImageShapeNode,
  makeShapeNode,
  type SceneNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  alignSelectionInDocument,
  commonAlignmentContainerBounds,
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
    expect(capabilities.canAlignToPage).toBe(false);
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

  it('aligns one eligible object to explicit page bounds while page takes precedence over a key object', () => {
    let doc = createDocument('single page alignment');
    const a = rect('a', 35, 20, 40, 30);
    doc = addNode(doc, a);

    const capabilities = getAlignmentCapabilities(doc, [a.id]);
    const next = alignSelectionInDocument(doc, [a.id], 'right', {
      pageBounds: { x: 120, y: 40, w: 200, h: 100 },
      keyObjectId: a.id,
    });

    expect(capabilities.canAlign).toBe(false);
    expect(capabilities.canAlignToPage).toBe(true);
    expect(bounds(next, a.id)).toMatchObject({ x: 280, y: 20, w: 40, h: 30 });
  });

  it('aligns a single child to its nearest common frame bounds', () => {
    let doc = createDocument('container target alignment');
    const frame = makeFrameNode('frame', {
      w: 240,
      h: 160,
      transform: [1, 0, 0, 1, 300, 120],
    });
    const child = rect('child', 35, 20, 40, 30);
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, child);

    const containerBounds = commonAlignmentContainerBounds(doc, [child.id]);
    expect(containerBounds).toEqual({ x: 300, y: 120, w: 240, h: 160 });
    const capabilities = getAlignmentCapabilities(doc, [child.id]);
    expect(capabilities.canAlign).toBe(false);
    expect(capabilities.canAlignToContainer).toBe(true);

    const next = alignSelectionInDocument(doc, [child.id], 'right', {
      reference: 'container',
      containerBounds,
    });
    expect(bounds(next, child.id).x + bounds(next, child.id).w).toBe(540);
    expect(getParent(next, child.id)).toBe(frame.id);
  });

  it('aligns an image and a line inside a transformed frame without changing their local parentage', () => {
    let doc = createDocument('nested image and line alignment');
    const frame = makeFrameNode('frame', {
      w: 500,
      h: 300,
      transform: [0.8660254038, 0.5, -0.5, 0.8660254038, 240, 180],
    });
    const image = makeImageShapeNode('image', {
      name: 'Photo',
      src: 'photo.png',
      w: 90,
      h: 60,
      transform: [1, 0, 0, 1, 120, 40],
    });
    const line = makeShapeNode(
      'line',
      { kind: 'line', from: [0, 0], to: [100, 20], tolerance: 3 },
      { name: 'Line', transform: [1, 0, 0, 1, 30, 180] },
    );
    doc = addNode(doc, frame);
    doc = addChild(doc, frame.id, image);
    doc = addChild(doc, frame.id, line);

    const next = alignSelectionInDocument(doc, [image.id, line.id], 'left');

    expectClose(bounds(next, image.id).x, bounds(next, line.id).x);
    expect(getParent(next, image.id)).toBe(frame.id);
    expect(getParent(next, line.id)).toBe(frame.id);
    expect(next.nodes[image.id]?.fills[0]?.type).toBe('image');
  });

  it('aligns an image in a nested transformed frame with a container sibling without flattening either hierarchy', () => {
    let doc = createDocument('nested frame image alignment');
    const outer = makeFrameNode('outer', {
      w: 600,
      h: 400,
      transform: [1.0625184089, 0.2847009496, -0.2847009496, 1.0625184089, 180, 110],
    });
    const inner = makeFrameNode('inner', {
      w: 260,
      h: 200,
      transform: [0.9659258263, -0.2588190451, 0.2588190451, 0.9659258263, 90, 70],
    });
    const image = makeImageShapeNode('image', {
      name: 'Nested photo',
      src: 'photo.png',
      w: 80,
      h: 60,
      transform: [1, 0, 0, 1, 95, 40],
    });
    const sibling = rect('sibling', 350, 170, 70, 50);
    doc = addNode(doc, outer);
    doc = addChild(doc, outer.id, inner);
    doc = addChild(doc, inner.id, image);
    doc = addChild(doc, outer.id, sibling);

    const imageLinear = image.transform.slice(0, 4);
    const siblingLinear = sibling.transform.slice(0, 4);
    const next = alignSelectionInDocument(doc, [image.id, sibling.id], 'left');

    expectClose(bounds(next, image.id).x, bounds(next, sibling.id).x);
    expect(getParent(next, inner.id)).toBe(outer.id);
    expect(getParent(next, image.id)).toBe(inner.id);
    expect(getParent(next, sibling.id)).toBe(outer.id);
    expect(next.nodes[image.id]?.transform.slice(0, 4)).toEqual(imageLinear);
    expect(next.nodes[sibling.id]?.transform.slice(0, 4)).toEqual(siblingLinear);
    expect(next.nodes[image.id]?.fills[0]?.type).toBe('image');
  });

  it('aligns nested image and sibling roots to their common transformed frame', () => {
    let doc = createDocument('common transformed frame target');
    const outer = makeFrameNode('outer', {
      w: 600,
      h: 400,
      transform: [1.0625184089, 0.2847009496, -0.2847009496, 1.0625184089, 180, 110],
    });
    const inner = makeFrameNode('inner', {
      w: 260,
      h: 200,
      transform: [0.9659258263, -0.2588190451, 0.2588190451, 0.9659258263, 90, 70],
    });
    const image = makeImageShapeNode('image', {
      name: 'Nested photo',
      src: 'photo.png',
      w: 80,
      h: 60,
      transform: [1, 0, 0, 1, 95, 40],
    });
    const sibling = rect('sibling', 350, 170, 70, 50);
    doc = addNode(doc, outer);
    doc = addChild(doc, outer.id, inner);
    doc = addChild(doc, inner.id, image);
    doc = addChild(doc, outer.id, sibling);

    const containerBounds = commonAlignmentContainerBounds(doc, [image.id, sibling.id]);
    expect(containerBounds).toEqual(bounds(doc, outer.id));
    const next = alignSelectionInDocument(doc, [image.id, sibling.id], 'right', {
      reference: 'container',
      containerBounds,
    });

    expectClose(
      bounds(next, image.id).x + bounds(next, image.id).w,
      containerBounds!.x + containerBounds!.w,
    );
    expectClose(
      bounds(next, sibling.id).x + bounds(next, sibling.id).w,
      containerBounds!.x + containerBounds!.w,
    );
    expect(getParent(next, image.id)).toBe(inner.id);
    expect(getParent(next, sibling.id)).toBe(outer.id);
    expect(next.nodes[image.id]?.fills[0]?.type).toBe('image');
  });

  it('allows absolute auto-layout children but excludes flow children and hidden ancestors', () => {
    let doc = createDocument('layout eligibility');
    const layout = makeFrameNode('layout', {
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
    const flow = rect('flow', 20, 0, 30, 30);
    const absolute = { ...rect('absolute', 110, 0, 30, 30), layoutPosition: 'absolute' };
    const peer = rect('peer', 320, 20, 30, 30);
    const hiddenFrame = { ...makeFrameNode('hidden-frame', { w: 100, h: 100 }), visible: false };
    const hiddenChild = rect('hidden-child', 10, 10, 20, 20);
    doc = addNode(doc, layout);
    doc = addChild(doc, layout.id, flow);
    doc = addChild(doc, layout.id, absolute);
    doc = addNode(doc, peer);
    doc = addNode(doc, hiddenFrame);
    doc = addChild(doc, hiddenFrame.id, hiddenChild);

    const capabilities = getAlignmentCapabilities(doc, [
      flow.id,
      absolute.id,
      peer.id,
      hiddenChild.id,
    ]);
    const next = alignSelectionInDocument(
      doc,
      [flow.id, absolute.id, peer.id, hiddenChild.id],
      'left',
    );

    expect(capabilities.canAlign).toBe(true);
    expect(capabilities.hasLayoutManagedSelection).toBe(true);
    expect(capabilities.hasLockedOrHiddenSelection).toBe(true);
    expect(next.nodes[flow.id]?.transform).toEqual(flow.transform);
    expect(next.nodes[hiddenChild.id]?.transform).toEqual(hiddenChild.transform);
    expectClose(bounds(next, absolute.id).x, bounds(next, peer.id).x);
  });
});
