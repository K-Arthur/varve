import { describe, expect, it } from 'vitest';
import { booleanOp } from './boolean';
import type { ShapeNode } from './types';

function makeRect(id: string, x: number, y: number, w: number, h: number): ShapeNode {
  return {
    id,
    name: id,
    kind: 'shape',
    index: 0,
    order: 'a0',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    transform: [1, 0, 0, 1, x, y],
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    fill: [255, 0, 0, 255] as const,
    fills: [{ type: 'solid', color: [255, 0, 0, 255] as const, opacity: 1, blendMode: 'normal', visible: true }],
    strokes: [],
    effects: [],
  };
}

function resultBounds(node: ShapeNode): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4];
  const ty = node.transform[5];
  if (node.shape.kind === 'rect') {
    return { x: tx + node.shape.x, y: ty + node.shape.y, w: node.shape.w, h: node.shape.h };
  }
  if (node.shape.kind === 'path') {
    const pts = node.shape.points;
    if (pts.length === 0) return { x: tx, y: ty, w: 0, h: 0 };
    const xs = pts.map((p) => tx + p.x);
    const ys = pts.map((p) => ty + p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
  }
  return { x: tx, y: ty, w: 0, h: 0 };
}

describe('booleanOp — union', () => {
  it('union of two non-overlapping rects returns bounding rect', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('union', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(300);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('union of two overlapping rects returns bounding rect', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const result = booleanOp('union', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(150);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('union preserves fill from first (bottom) node', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    b.fills = [{ type: 'solid', color: [0, 0, 255, 255] as const, opacity: 1, blendMode: 'normal', visible: true }];
    const result = booleanOp('union', [a, b]);
    expect(result.fills?.[0]).toMatchObject({ type: 'solid', color: [255, 0, 0, 255] });
  });
});

describe('booleanOp — intersect', () => {
  it('intersect of overlapping rects returns overlapping rect', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const result = booleanOp('intersect', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(50);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(50);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('intersect of non-overlapping rects returns zero-size result', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('intersect', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.w).toBeLessThanOrEqual(0);
  });
});

describe('booleanOp — subtract', () => {
  it('subtract of non-overlapping rects returns first shape', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('subtract', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('subtract returns a ShapeNode', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const result = booleanOp('subtract', [a, b]);
    expect(result.kind).toBe('shape');
  });
});

describe('booleanOp — exclude', () => {
  it('exclude returns a ShapeNode', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const result = booleanOp('exclude', [a, b]);
    expect(result.kind).toBe('shape');
  });

  it('exclude of non-overlapping rects returns bounding rect', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('exclude', [a, b]);
    const bounds = resultBounds(result);
    expect(bounds.w).toBeGreaterThan(0);
  });
});
