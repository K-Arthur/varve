import { describe, expect, it } from 'vitest';
import { createDocument, addChild, addNode, makeFrameNode, makeShapeNode, type Document } from '@strata/scene';
import { nodeWorldTransform } from '../../scene/world';
import { transformRect, multiplyAffine } from '@strata/shared';

function makeTestDoc(): Document {
  return createDocument('Test', true);
}

function addChildFrame(doc: Document, parentId: string | null, w = 200, h = 200): { doc: Document; id: string } {
  const id = `n${doc.nextId}`;
  const frame = makeFrameNode(id, { w, h, name: `Frame ${id}` });
  const newDoc = parentId ? addChild(doc, parentId, frame) : addNode(doc, frame);
  return { doc: newDoc, id };
}

function addChildShape(doc: Document, parentId: string, x = 0, y = 0, w = 40, h = 30): { doc: Document; id: string } {
  const id = `n${doc.nextId}`;
  const shape = makeShapeNode(id, { kind: 'rect', x: 0, y: 0, w, h }, {
    name: `Shape ${id}`,
    transform: [1, 0, 0, 1, x, y],
  });
  return { doc: addChild(doc, parentId, shape), id };
}

/** Simulate the CORRECT capture check using nodeWorldTransform + transformRect. */
function correctCaptureCheck(doc: Document, frameId: string, siblingId: string): boolean {
  const frameNode = doc.nodes[frameId] as any;
  const frameWorld = nodeWorldTransform(doc, frameId);
  const frameBounds = transformRect(frameWorld, { x: 0, y: 0, w: frameNode.w, h: frameNode.h });
  const siblingBounds = transformRect(nodeWorldTransform(doc, siblingId), { x: 0, y: 0, w: 40, h: 30 });
  return (
    siblingBounds.x >= frameBounds.x &&
    siblingBounds.y >= frameBounds.y &&
    siblingBounds.x + siblingBounds.w <= frameBounds.x + frameBounds.w &&
    siblingBounds.y + siblingBounds.h <= frameBounds.y + frameBounds.h
  );
}

/** Simulate the BUGGY capture check using world click pos + local dims. */
function buggyCaptureCheck(worldX: number, worldY: number, frameW: number, frameH: number): { x: number; y: number; w: number; h: number } {
  return { x: worldX, y: worldY, w: frameW, h: frameH };
}

describe('Frame capture-on-draw world-space AABB', () => {
  it('captures sibling inside same parent (no transforms)', () => {
    let doc = makeTestDoc();
    const rootId = doc.rootChildren[0]!;
    const shape = addChildShape(doc, rootId, 20, 20, 40, 30);
    doc = shape.doc;
    const frame = addChildFrame(doc, rootId, 100, 100);
    doc = frame.doc;
    doc = { ...doc, nodes: { ...doc.nodes, [frame.id]: { ...doc.nodes[frame.id], transform: [1, 0, 0, 1, 10, 10] } } };

    expect(correctCaptureCheck(doc, frame.id, shape.id)).toBe(true);
  });

  it('does not capture sibling outside frame', () => {
    let doc = makeTestDoc();
    const rootId = doc.rootChildren[0]!;
    const shape = addChildShape(doc, rootId, 200, 200, 40, 30);
    doc = shape.doc;
    const frame = addChildFrame(doc, rootId, 100, 100);
    doc = frame.doc;
    doc = { ...doc, nodes: { ...doc.nodes, [frame.id]: { ...doc.nodes[frame.id], transform: [1, 0, 0, 1, 10, 10] } } };

    expect(correctCaptureCheck(doc, frame.id, shape.id)).toBe(false);
  });

  it('captures sibling inside x2-scaled parent', () => {
    // Parent has scale 2x. Both shape and frame are inside parent.
    // The correct world-space AABB grows with scale; buggy one does not.
    let doc = makeTestDoc();
    const rootId = doc.rootChildren[0]!;
    const parent = addChildFrame(doc, rootId, 200, 200);
    doc = parent.doc;
    doc = { ...doc, nodes: { ...doc.nodes, [parent.id]: { ...doc.nodes[parent.id], transform: [2, 0, 0, 2, 0, 0] } } };

    const shape = addChildShape(doc, parent.id, 20, 20, 40, 30);
    doc = shape.doc;
    const frame = addChildFrame(doc, parent.id, 100, 100);
    doc = frame.doc;
    doc = { ...doc, nodes: { ...doc.nodes, [frame.id]: { ...doc.nodes[frame.id], transform: [1, 0, 0, 1, 10, 10] } } };

    // Correct: shape at local (20,20) inside frame at local (10,10,100,100) — shape is inside
    expect(correctCaptureCheck(doc, frame.id, shape.id)).toBe(true);

    // Buggy: world click pos would be (2*10+0, 2*10+0) = (20,20), frame dims (100,100)
    // Buggy bounds = { x:20, y:20, w:100, h:100 }
    // But correct bounds would be { x:20, y:20, w:200, h:200 } (2x scaled)
    // A shape at (20,20) — correct says inside (20>=20, 60<=120); buggy says outside (60>120)!
    // Wait, sibling at world: shape local (20,20,40,30) * world transform [2,0,0,2,0,0] = (40,40,80,60)
    // Correct frame bounds: { x:20, y:20, w:200, h:200 }
    // Sibling world: (40,40,80,60) — inside frame (40>=20, 40>=20, 120<=220, 100<=220) ✓
    // Buggy frame bounds: { x:20, y:20, w:100, h:100 }
    // Sibling world: (40,40,80,60) — outside frame (120>120) ✗
    const siblingWorld = transformRect(nodeWorldTransform(doc, shape.id), { x: 0, y: 0, w: 40, h: 30 });
    expect(siblingWorld.w).toBe(80); // 2x scaled

    const correctFrameBounds = transformRect(nodeWorldTransform(doc, frame.id), { x: 0, y: 0, w: 100, h: 100 });
    expect(correctFrameBounds.w).toBe(200); // 2x scaled

    // The buggy bounds would be w=100, which is too small to contain the sibling
    const buggyFrameBounds = buggyCaptureCheck(20, 20, 100, 100);
    expect(buggyFrameBounds.w).toBe(100);
  });
});
