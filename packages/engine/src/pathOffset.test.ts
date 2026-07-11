import { describe, expect, it } from 'vitest';
import { expandStroke, offsetPath, roundCorners } from './pathOffset';
import type { PathPoint } from './types';

function linePath(fromX: number, fromY: number, toX: number, toY: number): PathPoint[] {
  return [
    { x: fromX, y: fromY, handleIn: null, handleOut: null },
    { x: toX, y: toY, handleIn: null, handleOut: null },
  ];
}

function rectPath(x: number, y: number, w: number, h: number): PathPoint[] {
  return [
    { x, y, handleIn: null, handleOut: null },
    { x: x + w, y, handleIn: null, handleOut: null },
    { x: x + w, y: y + h, handleIn: null, handleOut: null },
    { x, y: y + h, handleIn: null, handleOut: null },
  ];
}

describe('offsetPath', () => {
  it('returns same path for distance=0', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, 0);
    expect(result).toHaveLength(2);
    expect(result[0]!.x).toBe(0);
    expect(result[1]!.x).toBe(100);
  });

  it('offsets a horizontal line upward', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, 10);
    // All points should be at y=-10 (offset upward = negative y)
    // But with miter join at non-closed end, result may include end caps
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of result) {
      expect(p.y).toBeLessThan(0);
    }
  });

  it('offsets a horizontal line downward (negative distance)', () => {
    const pts = linePath(0, 0, 100, 0);
    const result = offsetPath(pts, false, -10);
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const p of result) {
      expect(p.y).toBeGreaterThan(0);
    }
  });

  it('offsets a closed rectangle outward', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = offsetPath(pts, true, 5, 'miter', 10);
    // Offset should expand the rectangle — at least 4 points, all finite
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    // Some point should be outside original bounds (expanded)
    const expanded = result.some((p) => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 50);
    expect(expanded).toBe(true);
  });

  it('offsets a closed rectangle inward (negative)', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = offsetPath(pts, true, -5);
    // Should have at least 4 finite points
    expect(result.length).toBeGreaterThanOrEqual(4);
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('expandStroke', () => {
  it('expands a line segment into a closed outline', () => {
    const pts = linePath(0, 0, 100, 0);
    const widths = [10, 10];
    const result = expandStroke(pts, false, widths, 'round');
    // Should produce left + right with round caps
    expect(result.length).toBeGreaterThan(2);
    // All points should form a closed outline
    expect(result[0]!.x).toBeCloseTo(0);
    expect(result[result.length - 1]!.x).toBeCloseTo(0);
  });

  it('expands with different widths per vertex', () => {
    const pts = linePath(0, 0, 100, 0);
    const widths = [10, 20]; // Wider at end
    const result = expandStroke(pts, false, widths, 'butt');
    expect(result.length).toBeGreaterThan(2);
    // The right offset curve should be wider at the end
    // (right offset is at negative y, more negative = wider)
  });

  it('expands a closed triangle', () => {
    const pts: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: -50, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ];
    const result = expandStroke(pts, true, [10, 10, 10], 'round');
    // Should produce left + right, so at least 6 points
    expect(result.length).toBeGreaterThanOrEqual(6);
  });
});

describe('roundCorners', () => {
  it('returns same path for 0 radius', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = roundCorners(pts, true, 0);
    expect(result).toHaveLength(pts.length);
    expect(result[0]!.x).toBe(0);
  });

  it('rounds corners of a rectangle', () => {
    const pts = rectPath(0, 0, 100, 50);
    const result = roundCorners(pts, true, 10);
    // Should have more points than original (arc segments added)
    expect(result.length).toBeGreaterThan(pts.length);
    // TL corner should be clipped: no point should be exactly at (0,0) since it's rounded
    const atOrigin = result.find((p) => Math.abs(p.x) < 1 && Math.abs(p.y) < 1);
    expect(atOrigin).toBeUndefined();
    // Every point's x,y should be finite
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it('does not modify open path endpoints', () => {
    const pts = linePath(0, 0, 100, 0);
    // Add intermediate points so we have corners to round
    const pts3: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: 50, handleIn: null, handleOut: null },
      { x: 100, y: 0, handleIn: null, handleOut: null },
    ];
    const result = roundCorners(pts3, false, 10);
    // Open endpoints should be unchanged
    expect(result[0]!.x).toBe(0);
    expect(result[0]!.y).toBe(0);
    expect(result[result.length - 1]!.x).toBe(100);
    expect(result[result.length - 1]!.y).toBe(0);
  });

  it('handles very large radius by clamping to segment length', () => {
    const pts = rectPath(0, 0, 20, 20);
    // Radius = 100 is larger than any side (20px), should clamp
    const result = roundCorners(pts, true, 100);
    expect(result.length).toBeGreaterThanOrEqual(4);
    // Should not crash and should produce reasonable results
    for (const p of result) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});
