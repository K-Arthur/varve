import { describe, expect, it } from 'vitest';
import type { Affine } from '@strata/shared';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
} from '@strata/scene';
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
    const node = doc.nodes['s1'];
    if (!node) return;
    const b = nodeLocalBounds(node);
    expect(b).toEqual({ x: 0, y: 0, w: 40, h: 30 });
  });

  it('returns null for groups and arrow/path shapes', () => {
    const doc = createDocument();
    // Group node has no shape → kind === 'group' falls to null.
    const g = makeGroupNode('g1', { name: 'Group' });
    let d = addNode(doc, g);
    const b = nodeLocalBounds(d.nodes['g1']!);
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
