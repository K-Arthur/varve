import {
  addChild,
  addNode,
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
} from '@varve/scene';
import { transformRect } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldTransform } from '../../scene/world';

function captureCheck(doc: Document, frameId: string, siblingId: string): boolean {
  const frameNode = doc.nodes[frameId] as any;
  const frameWorld = nodeWorldTransform(doc, frameId);
  const frameBounds = transformRect(frameWorld, { x: 0, y: 0, w: frameNode.w, h: frameNode.h });
  const siblingBounds = transformRect(nodeWorldTransform(doc, siblingId), {
    x: 0,
    y: 0,
    w: 100,
    h: 80,
  });
  return (
    siblingBounds.x >= frameBounds.x &&
    siblingBounds.y >= frameBounds.y &&
    siblingBounds.x + siblingBounds.w <= frameBounds.x + frameBounds.w &&
    siblingBounds.y + siblingBounds.h <= frameBounds.y + frameBounds.h
  );
}

describe('Frame capture world-space AABB', () => {
  it('captures sibling at root level (no transforms)', () => {
    let doc = createDocument('Test', true);
    // Add a parent frame at root
    const parent = makeFrameNode('p', { w: 500, h: 500, name: 'Parent' });
    doc = addNode(doc, parent);
    // Add sibling shape inside parent
    const shape = makeShapeNode(
      's',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      {
        name: 'Shape',
        transform: [1, 0, 0, 1, 20, 20],
      },
    );
    doc = addChild(doc, 'p', shape);
    // Add capture frame inside parent, overlapping shape
    const frame = makeFrameNode('f', { w: 300, h: 200, name: 'Frame' });
    doc = addChild(doc, 'p', { ...frame, transform: [1, 0, 0, 1, 10, 10] });

    expect(captureCheck(doc, 'f', 's')).toBe(true);
  });

  it('does not capture sibling outside frame', () => {
    let doc = createDocument('Test', true);
    const parent = makeFrameNode('p', { w: 500, h: 500, name: 'Parent' });
    doc = addNode(doc, parent);
    const shape = makeShapeNode(
      's',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      {
        name: 'Shape',
        transform: [1, 0, 0, 1, 400, 400],
      },
    );
    doc = addChild(doc, 'p', shape);
    const frame = makeFrameNode('f', { w: 300, h: 200, name: 'Frame' });
    doc = addChild(doc, 'p', { ...frame, transform: [1, 0, 0, 1, 10, 10] });

    expect(captureCheck(doc, 'f', 's')).toBe(false);
  });

  it('correct AABB handles x2 scale parent', () => {
    let doc = createDocument('Test', true);
    // Parent with 2x scale
    const parent = makeFrameNode('p', { w: 500, h: 500, name: 'Parent' });
    doc = addNode(doc, { ...parent, transform: [2, 0, 0, 2, 0, 0] });
    // Shape inside parent at local (20,20)
    const shape = makeShapeNode(
      's',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 80 },
      {
        name: 'Shape',
        transform: [1, 0, 0, 1, 20, 20],
      },
    );
    doc = addChild(doc, 'p', shape);
    // Frame inside parent at local (10,10)
    const frame = makeFrameNode('f', { w: 200, h: 200, name: 'Frame' });
    doc = addChild(doc, 'p', { ...frame, transform: [1, 0, 0, 1, 10, 10] });

    // In local space: shape at (20,20,100,80) inside frame at (10,10,200,200) → yes
    // In world space: 2x scaled. Both grow proportionally.
    // Frame world AABB: transformRect([2,0,0,2,20,20], {0,0,200,200}) = {20,20,400,400}
    // Shape world AABB: transformRect([2,0,0,2,40,40], {0,0,100,80}) = {40,40,200,160}
    expect(captureCheck(doc, 'f', 's')).toBe(true);

    // Verify: frame's world AABB is 2x the local AABB
    const frameWorld = nodeWorldTransform(doc, 'f');
    const frameBounds = transformRect(frameWorld, { x: 0, y: 0, w: 200, h: 200 });
    expect(frameBounds.w).toBe(400);
    expect(frameBounds.h).toBe(400);

    // The BUGGY alternative: frameBounds = { x:world.clickX, y:world.clickY, w:200, h:200 }
    // With scale 2, the world click (local 10,10) would be (20,20). Buggy says w=200, h=200
    // Correct says w=400, h=400 — the 2x scale is not reflected in the buggy bounds.
  });
});
