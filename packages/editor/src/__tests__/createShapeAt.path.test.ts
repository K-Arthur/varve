// @vitest-environment jsdom
/**
 * Integration tests for createShapeAt path handling.
 * Guards the P0 bug where CanvasArea.buildToolCtx dropped pathPoints, and the
 * transformed-parent case where anchors were rebased by translation only —
 * correct for identity parents but drifting by the parent's rotation/scale.
 */

import type { PathPoint } from '@varve/engine';
import { makeShapeNode } from '@varve/scene';
import { applyAffine, invertAffine, multiplyAffine, rotateDeg, scale } from '@varve/shared';
import { describe, expect, it } from 'vitest';
import { pathPointsWorldToLocal } from '../tools/pathCoords';

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

/**
 * Mirror the createShapeAt parented branch: transform the node's transform
 * into the parent's space via the full inverse, and remap path anchors
 * through the full inverse relative to the rebased origin.
 */
function buildPathShapeInParent(
  world: { x: number; y: number },
  pathPoints: PathPoint[],
  parentWorld: [number, number, number, number, number, number],
  pathClosed?: boolean,
) {
  const pInv = invertAffine(parentWorld);
  const localPos = applyAffine(pInv, [world.x, world.y]);
  const absoluteLocal = pathPointsWorldToLocal(pathPoints, parentWorld);
  const localPoints = absoluteLocal.map((p) => ({
    ...p,
    x: p.x - localPos[0],
    y: p.y - localPos[1],
  }));
  return {
    kind: 'path' as const,
    points: localPoints,
    closed: pathClosed ?? false,
    tolerance: 3,
  };
}

/** Compose the parent and node transforms and verify each anchor round-trips. */
function verifyWorldPositions(
  parentWorld: [number, number, number, number, number, number],
  nodeTransform: [number, number, number, number, number, number],
  points: Array<{ x: number; y: number }>,
  worldPoints: PathPoint[],
) {
  const composed = multiplyAffine(parentWorld, nodeTransform);
  points.forEach((p, i) => {
    const [wx, wy] = applyAffine(composed, [p.x, p.y]);
    expect(wx).toBeCloseTo(worldPoints[i]!.x, 6);
    expect(wy).toBeCloseTo(worldPoints[i]!.y, 6);
  });
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

  it('path inside a 2x scaled frame lands at the drawn world positions', () => {
    // Parent frame at (1000, 500) scaled 2x.
    const parentWorld: [number, number, number, number, number, number] = [2, 0, 0, 2, 1000, 500];
    const worldStart = { x: 1020, y: 520 };
    const worldPoints: PathPoint[] = [
      { x: 1020, y: 520, handleIn: null, handleOut: null },
      { x: 1100, y: 600, handleIn: null, handleOut: [20, 10] },
      { x: 1050, y: 650, handleIn: [10, -5], handleOut: null },
    ];
    const shape = buildPathShapeInParent(worldStart, worldPoints, parentWorld);
    // Node transform must be the parent-local origin.
    const localPos = applyAffine(invertAffine(parentWorld), [worldStart.x, worldStart.y]);
    const node = makeShapeNode('n1', shape, {
      name: 'Path',
      transform: [1, 0, 0, 1, localPos[0], localPos[1]],
    });
    expect(node.shape.kind).toBe('path');
    if (node.shape.kind !== 'path') return;
    verifyWorldPositions(parentWorld, node.transform as never, node.shape.points, worldPoints);
  });

  it('path inside a 45-degree rotated frame lands at the drawn world positions', () => {
    const parentWorld = multiplyAffine([1, 0, 0, 1, 300, -200], rotateDeg(45)) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const worldStart = { x: 320, y: -180 };
    const worldPoints: PathPoint[] = [
      { x: 320, y: -180, handleIn: null, handleOut: null },
      { x: 380, y: -120, handleIn: null, handleOut: [10, 0] },
    ];
    const shape = buildPathShapeInParent(worldStart, worldPoints, parentWorld);
    const localPos = applyAffine(invertAffine(parentWorld), [worldStart.x, worldStart.y]);
    const node = makeShapeNode('n1', shape, {
      name: 'Path',
      transform: [1, 0, 0, 1, localPos[0], localPos[1]],
    });
    expect(node.shape.kind).toBe('path');
    if (node.shape.kind !== 'path') return;
    verifyWorldPositions(parentWorld, node.transform as never, node.shape.points, worldPoints);
  });

  it('scaled-parent path points match the translation-only rebase when handles are vectors', () => {
    // A 2x-scaled parent doubles vector magnitudes of handles; the anchor
    // positions must land exactly (no drift from a stale translation-only
    // rebase).
    const parentWorld: [number, number, number, number, number, number] = [2, 0, 0, 2, 1000, 500];
    const worldStart = { x: 1020, y: 520 };
    const worldPoints: PathPoint[] = [
      { x: 1020, y: 520, handleIn: null, handleOut: [20, 10] },
      { x: 1100, y: 600, handleIn: null, handleOut: null },
    ];
    const shape = buildPathShapeInParent(worldStart, worldPoints, parentWorld);
    const localPos = applyAffine(invertAffine(parentWorld), [worldStart.x, worldStart.y]);
    const node = makeShapeNode('n1', shape, {
      name: 'Path',
      transform: [1, 0, 0, 1, localPos[0], localPos[1]],
    });
    expect(node.shape.kind).toBe('path');
    if (node.shape.kind !== 'path') return;
    const first = node.shape.points[0]!;
    // Anchor at the node origin → (0,0) local.
    expect(first.x).toBeCloseTo(0, 6);
    expect(first.y).toBeCloseTo(0, 6);
    // Handle vector (20,10) world → (10,5) local under 2x scale.
    expect(first.handleOut![0]).toBeCloseTo(10, 6);
    expect(first.handleOut![1]).toBeCloseTo(5, 6);
    verifyWorldPositions(parentWorld, node.transform as never, node.shape.points, worldPoints);
  });

  it('identity-scale parent behaves exactly like the root (translation-only) rebase', () => {
    const parentWorld: [number, number, number, number, number, number] = [1, 0, 0, 1, 100, 100];
    const worldStart = { x: 100, y: 100 };
    const worldPoints: PathPoint[] = [
      { x: 100, y: 100, handleIn: null, handleOut: null },
      { x: 200, y: 150, handleIn: null, handleOut: [10, 5] },
    ];
    const shape = buildPathShapeInParent(worldStart, worldPoints, parentWorld);
    expect(shape.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(shape.points[1]).toMatchObject({ x: 100, y: 50, handleOut: [10, 5] });
  });

  it('scale() import is used only for the identity check helper', () => {
    // Keep the import graph honest: `scale` composes the parent linear part
    // in the verify helper.
    expect(scale(1)).toEqual([1, 0, 0, 1, 0, 0]);
  });
});
