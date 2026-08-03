/**
 * Tests for glyph-adjustment application during text-to-outline conversion.
 */
import { describe, expect, it } from 'vitest';
import type { ShapeNode } from '../types';
import { applyGlyphAdjustmentsToOutlines } from './glyphAdjust';

function boxShape(x: number, y: number, w = 10, h = 10): ShapeNode {
  return {
    id: `g${x}`,
    kind: 'shape',
    name: 'glyph',
    transform: [1, 0, 0, 1, 0, 0],
    opacity: 1,
    blendMode: 'normal',
    shape: {
      kind: 'path',
      points: [
        { x, y, handleIn: null, handleOut: null },
        { x: x + w, y, handleIn: null, handleOut: null },
        { x: x + w, y: y + h, handleIn: null, handleOut: null },
        { x, y: y + h, handleIn: null, handleOut: null },
      ],
      closed: true,
      tolerance: 0.1,
    },
  } as unknown as ShapeNode;
}

const GLYPHS = [
  { char: 'A', points: [{ x: 0, y: 0 }] },
  { char: 'B', points: [{ x: 10, y: 0 }] },
  { char: 'C', points: [{ x: 20, y: 0 }] },
];

describe('applyGlyphAdjustmentsToOutlines', () => {
  it('returns no-op for empty adjustments', () => {
    const shapes = [boxShape(0, 0), boxShape(10, 0), boxShape(20, 0)];
    const result = applyGlyphAdjustmentsToOutlines('ABC', GLYPHS, shapes, [0, 1, 2]);
    expect(result.widthDelta).toBe(0);
    expect(result.warnings).toEqual([]);
    expect(
      ((shapes[0]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(0);
  });

  it('shifts clusters by dx/dy and advances following clusters', () => {
    const shapes = [boxShape(0, 0), boxShape(10, 0), boxShape(20, 0)];
    const result = applyGlyphAdjustmentsToOutlines('ABC', GLYPHS, shapes, [0, 1, 2], {
      0: { dx: 2, dy: 3, advance: 5, rotation: 0, scaleX: 1, scaleY: 1 },
    });
    // Cluster 0: shifted locally by (2,3)
    expect(
      ((shapes[0]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(2);
    expect(
      ((shapes[0]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.y,
    ).toBe(3);
    // Cluster 1: shifted by the cumulative advance (5) only
    expect(
      ((shapes[1]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(15);
    expect(
      ((shapes[1]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.y,
    ).toBe(0);
    // Cluster 2: same cumulative advance
    expect(
      ((shapes[2]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(25);
    expect(result.widthDelta).toBe(5);
  });

  it('applies pair spacing between clusters', () => {
    const shapes = [boxShape(0, 0), boxShape(10, 0), boxShape(20, 0)];
    const result = applyGlyphAdjustmentsToOutlines('ABC', GLYPHS, shapes, [0, 1, 2], undefined, {
      0: 4,
    });
    expect(
      ((shapes[0]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(0);
    expect(
      ((shapes[1]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(14);
    expect(
      ((shapes[2]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(24);
    expect(result.widthDelta).toBe(4);
  });

  it('rotates and scales around the cluster origin', () => {
    const shapes = [boxShape(0, 0), boxShape(10, 0)];
    applyGlyphAdjustmentsToOutlines('AB', GLYPHS.slice(0, 2), shapes, [0, 1], {
      1: { dx: 0, dy: 0, advance: 0, rotation: Math.PI / 2, scaleX: 1, scaleY: 1 },
    });
    // Rotation of (10,0) around origin (10,0) by 90deg -> (10,0) stays; the
    // point at x+w (20,0) relative origin -> rotate (10,0)->(0,10) -> (10,10).
    const p1 = (
      (shapes[1]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>
    )[1]!;
    expect(p1.x).toBeCloseTo(10);
    expect(p1.y).toBeCloseTo(10);
  });

  it('handles skipped whitespace glyphs with shapeIndex null', () => {
    const shapes = [boxShape(0, 0)];
    const glyphs = [
      { char: 'A', points: [{ x: 0, y: 0 }] },
      { char: ' ', points: [] },
      { char: 'B', points: [{ x: 12, y: 0 }] },
    ];
    const result = applyGlyphAdjustmentsToOutlines('A B', glyphs, shapes, [0, null, 1], {
      0: { dx: 1, dy: 0, advance: 2, rotation: 0, scaleX: 1, scaleY: 1 },
    });
    // Space cluster advances by 2; B shape (index 1) shifts by 3 total.
    expect(
      ((shapes[0]!.shape as { points: unknown[] }).points as Array<{ x: number; y: number }>)[0]!.x,
    ).toBe(1);
    expect(result.widthDelta).toBe(2);
  });
});
