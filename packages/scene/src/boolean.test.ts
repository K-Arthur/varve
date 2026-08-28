import type { PathPoint } from '@varve/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  booleanOp,
  cleanPolygon,
  hasSelfIntersections,
  preloadClipper,
  resolveSelfIntersections,
} from './boolean';
import type { ShapeNode } from './types';

beforeAll(async () => {
  await preloadClipper();
});

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
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
    fills: [
      {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
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
    fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
    fills: [
      {
        type: 'solid',
        color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
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
    const allPts: { x: number; y: number }[] = [...node.shape.points];
    if (node.shape.holes) {
      for (const hole of node.shape.holes) {
        allPts.push(...hole);
      }
    }
    if (allPts.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    const xs = allPts.map((p) => p.x);
    const ys = allPts.map((p) => p.y);
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
  if (node.shape.kind === 'path') {
    let count = node.shape.points.length;
    if (node.shape.holes) {
      for (const hole of node.shape.holes) {
        count += hole.length;
      }
    }
    return count;
  }
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
        color: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 } as const,
        opacity: 1,
        blendMode: 'normal',
        visible: true,
      },
    ];
    const result = booleanOp('union', [a, b]);
    expect(result.fills?.[0]).toMatchObject({
      type: 'solid',
      color: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
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

  it('booleanOp throws error with empty nodes array', () => {
    expect(() => booleanOp('union', [])).toThrow('booleanOp requires at least one node');
  });
});

describe('Boolean op hardening — cleanPolygon', () => {
  it('removes duplicate consecutive points', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ];
    const cleaned = cleanPolygon(poly, 0.5);
    expect(cleaned.length).toBeGreaterThanOrEqual(4);
    // No consecutive points should be within epsilon
    for (let i = 0; i < cleaned.length - 1; i++) {
      const a = cleaned[i]!;
      const b = cleaned[i + 1]!;
      const dist = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      expect(dist).toBeGreaterThan(0.5);
    }
  });

  it('removes collinear points', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 1 }, // slight deviation — keep
      { x: 50, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 50 },
      { x: 0, y: 0 },
    ];
    const cleaned = cleanPolygon(poly, 0.5);
    // The point (50,1) should be kept since cross (50,0)→(50,1)→(50,100) = 50 > 0.5
    // Points (0,50) and (0,0) endpoint — (0,50) is collinear with (0,0)→(0,100)
    // Actually let's check: (0,0)→(0,50)→(0,100): cross = 0 → collinear → removed
    expect(cleaned.length).toBeLessThan(poly.length);
  });

  it('returns empty for < 3 points after cleaning', () => {
    const poly = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10.01 },
      { x: 10, y: 10 },
    ];
    const cleaned = cleanPolygon(poly, 0.5);
    expect(cleaned.length).toBe(0);
  });

  it('preserves valid polygon unchanged (within epsilon)', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const cleaned = cleanPolygon(poly, 0.5);
    // Should still have 4+ points (square stays)
    expect(cleaned.length).toBeGreaterThanOrEqual(4);
  });

  it('removes degenerate closing edge (last == first)', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    const cleaned = cleanPolygon(poly, 0.5);
    // Last point (closing) should be removed
    const last = cleaned[cleaned.length - 1]!;
    const first = cleaned[0]!;
    expect(Math.abs(last.x - first.x) + Math.abs(last.y - first.y)).toBeGreaterThan(0.5);
  });
});

describe('Boolean op hardening — hasSelfIntersections', () => {
  it('returns false for simple polygon (rect)', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(hasSelfIntersections(poly, 1e-6)).toBe(false);
  });

  it('returns true for figure-8 path', () => {
    // Figure-8: crosses at center
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(hasSelfIntersections(poly, 1e-6)).toBe(true);
  });

  it('returns false for degenerate polygon (< 3 points)', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(hasSelfIntersections(poly, 1e-6)).toBe(false);
  });

  it('returns true for bow-tie configuration', () => {
    // Bow-tie: edges cross
    const poly = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 50, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(hasSelfIntersections(poly, 1e-6)).toBe(true);
  });
});

