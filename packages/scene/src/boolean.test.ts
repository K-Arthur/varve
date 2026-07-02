import { describe, expect, it } from 'vitest';
import { booleanOp } from './boolean';
import type { PathPoint } from '@strata/engine';
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
    fills: [
      {
        type: 'solid',
        color: [255, 0, 0, 255] as const,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
  };
}

function makePath(
  id: string,
  points: PathPoint[],
  closed = true,
  transform: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0],
): ShapeNode {
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
    transform,
    shape: { kind: 'path', points, closed, tolerance: 3 },
    fill: [255, 0, 0, 255] as const,
    fills: [
      {
        type: 'solid',
        color: [255, 0, 0, 255] as const,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ],
    strokes: [],
    effects: [],
  };
}

function resultBounds(node: ShapeNode): { x: number; y: number; w: number; h: number } {
  if (node.shape.kind === 'path') {
    const pts = node.shape.points;
    if (pts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: minX,
      y: minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
  }
  return { x: 0, y: 0, w: 0, h: 0 };
}

function pathVertexCount(node: ShapeNode): number {
  if (node.shape.kind === 'path') return node.shape.points.length;
  return 0;
}

describe('booleanOp — union', () => {
  it('union of two non-overlapping rects returns combined result', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('union', [a, b]);
    expect(result.shape.kind).toBe('path');
    // Non-overlapping union: should cover both shapes' bounds
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(300);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('union of two overlapping rects returns combined outline', () => {
    // a: 0,0→100,100   b: 50,50→150,150  (offset overlap, not flush)
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 50, 100, 100);
    const result = booleanOp('union', [a, b]);
    expect(result.shape.kind).toBe('path');
    // Union of these L-shaped combination should have >4 vertices
    expect(pathVertexCount(result)).toBeGreaterThan(4);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(150);
    expect(bounds.h).toBeCloseTo(150);
  });

  it('union preserves fill from first (bottom) node', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    b.fills = [
      {
        type: 'solid',
        color: [0, 0, 255, 255] as const,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const result = booleanOp('union', [a, b]);
    expect(result.fills?.[0]).toMatchObject({ type: 'solid', color: [255, 0, 0, 255] });
  });
});

describe('booleanOp — intersect', () => {
  it('intersect of overlapping rects returns overlapping polygon', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const result = booleanOp('intersect', [a, b]);
    expect(result.shape.kind).toBe('path');
    // Overlap is 50×50 rect
    expect(pathVertexCount(result)).toBeGreaterThanOrEqual(4);
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

  it('subtract where shapes overlap returns first minus second', () => {
    // a: 0,0→100,100   b: 50,50→150,150
    // a-b should be the L-shaped remainder: (0,0)→(100,0)→(100,50)→(50,50)→(50,100)→(0,100)
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 50, 100, 100);
    const result = booleanOp('subtract', [a, b]);
    expect(result.shape.kind).toBe('path');
    // L-shape has 6 outer vertices
    expect(pathVertexCount(result)).toBeGreaterThanOrEqual(6);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(100);
  });
});

describe('booleanOp — exclude', () => {
  it('exclude of overlapping shapes returns XOR region', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 50, 100, 100);
    const result = booleanOp('exclude', [a, b]);
    expect(result.shape.kind).toBe('path');
    // XOR should have at least 8 vertices (two L-shapes combined)
    expect(pathVertexCount(result)).toBeGreaterThanOrEqual(8);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(150);
    expect(bounds.h).toBeCloseTo(150);
  });

  it('exclude of non-overlapping rects returns union', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 0, 100, 100);
    const result = booleanOp('exclude', [a, b]);
    expect(result.shape.kind).toBe('path');
    const bounds = resultBounds(result);
    expect(bounds.w).toBeGreaterThan(0);
  });
});

describe('booleanOp — bezier paths', () => {
  it('union handles bezier path shapes', () => {
    // A closed path with a bezier curve on top edge
    const pts: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: [30, -50] },
      { x: 100, y: 0, handleIn: [-30, -50], handleOut: null },
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 0, y: 100, handleIn: null, handleOut: [0, -30] },
    ];
    const path = makePath('path', pts, true);
    const rect = makeRect('rect', 40, 40, 60, 60);
    const result = booleanOp('union', [path, rect]);
    expect(result.shape.kind).toBe('path');
    // Union should have more vertices than either input
    expect(pathVertexCount(result)).toBeGreaterThan(4);
  });
});

describe('booleanOp — 3+ nodes', () => {
  it('union of three overlapping rects produces combined outline', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 50, 100, 100);
    const c = makeRect('c', 25, 75, 100, 50);
    const result = booleanOp('union', [a, b, c]);
    expect(result.shape.kind).toBe('path');
    expect(pathVertexCount(result)).toBeGreaterThan(4);
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(150);
    // max Y = max(100 from a, 150 from b, 125 from c) = 150
    expect(bounds.h).toBeCloseTo(150);
  });

  it('intersect of three overlapping rects produces intersection of all', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 50, 0, 100, 100);
    const c = makeRect('c', 25, 25, 100, 100);
    const result = booleanOp('intersect', [a, b, c]);
    expect(result.shape.kind).toBe('path');
    // Overlap of all three: x=[50,100], y=[25,100] → 50×75
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(50);
    expect(bounds.y).toBeCloseTo(25);
    expect(bounds.w).toBeCloseTo(50);
    expect(bounds.h).toBeCloseTo(75);
  });

  it('booleanOp with single node returns the node as path', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const result = booleanOp('union', [a]);
    expect(result.shape.kind).toBe('path');
  });
});
