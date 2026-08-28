import { describe, expect, it } from 'vitest';
import { booleanNormalized, booleanNormalizedRegions } from './engine';
import type { Point2D, Region2D } from './region';
import { pointInCompoundPath, regionArea } from './region';
import { hasSelfIntersections, resolveSelfIntersections } from './self-intersection';

const square = (x: number, y: number, size: number): Point2D[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const rect = (x: number, y: number, w: number, h: number): Point2D[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

function area(result: ReturnType<typeof booleanNormalized>): number {
  return regionArea({
    contours: result.outerContours,
    holes: result.holes,
    fillRule: result.fillRule,
  });
}

function translate(points: Point2D[], dx: number, dy: number): Point2D[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function scale(points: Point2D[], factor: number): Point2D[] {
  return points.map((point) => ({ x: point.x * factor, y: point.y * factor }));
}

describe('deterministic compound Boolean kernel', () => {
  it('resolves multi-crossing inputs into finite simple faces deterministically', () => {
    const multiCrossing: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 220 },
      { x: 200, y: 0 },
      { x: 0, y: 150 },
      { x: 200, y: 150 },
    ];

    const faces = resolveSelfIntersections(multiCrossing, 1e-6);
    expect(faces.length).toBeGreaterThanOrEqual(3);
    expect(faces.every((face) => !hasSelfIntersections(face, 1e-6))).toBe(true);

    const first = booleanNormalized([multiCrossing], 'union');
    const second = booleanNormalized([multiCrossing], 'union');
    expect(first.components).toEqual(second.components);
    for (const component of first.components) {
      expect(hasSelfIntersections(component.outer, 1e-6)).toBe(false);
      expect(
        component.outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      ).toBe(true);
      expect(component.holes.every((hole) => !hasSelfIntersections(hole, 1e-6))).toBe(true);
    }
  });

  it('keeps multi-crossing topology stable under translation', () => {
    const multiCrossing: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 220 },
      { x: 200, y: 0 },
      { x: 0, y: 150 },
      { x: 200, y: 150 },
    ];
    const base = booleanNormalized([multiCrossing], 'union');
    const moved = booleanNormalized([translate(multiCrossing, 1_000_000, -1_000_000)], 'union');
    expect(moved.components.length).toBe(base.components.length);
    expect(
      regionArea({ contours: moved.outerContours, holes: moved.holes, fillRule: moved.fillRule }),
    ).toBeCloseTo(
      regionArea({ contours: base.outerContours, holes: base.holes, fillRule: base.fillRule }),
      3,
    );
  });

  it('implements base minus union(cutters), preserves all disconnected islands, and creates no sliver vertices', () => {
    const result = booleanNormalized(
      [rect(0, 0, 100, 20), rect(20, -10, 10, 40), rect(60, -10, 10, 40)],
      'subtract',
    );

    expect(result.components).toHaveLength(3);
    expect(result.holes).toHaveLength(0);
    expect(area(result)).toBeCloseTo(1600, 8);
    for (const component of result.components) {
      expect(component.outer).toHaveLength(4);
      expect(
        component.outer.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      ).toBe(true);
    }
  });

  it('uses true N-ary XOR parity rather than subtracting each input from every other input', () => {
    const result = booleanNormalized(
      [rect(0, 0, 30, 20), rect(10, 0, 30, 20), rect(20, 0, 30, 20)],
      'exclude',
    );

    // Coverage is odd in [0,10), [20,30), and [40,50). The middle interval
    // proves this is parity/XOR, not a union of pairwise subtract operations.
    expect(area(result)).toBeCloseTo(600, 8);
    expect(result.components).toHaveLength(3);
  });

  it('preserves a contained cutter as a real hole and hit testing excludes that hole', () => {
    const result = booleanNormalized([square(0, 0, 100), square(25, 25, 50)], 'subtract');
    expect(result.components).toHaveLength(1);
    expect(result.components[0]!.holes).toHaveLength(1);
    expect(area(result)).toBeCloseTo(7500, 8);

    const component = result.components[0]!;
    expect(pointInCompoundPath({ x: 10, y: 10 }, component.outer, component.holes, 'evenodd')).toBe(
      true,
    );
    expect(pointInCompoundPath({ x: 50, y: 50 }, component.outer, component.holes, 'evenodd')).toBe(
      false,
    );
  });

  it('respects compound input holes rather than clipping only a path outer contour', () => {
    const donut: Region2D = {
      contours: [square(0, 0, 100)],
      holes: [square(25, 25, 50)],
      fillRule: 'evenodd',
    };
    const result = booleanNormalizedRegions(
      [donut, { contours: [rect(0, 0, 100, 100)], holes: [], fillRule: 'evenodd' }],
      'union',
    );
    expect(area(result)).toBeCloseTo(10000, 8);
    expect(result.holes).toHaveLength(0);
  });

  it('satisfies identical-shape and shared-edge identities', () => {
    const a = square(0, 0, 10);
    expect(area(booleanNormalized([a, a], 'union'))).toBeCloseTo(100, 8);
    expect(area(booleanNormalized([a, a], 'intersect'))).toBeCloseTo(100, 8);
    expect(area(booleanNormalized([a, a], 'subtract'))).toBeCloseTo(0, 8);
    expect(area(booleanNormalized([a, a], 'exclude'))).toBeCloseTo(0, 8);

    const shared = booleanNormalized([square(0, 0, 10), square(10, 0, 10)], 'union');
    expect(area(shared)).toBeCloseTo(200, 8);
    expect(shared.components[0]!.outer).toHaveLength(4);
  });

  it('is translation- and scale-stable at extreme document coordinates', () => {
    const operands = [rect(0, 0, 100, 50), rect(35, -15, 100, 50)];
    const base = booleanNormalized(operands, 'exclude');
    const moved = booleanNormalized(
      operands.map((polygon) => translate(polygon, 1_000_000, -1_000_000)),
      'exclude',
    );
    expect(moved.components).toHaveLength(base.components.length);
    expect(area(moved)).toBeCloseTo(area(base), 6);

    const tiny = booleanNormalized(
      operands.map((polygon) => scale(polygon, 1e-6)),
      'intersect',
    );
    const large = booleanNormalized(
      operands.map((polygon) => scale(polygon, 1e6)),
      'intersect',
    );
    expect(tiny.components).toHaveLength(1);
    expect(large.components).toHaveLength(1);
    expect(area(tiny) / 1e-12).toBeCloseTo(area(booleanNormalized(operands, 'intersect')), 6);
    expect(area(large) / 1e12).toBeCloseTo(area(booleanNormalized(operands, 'intersect')), 6);
  });
});