describe('Boolean op hardening — resolveSelfIntersections', () => {
  it('splits figure-8 into two polygons', () => {
    // Figure-8 crossing at center
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    const result = resolveSelfIntersections(poly, 1e-6);
    // Should split into 2 non-self-intersecting polygons
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const sub of result) {
      expect(hasSelfIntersections(sub, 1e-6)).toBe(false);
      expect(sub.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('handles bow-tie configuration', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 50, y: 100 },
      { x: 50, y: 0 },
      { x: 0, y: 100 },
    ];
    const result = resolveSelfIntersections(poly, 1e-6);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const sub of result) {
      expect(hasSelfIntersections(sub, 1e-6)).toBe(false);
    }
  });

  it('returns original polygon when no self-intersections', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const result = resolveSelfIntersections(poly, 1e-6);
    expect(result.length).toBe(1);
    expect(result[0]!.length).toBe(poly.length);
  });
});

describe('Boolean op hardening — edge case robustness', () => {
  it('booleanOp union with self-intersecting path does not crash', () => {
    // A figure-8 path
    const pts: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
      { x: 0, y: 100, handleIn: null, handleOut: null },
    ];
    const pathA = makePath('fig8', pts, true);
    const rect = makeRect('r', 30, 30, 40, 40);
    const result = booleanOp('union', [pathA, rect]);
    expect(result.shape.kind).toBe('path');
  });

  it('booleanOp subtract with fully-contained rect produces expected result', () => {
    // a: 100×100 rect at origin, b: 20×20 rect centered inside
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 40, 40, 20, 20);
    const result = booleanOp('subtract', [a, b]);
    expect(result.shape.kind).toBe('path');
    // Should produce a shape with a hole - outer bounds still 100×100
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('booleanOp intersect with non-overlapping shapes returns zero-area result gracefully', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    const b = makeRect('b', 200, 200, 50, 50);
    const result = booleanOp('intersect', [a, b]);
    expect(result.shape.kind).toBe('path');
    const bounds = resultBounds(result);
    expect(bounds.w).toBeLessThanOrEqual(0);
  });

  it('booleanOp union with degenerate zero-area shape gracefully returns the other shape', () => {
    const a = makeRect('a', 0, 0, 100, 100);
    // A zero-area "rect" at the same position
    const degenerate: ShapeNode = {
      id: 'zero',
      name: 'zero',
      kind: 'shape',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'rect', x: 0, y: 0, w: 0, h: 0 },
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
      fills: [],
      strokes: [],
      effects: [],
    };
    const result = booleanOp('union', [a, degenerate]);
    expect(result.shape.kind).toBe('path');
    const bounds = resultBounds(result);
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(100);
  });

  it('booleanOp subtract where result should have a hole (overlapping rects) does not crash', () => {
    // Two overlapping rects in the middle of a big one — creates hole topology
    const a = makeRect('a', 0, 0, 200, 200);
    const b = makeRect('b', 50, 50, 100, 100);
    const result = booleanOp('subtract', [a, b]);
    expect(result.shape.kind).toBe('path');
    const bounds = resultBounds(result);
    expect(bounds.x).toBeCloseTo(0);
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.w).toBeCloseTo(200);
    expect(bounds.h).toBeCloseTo(200);
  });

  it('booleanOp excludes degenerate input gracefully in union chain', () => {
    // A line (2 points) cannot form a polygon — should not crash
    const a = makeRect('a', 0, 0, 100, 100);
    const line: ShapeNode = {
      id: 'line',
      name: 'line',
      kind: 'shape',
      index: 0,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      shape: { kind: 'line', from: [0, 0] as const, to: [100, 0] as const, tolerance: 3 },
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 } as const,
      fills: [],
      strokes: [],
      effects: [],
    };
    const result = booleanOp('union', [a, line]);
    expect(result.shape.kind).toBe('path');
    const bounds = resultBounds(result);
    // Should still produce the rect's dimensions
    expect(bounds.w).toBeCloseTo(100);
    expect(bounds.h).toBeCloseTo(100);
  });
});
