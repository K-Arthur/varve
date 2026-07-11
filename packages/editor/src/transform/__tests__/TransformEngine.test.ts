import { createDocument, makeFrameNode, makeShapeNode, nextNodeId } from '@strata/scene';
import type { Affine } from '@strata/shared';
import { scaleXY } from '@strata/shared';
import { describe, expect, it } from 'vitest';
import { nodeWorldBounds, nodeWorldTransform } from '../../scene/world';
import { TransformEngine } from '../TransformEngine';

const EPS = 1e-9;

function approx(a: number, b: number, tol = EPS): void {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
}

function approxM(actual: Affine, expected: Affine, tol = EPS): void {
  for (let i = 0; i < 6; i++) {
    approx(actual[i] as number, expected[i] as number, tol);
  }
}

function makeDocWithRect(x = 0, y = 0, w = 10, h = 10, rotation = 0, parentId?: string) {
  let doc = createDocument('test', true);
  const { id: rectId, doc: d1 } = nextNodeId(doc);
  doc = d1;
  const rect = makeShapeNode(
    rectId,
    { kind: 'rect', x: 0, y: 0, w, h },
    { transform: [1, 0, 0, 1, x, y] as Affine, rotation },
  );
  doc = { ...doc, nodes: { ...doc.nodes, [rectId]: rect } };
  if (parentId) {
    const parent = doc.nodes[parentId];
    if (parent && (parent.kind === 'frame' || parent.kind === 'group')) {
      doc = {
        ...doc,
        nodes: { ...doc.nodes, [parentId]: { ...parent, children: [...parent.children, rectId] } },
      };
    }
    doc = { ...doc, rootChildren: doc.rootChildren.filter((id) => id !== rectId) };
  } else {
    doc = { ...doc, rootChildren: [rectId] };
  }
  return { doc, rectId };
}

function makeDocWithTwoRects() {
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
    { transform: [1, 0, 0, 1, 20, 0] as Affine },
  );
  doc = { ...doc, nodes: { ...doc.nodes, [aId]: a, [bId]: b }, rootChildren: [aId, bId] };
  return { doc, aId, bId };
}

describe('TransformEngine', () => {
  it('computes the initial selection box from a single rect', () => {
    const { doc, rectId } = makeDocWithRect(5, 5, 10, 10);
    const engine = new TransformEngine(doc, [rectId]);
    const box = engine.getInitialBox();
    approx(box.cx, 10);
    approx(box.cy, 10);
    approx(box.w, 10);
    approx(box.h, 10);
    approx(box.rotation, 0);
  });

  it('computes the initial selection box for a rotated rect', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 5, 90);
    const engine = new TransformEngine(doc, [rectId]);
    const box = engine.getInitialBox();
    approx(box.cx, -2.5);
    approx(box.cy, 5);
    approx(box.w, 10);
    approx(box.h, 5);
    approx(box.rotation, Math.PI / 2);
  });

  it('computes the initial selection box for multiple rects', () => {
    const { doc, aId, bId } = makeDocWithTwoRects();
    const engine = new TransformEngine(doc, [aId, bId]);
    const box = engine.getInitialBox();
    approx(box.cx, 15);
    approx(box.cy, 5);
    approx(box.w, 30);
    approx(box.h, 10);
    approx(box.rotation, 0);
  });

  it('resizes the east handle of a single rect', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new TransformEngine(doc, [rectId]);
    const newDoc = engine.resize([15, 5], 'e', {});
    const world = nodeWorldBounds(newDoc, rectId);
    expect(world).not.toBeNull();
    approx(world!.x, 0);
    approx(world!.y, 0);
    approx(world!.w, 15);
    approx(world!.h, 10);
  });

  it('scales from the center with centered option', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new TransformEngine(doc, [rectId]);
    // Drag the east handle 10 world units to the right; centered doubles the growth.
    const newDoc = engine.resize([20, 5], 'e', { centered: true });
    const world = nodeWorldBounds(newDoc, rectId);
    expect(world).not.toBeNull();
    approx(world!.w, 30, 1e-6);
    approx(world!.h, 10, 1e-6);
    approx(world!.x, -10, 1e-6);
    approx(world!.y, 0, 1e-6);
  });

  it('rotates a single rect around its center', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new TransformEngine(doc, [rectId]);
    const newDoc = engine.rotate(Math.PI / 2);
    const world = nodeWorldBounds(newDoc, rectId);
    expect(world).not.toBeNull();
    approx(world!.x, 0, 1e-6);
    approx(world!.y, 0, 1e-6);
    approx(world!.w, 10, 1e-6);
    approx(world!.h, 10, 1e-6);
    const mat = nodeWorldTransform(newDoc, rectId);
    approxM(mat, [0, 1, -1, 0, 10, 0] as Affine, 1e-6);
  });

  it('scales a multi-selection from the opposite corner', () => {
    const { doc, aId, bId } = makeDocWithTwoRects();
    const engine = new TransformEngine(doc, [aId, bId]);
    // Drag the south-east handle of the union 10 world units right and 5 down.
    const newDoc = engine.resize([40, 15], 'se', {});
    const worldA = nodeWorldBounds(newDoc, aId);
    const worldB = nodeWorldBounds(newDoc, bId);
    expect(worldA).not.toBeNull();
    expect(worldB).not.toBeNull();
    approx(worldA!.w, 40 / 3, 1e-6);
    approx(worldA!.h, 15, 1e-6);
    approx(worldB!.w, 40 / 3, 1e-6);
    approx(worldB!.h, 15, 1e-6);
  });

  it('applies the delta matrix to the node transform', () => {
    const { doc, rectId } = makeDocWithRect(0, 0, 10, 10);
    const engine = new TransformEngine(doc, [rectId]);
    const newDoc = engine.resize([15, 5], 'e', {});
    const node = newDoc.nodes[rectId];
    expect(node).toBeDefined();
    if (!node) throw new Error('Node missing');
    expect(node.transform).toBeDefined();
    // Live transform: the scale is stored in node.transform, shape stays unchanged.
    approxM(node.transform, [1.5, 0, 0, 1, 0, 0] as Affine, 1e-6);
    // The full world transform is the same as the local transform (no rotation).
    const mat = nodeWorldTransform(newDoc, rectId);
    const expected = scaleXY(1.5, 1);
    approxM(mat, expected, 1e-6);
  });

  it('supports nested nodes (parent transform preserved)', () => {
    let doc = createDocument('test', true);
    const { id: frameId, doc: d1 } = nextNodeId(doc);
    doc = d1;
    const { id: rectId, doc: d2 } = nextNodeId(doc);
    doc = d2;
    const frame = makeFrameNode(frameId, {
      transform: [1, 0, 0, 1, 10, 0] as Affine,
      w: 100,
      h: 100,
      children: [rectId],
    });
    const rect = makeShapeNode(
      rectId,
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { transform: [1, 0, 0, 1, 0, 0] as Affine },
    );
    doc = {
      ...doc,
      nodes: { ...doc.nodes, [frameId]: frame, [rectId]: rect },
      rootChildren: [frameId],
    };

    const engine = new TransformEngine(doc, [rectId]);
    // Drag the east handle of the rect from its world position (20,5) to (25,5).
    const newDoc = engine.resize([25, 5], 'e', {});
    const world = nodeWorldBounds(newDoc, rectId);
    expect(world).not.toBeNull();
    approx(world!.x, 10, 1e-6);
    approx(world!.y, 0, 1e-6);
    approx(world!.w, 15, 1e-6);
    approx(world!.h, 10, 1e-6);
  });
});
