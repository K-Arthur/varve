import { describe, expect, it } from 'vitest';
import type { PathPoint } from '../types';
import { fitCubicBezier, simplifyPathRDP, simplifyToBezier } from './pathSimplifier';

function pt(x: number, y: number): PathPoint {
  return { x, y, handleIn: null, handleOut: null };
}

describe('simplifyPathRDP', () => {
  it('returns unchanged for 2 points (simple line)', () => {
    const points = [pt(0, 0), pt(100, 0)];
    const result = simplifyPathRDP(points, 1);
    expect(result.points).toHaveLength(2);
    expect(result.originalCount).toBe(2);
    expect(result.simplifiedCount).toBe(2);
    expect(result.reduction).toBe(0);
  });

  it('removes midpoint on a straight line', () => {
    const points = [pt(0, 0), pt(50, 0), pt(100, 0)];
    const result = simplifyPathRDP(points, 1);
    expect(result.points).toHaveLength(2);
    expect(result.points[0]?.x).toBe(0);
    expect(result.points[0]?.y).toBe(0);
    expect(result.points[1]?.x).toBe(100);
    expect(result.points[1]?.y).toBe(0);
    expect(result.reduction).toBeCloseTo(1 / 3, 5);
  });

  it('reduces points on a curved path while preserving shape', () => {
    const points = [pt(0, 0), pt(10, 5), pt(20, 15), pt(30, 30), pt(40, 50)];
    const tight = simplifyPathRDP(points, 0.5);
    const loose = simplifyPathRDP(points, 20);
    expect(tight.simplifiedCount).toBeGreaterThan(loose.simplifiedCount);
    expect(tight.reduction).toBeLessThan(loose.reduction);
  });

  it('simplifies a closed path', () => {
    const points = [
      pt(0, 0),
      pt(10, 0),
      pt(20, 0),
      pt(20, 10),
      pt(20, 20),
      pt(10, 20),
      pt(0, 20),
      pt(0, 10),
      pt(0, 0),
    ];
    const result = simplifyPathRDP(points, 2, true);
    expect(result.simplifiedCount).toBeLessThan(result.originalCount);
  });

  it('small epsilon preserves more points', () => {
    const points = [pt(0, 0), pt(10, 0), pt(20, 1), pt(30, 0), pt(40, 0)];
    const small = simplifyPathRDP(points, 0.1);
    const large = simplifyPathRDP(points, 5);
    expect(small.simplifiedCount).toBeGreaterThan(large.simplifiedCount);
  });
});

describe('fitCubicBezier', () => {
  it('returns null for a straight line', () => {
    const points = [pt(0, 0), pt(50, 0), pt(100, 0)];
    const result = fitCubicBezier(points);
    expect(result).toBeNull();
  });

  it('returns 4 control points for a simple curve', () => {
    const points = [pt(0, 0), pt(10, 5), pt(20, 15), pt(30, 30), pt(40, 50)];
    const result = fitCubicBezier(points);
    expect(result).not.toBeNull();
    expect(result?.p0.x).toBe(0);
    expect(result?.p0.y).toBe(0);
    expect(result?.p3.x).toBe(40);
    expect(result?.p3.y).toBe(50);
    expect(typeof result?.p1.x).toBe('number');
    expect(typeof result?.p1.y).toBe('number');
    expect(typeof result?.p2.x).toBe('number');
    expect(typeof result?.p2.y).toBe('number');
  });
});

describe('simplifyToBezier', () => {
  it('produces fewer points than input for a curved path', () => {
    const points = [
      pt(0, 0),
      pt(5, 2),
      pt(10, 8),
      pt(15, 18),
      pt(20, 32),
      pt(25, 50),
      pt(30, 72),
      pt(35, 98),
      pt(40, 128),
    ];
    const result = simplifyToBezier(points, 2, 120);
    expect(result.length).toBeLessThan(points.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});
