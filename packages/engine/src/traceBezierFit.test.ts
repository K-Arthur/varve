import { describe, expect, it } from 'vitest';
import { fitBezierToContour } from './traceBezierFit';

describe('fitBezierToContour', () => {
  it('returns bare points for a 3-point contour (below minimum for fitting)', () => {
    const result = fitBezierToContour(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 10 },
      ],
      true,
    );
    expect(result.length).toBe(3);
    for (const pt of result) {
      expect(pt.handleIn).toBeNull();
      expect(pt.handleOut).toBeNull();
    }
  });

  it('fits a straight line segment with minimal handles', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 15, y: 0 },
      { x: 20, y: 0 },
    ];
    const result = fitBezierToContour(points, false);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0]!.x).toBe(0);
    expect(result[0]!.y).toBe(0);
    const lastPt = result[result.length - 1]!;
    expect(lastPt.x).toBe(20);
    expect(lastPt.y).toBe(0);
  });

  it('generates handles on a curved contour', () => {
    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 20; i += 1) {
      const t = (i / 19) * Math.PI;
      points.push({ x: i * 5, y: Math.round(Math.sin(t) * 20) });
    }
    const result = fitBezierToContour(points, false, { maxError: 1.0 });
    expect(result.length).toBeLessThan(points.length);
    const hasHandles = result.some((p) => p.handleIn !== null || p.handleOut !== null);
    expect(hasHandles).toBe(true);
  });

  it('preserves a clear right-angle corner', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 9, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 10, y: 5 },
    ];
    const result = fitBezierToContour(points, false, { cornerAngle: 100 });
    const hasCorner = result.some((p) => Math.abs(p.x - 10) < 1 && Math.abs(p.y - 10) < 1);
    expect(hasCorner).toBe(true);
  });

  it('uses exactly 4 corner points for a square', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const result = fitBezierToContour(square, true, { maxError: 0.1 });
    expect(result.length).toBe(4);
    for (const pt of result) {
      const hasCorner = (pt.x === 0 || pt.x === 10) && (pt.y === 0 || pt.y === 10);
      expect(hasCorner).toBe(true);
    }
  });

  it('reduces anchor count for a smooth circular contour', () => {
    const circlePoints: { x: number; y: number }[] = [];
    const cx = 50;
    const cy = 50;
    const r = 40;
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      circlePoints.push({
        x: cx + r * Math.cos(a),
        y: cy + r * Math.sin(a),
      });
    }
    const result = fitBezierToContour(circlePoints, true, { maxError: 0.5 });
    expect(result.length).toBeLessThan(circlePoints.length);
    const hasHandles = result.some((p) => p.handleIn !== null || p.handleOut !== null);
    expect(hasHandles).toBe(true);
  });

  it('produces a valid closed contour from 8 perimeter points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
      { x: 10, y: 10 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ];
    const result = fitBezierToContour(points, true, { maxError: 0.5 });
    expect(result.length).toBeGreaterThanOrEqual(4);
  });

  it('is deterministic: identical input produces identical output', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 1 },
      { x: 8, y: 2 },
      { x: 12, y: 0 },
      { x: 16, y: -1 },
    ];
    const a = fitBezierToContour(points, false);
    const b = fitBezierToContour(points, false);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i += 1) {
      expect(a[i]!.x).toBe(b[i]!.x);
      expect(a[i]!.y).toBe(b[i]!.y);
    }
  });
});
