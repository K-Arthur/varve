import type { Affine } from '@varve/engine';
import {
  addChild,
  addNode,
  createDocument,
  makeFrameNode,
  makeGroupNode,
  makeShapeNode,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import {
  type AABB,
  centerToCenter,
  edgeDistance,
  getAccumulatedTransform,
  worldBBox,
} from './measurement';

describe('worldBBox', () => {
  it('computes AABB for a rect shape', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 10, y: 20, w: 200, h: 100 },
      {
        name: 'R1',
        transform: [1, 0, 0, 1, 50, 60],
      },
    );
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(60);
    expect(bbox.y).toBe(80);
    expect(bbox.w).toBe(200);
    expect(bbox.h).toBe(100);
  });

  it('handles identity transform rect', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
      {
        name: 'R',
      },
    );
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(0);
    expect(bbox.y).toBe(0);
    expect(bbox.w).toBe(100);
    expect(bbox.h).toBe(50);
  });

  it('computes AABB for an ellipse', () => {
    const doc = createDocument('Test');
    const node = makeShapeNode(
      'n1',
      { kind: 'ellipse', cx: 50, cy: 50, rx: 40, ry: 20 },
      {
        name: 'E1',
        transform: [1, 0, 0, 1, 100, 100],
      },
    );
    const bbox = worldBBox(node, doc);
    expect(bbox.x).toBe(110);
    expect(bbox.y).toBe(130);
    expect(bbox.w).toBe(80);
    expect(bbox.h).toBe(40);
  });

  it('uses the declared frame dimensions instead of a placeholder box', () => {
    let doc = createDocument('Frame bounds', true);
    const frame = makeFrameNode('frame', {
      w: 393,
      h: 852,
      transform: [1, 0, 0, 1, -67, -561],
    });
    doc = addNode(doc, frame);

    expect(worldBBox(frame, doc)).toEqual({ x: -67, y: -561, w: 393, h: 852 });
  });

  it('uses area-text width and height', () => {
    let doc = createDocument('Area text bounds', true);
    const text = makeTextNode('text', 'A short line', {
      w: 180,
      h: 60,
      textMode: 'area',
      transform: [1, 0, 0, 1, 12, 18],
    });
    doc = addNode(doc, text);

    expect(worldBBox(text, doc)).toEqual({ x: 12, y: 18, w: 180, h: 60 });
  });

  it('unions transformed descendants for a group', () => {
    let doc = createDocument('Group bounds', true);
    const group = makeGroupNode('group', { transform: [1, 0, 0, 1, 100, 50] });
    const child = makeShapeNode(
      'child',
      { kind: 'rect', x: 0, y: 0, w: 40, h: 30 },
      { transform: [1, 0, 0, 1, 20, 25] },
    );
    doc = addNode(doc, group);
    doc = addChild(doc, group.id, child);

    expect(worldBBox(group, doc)).toEqual({ x: 120, y: 75, w: 40, h: 30 });
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
    const node = makeShapeNode(
      'n1',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      {
        transform: [2, 0, 0, 2, 5, 5],
      },
    );
    const at = getAccumulatedTransform(doc, node.id, node.transform as Affine);
    expect(at[0]).toBe(2);
    expect(at[4]).toBe(5);
  });
});
