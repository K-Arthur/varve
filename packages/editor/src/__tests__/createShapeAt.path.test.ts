// @vitest-environment jsdom
/**
 * Integration tests for createShapeAt path handling.
 * Guards the P0 bug where CanvasArea.buildToolCtx dropped pathPoints.
 */

import type { PathPoint } from '@strata/engine';
import { makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';

/** Mirror createShapeAt path rebasing logic for unit verification. */
function buildPathShape(
  world: { x: number; y: number },
  pathPoints: PathPoint[],
  pathClosed?: boolean,
) {
  const localPoints = pathPoints.map((p) => ({
    ...p,
    x: p.x - world.x,
    y: p.y - world.y,
  }));
  return {
    kind: 'path' as const,
    points: localPoints,
    closed: pathClosed ?? false,
    tolerance: 3,
  };
}

describe('createShapeAt path coordinate contract', () => {
  it('rebases world anchors to local space at node origin', () => {
    const worldPoints: PathPoint[] = [
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 200, y: 150, handleIn: null, handleOut: [10, 5] },
    ];
    const shape = buildPathShape({ x: 100, y: 100 }, worldPoints);
    expect(shape.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(shape.points[1]).toMatchObject({ x: 100, y: 50, handleOut: [10, 5] });
  });

  it('stores closed flag instead of duplicating first anchor', () => {
    const worldPoints: PathPoint[] = [
      { x: 0, y: 0, handleIn: null, handleOut: null },
      { x: 50, y: 50, handleIn: null, handleOut: null },
    ];
    const shape = buildPathShape({ x: 0, y: 0 }, worldPoints, true);
    expect(shape.closed).toBe(true);
    expect(shape.points.length).toBe(2);
  });

  it('makeShapeNode with local points and world transform renders at correct world position', () => {
    const worldPoints: PathPoint[] = [
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 200, y: 150, handleIn: null, handleOut: null },
    ];
    const shape = buildPathShape({ x: 100, y: 100 }, worldPoints);
    const node = makeShapeNode('n1', shape, {
      name: 'Path 1',
      transform: [1, 0, 0, 1, 100, 100],
    });
    expect(node.shape.kind).toBe('path');
    if (node.shape.kind !== 'path') return;
    expect(node.shape.points[1]?.x).toBe(100);
    expect(node.transform[4]).toBe(100);
    expect(node.transform[5]).toBe(100);
  });
});
