import { describe, expect, it } from 'vitest';
import { pathPointsToPolygon, shapeToPolygon } from './integration';

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function transformedPoint(
  x: number,
  y: number,
  transform: readonly [number, number, number, number, number, number],
) {
  return {
    x: transform[0] * x + transform[2] * y + transform[4],
    y: transform[1] * x + transform[3] * y + transform[5],
  };
}

function maximumEllipseDeviation(
  polygon: { x: number; y: number }[],
  ellipse: { cx: number; cy: number; rx: number; ry: number },
  transform: readonly [number, number, number, number, number, number],
): number {
  let maximum = 0;
  for (let sample = 0; sample < 720; sample++) {
    const angle = (2 * Math.PI * sample) / 720;
    const expected = transformedPoint(
      ellipse.cx + ellipse.rx * Math.cos(angle),
      ellipse.cy + ellipse.ry * Math.sin(angle),
      transform,
    );
    let nearest = Infinity;
    for (let index = 0; index < polygon.length; index++) {
      nearest = Math.min(
        nearest,
        distanceToSegment(expected, polygon[index]!, polygon[(index + 1) % polygon.length]!),
      );
    }
    maximum = Math.max(maximum, nearest);
  }
  return maximum;
}

describe('Boolean curve conversion', () => {
  it('subdivides a cubic with coincident endpoints and non-zero handles', () => {
    const points = pathPointsToPolygon(
      [
        { x: 0, y: 0, handleIn: null, handleOut: [100, 100] },
        { x: 0, y: 0, handleIn: [-100, 100], handleOut: null },
      ],
      false,
    );
    expect(points.length).toBeGreaterThan(2);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true,
    );
    expect(Math.max(...points.map((point) => point.y))).toBeGreaterThan(40);
  });

  it('measures curve flatness after a non-uniform/shear transform', () => {
    const authored = [
      { x: 0, y: 0, handleIn: null, handleOut: [0, 100] as [number, number] },
      { x: 100, y: 0, handleIn: [0, 100] as [number, number], handleOut: null },
    ];
    const transform = [1, 0.35, 1.6, 3, 20, -15] as const;
    const output = pathPointsToPolygon(authored, false, transform);
    const withEnd = [...output, { x: 100 + 20, y: 0.35 * 100 - 15 }];
    let maximumDeviation = 0;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const u = 1 - t;
      const x = u * u * u * 0 + 3 * u * u * t * 0 + 3 * u * t * t * 100 + t * t * t * 100;
      const y = u * u * u * 0 + 3 * u * u * t * 100 + 3 * u * t * t * 100 + t * t * t * 0;
      const transformed = { x: x + 1.6 * y + 20, y: 0.35 * x + 3 * y - 15 };
      let nearest = Infinity;
      for (let segment = 0; segment < withEnd.length - 1; segment++) {
        nearest = Math.min(
          nearest,
          distanceToSegment(transformed, withEnd[segment]!, withEnd[segment + 1]!),
        );
      }
      maximumDeviation = Math.max(maximumDeviation, nearest);
    }
    expect(maximumDeviation).toBeLessThan(0.08);
    expect(output.length).toBeGreaterThan(4);
  });

  it('keeps transformed ellipse approximation under the world-unit error budget', () => {
    const ellipse = { kind: 'ellipse' as const, cx: 10, cy: -20, rx: 80, ry: 20 };
    const transform = [25, 3, 4, 0.3, 1000, -500] as const;
    const polygon = shapeToPolygon(ellipse, transform);

    expect(maximumEllipseDeviation(polygon, ellipse, transform)).toBeLessThan(0.011);
  });
});
