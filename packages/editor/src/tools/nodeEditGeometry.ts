import type { PathPoint } from '@varve/engine';
import type { Affine, CubicBezier } from '@varve/shared';
import { applyAffine, cubicBezierPoint, segmentToCubic } from '@varve/shared';

export const NODE_ANCHOR_HIT_RADIUS_CSS_PX = 8;
export const NODE_HANDLE_HIT_RADIUS_CSS_PX = 7;
export const NODE_SEGMENT_HIT_RADIUS_CSS_PX = 9;

export type NodeEditHit =
  | { kind: 'anchor'; anchorIdx: number }
  | { kind: 'handle'; anchorIdx: number; which: 'in' | 'out' }
  | { kind: 'segment'; ringIndex: number; segmentIndex: number; t: number };

interface ScreenPoint {
  x: number;
  y: number;
}

function distanceSquared(a: ScreenPoint, b: ScreenPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function projectedPoint(
  worldTransform: Affine,
  point: readonly [number, number],
  project: (world: { x: number; y: number }) => ScreenPoint,
): ScreenPoint | null {
  const world = applyAffine(worldTransform, point);
  const screen = project({ x: world[0], y: world[1] });
  return Number.isFinite(screen.x) && Number.isFinite(screen.y) ? screen : null;
}

function closestScreenParameter(
  cubic: CubicBezier,
  pointer: ScreenPoint,
  worldTransform: Affine,
  project: (world: { x: number; y: number }) => ScreenPoint,
): { t: number; dist: number } {
  const sampleCount = 24;
  let bestT = 0;
  let bestDist = Infinity;
  for (let sample = 0; sample <= sampleCount; sample++) {
    const t = sample / sampleCount;
    const local = cubicBezierPoint(cubic, t);
    const screen = projectedPoint(worldTransform, [local.x, local.y], project);
    if (!screen) continue;
    const dist = distanceSquared(screen, pointer);
    if (dist < bestDist) {
      bestDist = dist;
      bestT = t;
    }
  }

  let low = Math.max(0, bestT - 1 / sampleCount);
  let high = Math.min(1, bestT + 1 / sampleCount);
  for (let iteration = 0; iteration < 8; iteration++) {
    const leftT = low + (high - low) / 3;
    const rightT = high - (high - low) / 3;
    const leftLocal = cubicBezierPoint(cubic, leftT);
    const rightLocal = cubicBezierPoint(cubic, rightT);
    const leftScreen = projectedPoint(worldTransform, [leftLocal.x, leftLocal.y], project);
    const rightScreen = projectedPoint(worldTransform, [rightLocal.x, rightLocal.y], project);
    const leftDist = leftScreen ? distanceSquared(leftScreen, pointer) : Infinity;
    const rightDist = rightScreen ? distanceSquared(rightScreen, pointer) : Infinity;
    if (leftDist <= rightDist) high = rightT;
    else low = leftT;
  }
  const refinedT = (low + high) / 2;
  const refinedLocal = cubicBezierPoint(cubic, refinedT);
  const refinedScreen = projectedPoint(worldTransform, [refinedLocal.x, refinedLocal.y], project);
  const refinedDist = refinedScreen ? distanceSquared(refinedScreen, pointer) : Infinity;
  if (refinedDist < bestDist) return { t: refinedT, dist: Math.sqrt(refinedDist) };
  return { t: bestT, dist: Math.sqrt(bestDist) };
}

/**
 * Hit-test anchors, handles, then segments in screen space. The projection
 * callback is the same full camera pipeline used by the renderer, so this
 * remains correct under rotation, floating origin, shear, and non-uniform
 * scale. The radii are deliberately CSS pixels and never divided by zoom.
 */
export function findNodeEditHit(
  rings: readonly (readonly PathPoint[])[],
  closed: boolean,
  worldTransform: Affine,
  pointer: ScreenPoint,
  project: (world: { x: number; y: number }) => ScreenPoint,
): NodeEditHit | null {
  let offset = 0;
  let nearestAnchor: { index: number; dist: number } | null = null;
  let nearestHandle: { anchorIdx: number; which: 'in' | 'out'; dist: number } | null = null;

  for (const ring of rings) {
    for (let index = 0; index < ring.length; index++) {
      const point = ring[index]!;
      const anchor = projectedPoint(worldTransform, [point.x, point.y], project);
      if (anchor) {
        const dist = Math.sqrt(distanceSquared(anchor, pointer));
        if (
          dist <= NODE_ANCHOR_HIT_RADIUS_CSS_PX &&
          (!nearestAnchor || dist < nearestAnchor.dist)
        ) {
          nearestAnchor = { index: offset + index, dist };
        }
      }
      for (const which of ['in', 'out'] as const) {
        const handle = which === 'in' ? point.handleIn : point.handleOut;
        if (!handle || (handle[0] === 0 && handle[1] === 0)) continue;
        const control = projectedPoint(
          worldTransform,
          [point.x + handle[0], point.y + handle[1]],
          project,
        );
        if (!control) continue;
        const dist = Math.sqrt(distanceSquared(control, pointer));
        if (
          dist <= NODE_HANDLE_HIT_RADIUS_CSS_PX &&
          (!nearestHandle || dist < nearestHandle.dist)
        ) {
          nearestHandle = { anchorIdx: offset + index, which, dist };
        }
      }
    }
    offset += ring.length;
  }
  if (nearestAnchor) return { kind: 'anchor', anchorIdx: nearestAnchor.index };
  if (nearestHandle) {
    return { kind: 'handle', anchorIdx: nearestHandle.anchorIdx, which: nearestHandle.which };
  }

  let nearestSegment: {
    ringIndex: number;
    segmentIndex: number;
    t: number;
    dist: number;
  } | null = null;
  for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
    const ring = rings[ringIndex]!;
    const segmentCount = closed ? ring.length : ring.length - 1;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const toIndex = segmentIndex + 1 < ring.length ? segmentIndex + 1 : 0;
      const from = ring[segmentIndex];
      const to = ring[toIndex];
      if (!from || !to) continue;
      const candidate = closestScreenParameter(
        segmentToCubic(from, to),
        pointer,
        worldTransform,
        project,
      );
      if (
        candidate.dist <= NODE_SEGMENT_HIT_RADIUS_CSS_PX &&
        (!nearestSegment || candidate.dist < nearestSegment.dist)
      ) {
        nearestSegment = { ringIndex, segmentIndex, ...candidate };
      }
    }
  }
  return nearestSegment
    ? {
        kind: 'segment',
        ringIndex: nearestSegment.ringIndex,
        segmentIndex: nearestSegment.segmentIndex,
        t: nearestSegment.t,
      }
    : null;
}
