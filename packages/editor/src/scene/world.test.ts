import type { Affine } from '@strata/engine';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { nodeLocalBounds, nodeWorldBounds, nodeWorldTransform } from './world';

function buildDoc() {
  let doc = createDocument();

  // Frame A at world (100, 100)
  const frameA = makeFrameNode('f1', {
    name: 'FrameA',
    transform: [1, 0, 0, 1, 100, 100] as Affine,
  });
  doc = addNode(doc, frameA);

  // Frame B inside Frame A at local (50, 0)
  const frameB = makeFrameNode('f2', {
    name: 'FrameB',
    transform: [1, 0, 0, 1, 50, 0] as Affine,
  });
  doc = addChild(doc, 'f1', frameB);

  // Shape C inside Frame B at local (20, 30)
  const rect = makeShapeNode(
    's1',
    { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
    { name: 'RectC', transform: [1, 0, 0, 1, 20, 30] as Affine },
  );
  doc = addChild(doc, 'f2', rect);

  // Root-level shape D at (200, 50)
  const rootShape = makeShapeNode(
    's2',
    { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
    { name: 'RootD', transform: [1, 0, 0, 1, 200, 50] as Affine },
  );
  doc = addNode(doc, rootShape);

  return doc;
}

const EPS = 1e-9;

describe('nodeWorldTransform', () => {
  it('returns identity for a non-existent node', () => {
    const doc = createDocument();
    const t = nodeWorldTransform(doc, 'nonexistent');
    expect(t).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('returns the node transform for a root-level node', () => {
    const doc = buildDoc();
    const t = nodeWorldTransform(doc, 's2');
    expect(t).toEqual([1, 0, 0, 1, 200, 50]);
  });

  it('composes parent transforms for a nested node', () => {
    const doc = buildDoc();
    // Shape C: local transform (20,30) inside FrameB (50,0) inside FrameA (100,100)
    // World = parentA · parentB · child = translate(100,100) · translate(50,0) · translate(20,30)
    // = translate(170, 130)
    const t = nodeWorldTransform(doc, 's1');
    expect(t[4]).toBeCloseTo(170, EPS);
    expect(t[5]).toBeCloseTo(130, EPS);
    expect(t[0]).toBeCloseTo(1, EPS);
    expect(t[1]).toBeCloseTo(0, EPS);
    expect(t[2]).toBeCloseTo(0, EPS);
    expect(t[3]).toBeCloseTo(1, EPS);
  });

  it('composes through a frame-only chain (no child transform)', () => {
    const doc = buildDoc();
    const t = nodeWorldTransform(doc, 'f2');
    expect(t[4]).toBeCloseTo(150, EPS);
    expect(t[5]).toBeCloseTo(100, EPS);
  });
});

describe('nodeLocalBounds', () => {
  it('returns the shape bounds for a rect', () => {
    const doc = buildDoc();
    const node = doc.nodes.s1;
    if (!node) return;
    const b = nodeLocalBounds(node);
    expect(b).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('returns null for groups', () => {
    const doc = createDocument();
    const g = makeGroupNode('g1', { name: 'Group' });
    const d = addNode(doc, g);
    const node = d.nodes.g1;
    if (!node) throw new Error('g1 not found');
    const b = nodeLocalBounds(node);
    expect(b).toBeNull();
  });

  it('path shape localBounds returns bounds from points', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p1',
      {
        kind: 'path',
        points: [
          { x: 10, y: 20, handleIn: null, handleOut: null },
          { x: 50, y: 80, handleIn: null, handleOut: null },
          { x: 100, y: 30, handleIn: null, handleOut: null },
        ],
        closed: true,
        tolerance: 2,
      },
      { name: 'Path' },
    );
    const d = addNode(doc, pathNode);
    const n1 = d.nodes.p1;
    if (!n1) throw new Error('node not found');
    const b = nodeLocalBounds(n1);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(10, 4);
    expect(b.y).toBeCloseTo(20, 4);
    expect(b.w).toBeCloseTo(90, 4);
    expect(b.h).toBeCloseTo(60, 4);
  });

  it('arrow shape localBounds returns bounds from from/to', () => {
    const doc = createDocument();
    const arrNode = makeShapeNode(
      'a1',
      {
        kind: 'arrow',
        from: [15, 25],
        to: [80, 120],
        tolerance: 2,
        arrowheadSize: 10,
      },
      { name: 'Arrow' },
    );
    const d = addNode(doc, arrNode);
    const a1 = d.nodes.a1;
    if (!a1) throw new Error('node not found');
    const b = nodeLocalBounds(a1);
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(15, 4);
    expect(b.y).toBeCloseTo(25, 4);
    expect(b.w).toBeCloseTo(65, 4);
    expect(b.h).toBeCloseTo(95, 4);
  });

  it('path bounds are correct for multi-point path', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p2',
      {
        kind: 'path',
        points: [
          { x: 0, y: 0, handleIn: null, handleOut: [10, -20] },
          { x: 100, y: 100, handleIn: [-10, 10], handleOut: null },
          { x: 200, y: 50, handleIn: null, handleOut: null },
        ],
        closed: false,
        tolerance: 2,
      },
      { name: 'Path2' },
    );
    const d = addNode(doc, pathNode);
    const p2 = d.nodes.p2;
    if (!p2) throw new Error('node not found');
    const b = nodeLocalBounds(p2);
    expect(b).not.toBeNull();
    if (!b) return;
    // Include handle control points in bounds: handleOut[1] = -20 gives y = 0 + (-20) = -20
    expect(b.x).toBeCloseTo(0, 4);
    expect(b.y).toBeCloseTo(-20, 4);
    expect(b.w).toBeCloseTo(200, 4);
    // P1 handleIn y offset (+10) gives 110, min y is -20 → h = 110 - (-20) = 130
    expect(b.h).toBeCloseTo(130, 4);
  });

  it('null path (empty points) returns null', () => {
    const doc = createDocument();
    const pathNode = makeShapeNode(
      'p3',
      {
        kind: 'path',
        points: [],
        closed: false,
        tolerance: 2,
      },
      { name: 'EmptyPath' },
    );
    const d = addNode(doc, pathNode);
    const p3 = d.nodes.p3;
    if (!p3) throw new Error('node not found');
    const b = nodeLocalBounds(p3);
    expect(b).toBeNull();
  });
});

describe('nodeWorldBounds', () => {
  it('returns correct world bounds for a nested rect', () => {
    const doc = buildDoc();
    // Shape C: local rect (0,0,40,30), world at (170, 130)
    const b = nodeWorldBounds(doc, 's1');
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(170, 4);
    expect(b.y).toBeCloseTo(130, 4);
    expect(b.w).toBeCloseTo(40, 4);
    expect(b.h).toBeCloseTo(30, 4);
  });

  it('returns correct world bounds for a root-level node', () => {
    const doc = buildDoc();
    const b = nodeWorldBounds(doc, 's2');
    expect(b).not.toBeNull();
    if (!b) return;
    expect(b.x).toBeCloseTo(200, 4);
    expect(b.y).toBeCloseTo(50, 4);
    expect(b.w).toBeCloseTo(10, 4);
    expect(b.h).toBeCloseTo(10, 4);
  });

  it('returns null for non-existent nodes', () => {
    const doc = createDocument();
    expect(nodeWorldBounds(doc, 'nope')).toBeNull();
  });
});
