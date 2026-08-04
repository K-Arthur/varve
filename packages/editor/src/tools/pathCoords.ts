/**
 * Path coordinate utilities for Pen/Pencil tools.
 *
 * Path anchors are stored in node-local space; tools work in world space
 * during capture. These helpers convert between the two consistently.
 *
 * Research basis: Figma/Illustrator path model — anchors local to node
 * transform origin; handles are relative offsets from each anchor.
 */

import type { PathPoint } from '@varve/engine';
import type { Affine } from '@varve/shared';
import { applyAffine, invertAffine } from '@varve/shared';

/** Rebase world-space anchors to local space relative to `originWorld`. */
export function rebasePathPointsToLocal(
  worldPoints: PathPoint[],
  originWorld: { x: number; y: number },
): PathPoint[] {
  return worldPoints.map((p) => ({
    ...p,
    x: p.x - originWorld.x,
    y: p.y - originWorld.y,
  }));
}

/** Convert local-space anchors to world space using a composed world transform. */
export function pathPointsLocalToWorld(
  localPoints: PathPoint[],
  worldTransform: Affine,
): PathPoint[] {
  const inv = invertAffine(worldTransform);
  if (!inv) return localPoints.map((p) => ({ ...p }));
  // Linear part for handle vectors (no translation on offsets)
  const scaleHandle = (hx: number, hy: number): [number, number] => {
    const [wx, wy] = applyAffine(worldTransform, [hx, hy]);
    const [ox, oy] = applyAffine(worldTransform, [0, 0]);
    return [wx - ox, wy - oy];
  };
  return localPoints.map((p) => {
    const [wx, wy] = applyAffine(worldTransform, [p.x, p.y]);
    return {
      ...p,
      x: wx,
      y: wy,
      handleIn: p.handleIn ? scaleHandle(p.handleIn[0], p.handleIn[1]) : null,
      handleOut: p.handleOut ? scaleHandle(p.handleOut[0], p.handleOut[1]) : null,
    };
  });
}

/** Convert world-space anchors to local space using a composed world transform. */
export function pathPointsWorldToLocal(
  worldPoints: PathPoint[],
  worldTransform: Affine,
): PathPoint[] {
  const inv = invertAffine(worldTransform);
  if (!inv) return worldPoints;
  const scaleHandle = (hx: number, hy: number): [number, number] => {
    const [lx, ly] = applyAffine(inv, [hx, hy]);
    const [ox, oy] = applyAffine(inv, [0, 0]);
    return [lx - ox, ly - oy];
  };
  return worldPoints.map((p) => {
    const [lx, ly] = applyAffine(inv, [p.x, p.y]);
    return {
      ...p,
      x: lx,
      y: ly,
      handleIn: p.handleIn ? scaleHandle(p.handleIn[0], p.handleIn[1]) : null,
      handleOut: p.handleOut ? scaleHandle(p.handleOut[0], p.handleOut[1]) : null,
    };
  });
}

/** World position of a path endpoint (first or last anchor). */
export function pathEndpointWorld(
  localPoints: PathPoint[],
  worldTransform: Affine,
  endpoint: 'first' | 'last',
): { x: number; y: number } | null {
  const idx = endpoint === 'first' ? 0 : localPoints.length - 1;
  const p = localPoints[idx];
  if (!p) return null;
  const [wx, wy] = applyAffine(worldTransform, [p.x, p.y]);
  return { x: wx, y: wy };
}

/** Distance in world space between a point and a path endpoint. */
export function distanceToPathEndpoint(
  world: { x: number; y: number },
  localPoints: PathPoint[],
  worldTransform: Affine,
  endpoint: 'first' | 'last',
): number {
  const ep = pathEndpointWorld(localPoints, worldTransform, endpoint);
  if (!ep) return Number.POSITIVE_INFINITY;
  const dx = world.x - ep.x;
  const dy = world.y - ep.y;
  return Math.sqrt(dx * dx + dy * dy);
}
