import type { Shape } from '@varve/engine';
import { applyAffine, translate } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { pathShapeInTextSpace } from './pathTextGeometry';

describe('pathShapeInTextSpace', () => {
  it('rebases a path drawn away from the text node', () => {
    const source: Shape = { kind: 'circle', cx: 40, cy: 30, r: 20 };
    const pathWorld = translate(100, 200);
    const textWorld = translate(10, 20);

    const rebased = pathShapeInTextSpace(source, pathWorld, textWorld);
    expect(rebased.kind).toBe('path');
    if (rebased.kind !== 'path') return;

    const first = rebased.points[0];
    expect(first).toBeDefined();
    const worldPoint = applyAffine(textWorld, [first!.x, first!.y]);
    const originalWorldPoint = applyAffine(pathWorld, [60, 30]);
    expect(worldPoint[0]).toBeCloseTo(originalWorldPoint[0]);
    expect(worldPoint[1]).toBeCloseTo(originalWorldPoint[1]);
  });

  it('preserves rotation and scale through cubic path handles', () => {
    const source: Shape = { kind: 'circle', cx: 0, cy: 0, r: 10 };
    const pathWorld = [0, 2, -1, 0, 80, 40] as const;
    const textWorld = translate(20, 10);
    const rebased = pathShapeInTextSpace(source, pathWorld, textWorld);

    expect(rebased.kind).toBe('path');
    if (rebased.kind !== 'path') return;
    expect(rebased.points.some((point) => point.handleIn || point.handleOut)).toBe(true);
    const first = rebased.points[0]!;
    const worldPoint = applyAffine(textWorld, [first.x, first.y]);
    const originalWorldPoint = applyAffine(pathWorld, [10, 0]);
    expect(worldPoint[0]).toBeCloseTo(originalWorldPoint[0]);
    expect(worldPoint[1]).toBeCloseTo(originalWorldPoint[1]);
  });
});
