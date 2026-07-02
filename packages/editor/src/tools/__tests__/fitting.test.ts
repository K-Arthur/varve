import { describe, expect, it } from 'vitest';
import { simplifyPoints } from '../fitting';

describe('simplifyPoints', () => {
  it('with 2 points returns both', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ];
    const result = simplifyPoints(pts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 100, y: 100 });
  });

  it('with collinear points reduces to 2', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 100 },
    ];
    const result = simplifyPoints(pts, 2);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[1]).toEqual({ x: 100, y: 100 });
  });

  it('preserves non-collinear features', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ];
    const result = simplifyPoints(pts, 2);
    expect(result.length).toBeGreaterThan(2);
    expect(result.some((p) => p.x === 50 && p.y === 50)).toBe(true);
  });

  it('with epsilon=0 returns all points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 1 },
      { x: 20, y: 0 },
      { x: 30, y: 2 },
    ];
    const result = simplifyPoints(pts, 0);
    expect(result).toEqual(pts);
  });
});
