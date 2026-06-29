import { describe, it, expect } from 'vitest';
import type { Affine } from '@strata/engine';
import { createDocument, makeShapeNode } from '@strata/scene';
import { worldBBox, edgeDistance, centerToCenter, getAccumulatedTransform, type AABB } from './measurement';

describe('worldBBox', () => {
  it('computes AABB for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 10, y: 20, w: 200, h: 100 }, {
      name: 'R1',
      transform: [1, 0, 0, 1, 50, 60],
    });
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(60);
    expect(bbox.y).toBe(80);
    expect(bbox.w).toBe(200);
    expect(bbox.h).toBe(100);
  });

  it('handles identity transform rect', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 }, {
      name: 'R',
    });
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(0);
    expect(bbox.y).toBe(0);
    expect(bbox.w).toBe(100);
    expect(bbox.h).toBe(50);
  });

  it('computes AABB for an ellipse', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 20 }, {
      name: 'E1',
      transform: [1, 0, 0, 1, 100, 100],
    });
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(110);
    expect(bbox.y).toBe(130);
    expect(bbox.w).toBe(80);
    expect(bbox.h).toBe(40);
  });
});

describe('edgeDistance', () => {
  it('computes gap between two non-overlapping AABBs horizontally', () => {
    const a: AABB = { x: 0, y: 0, w: 100, h: 100 };
    const b: AABB = { x: 150, y: 0, w: 100, h: 100 };
    const d = edgeDistance(a, b);
    expect(d.left).toBe(50);
    expect(d.right).toBe(-250);
    expect(d.top).toBe(-100);
    expect(d.bottom).toBe(-100);
  });

  it('computes vertical gap', () => {
    const a: AABB = { x: 0, y: 0, w: 100, h: 100 };
    const b: AABB = { x: 0, y: 200, w: 100, h: 100 };
    const d = edgeDistance(a, b);
    expect(d.top).toBe(100);
    expect(d.left).toBe(-100);
  });
});

describe('centerToCenter', () => {
  it('computes center distance between two AABBs', () => {
    const a: AABB = { x: 0, y: 0, w: 100, h: 100 };
    const b: AABB = { x: 100, y: 0, w: 100, h: 100 };
    const c = centerToCenter(a, b);
    expect(c.dx).toBe(100);
    expect(c.dy).toBe(0);
    expect(c.distance).toBe(100);
  });

  it('computes diagonal distance', () => {
    const a: AABB = { x: 0, y: 0, w: 0, h: 0 };
    const b: AABB = { x: 30, y: 40, w: 0, h: 0 };
    const c = centerToCenter(a, b);
    expect(c.distance).toBe(50);
  });
});

describe('getAccumulatedTransform', () => {
  it('returns node transform for root node', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }, {
      transform: [2, 0, 0, 2, 5, 5],
    });
    const at = getAccumulatedTransform(doc, node.id, node.transform as Affine);
    expect(at[0]).toBe(2);
    expect(at[4]).toBe(5);
  });
});
