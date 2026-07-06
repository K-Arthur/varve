/**
 * Artboard / page coordinate helpers — display-layer conversions only.
 * Scene nodes remain stored in world (document) space.
 *
 * Research basis: Adobe Illustrator global vs artboard ruler modes,
 * Strata canvas audit Phase B.
 */

import type { Point, Rect } from './affine';

/** Ruler origin mode — view preference, not persisted on Document. */
export type RulerMode = 'global' | 'artboard';

/** Convert world point to artboard-local coordinates. */
export function worldToArtboard(point: Point, artboard: Rect): Point {
  return [point[0] - artboard.x, point[1] - artboard.y];
}

/** Convert artboard-local point to world coordinates. */
export function artboardToWorld(point: Point, artboard: Rect): Point {
  return [point[0] + artboard.x, point[1] + artboard.y];
}

/** World-space ruler origin for tick labels (top-left of artboard + optional offset). */
export function getArtboardRulerOrigin(
  artboard: Rect,
  rulerOrigin?: Point,
): Point {
  if (rulerOrigin) {
    return [artboard.x + rulerOrigin[0], artboard.y + rulerOrigin[1]];
  }
  return [artboard.x, artboard.y];
}

/** Format a world coordinate for display in the active ruler mode. */
export function formatCoordForRuler(
  worldValue: number,
  axis: 'x' | 'y',
  mode: RulerMode,
  artboard: Rect | null,
  rulerOrigin?: Point,
): number {
  if (mode === 'global' || !artboard) return worldValue;
  const origin = getArtboardRulerOrigin(artboard, rulerOrigin);
  return worldValue - (axis === 'x' ? origin[0] : origin[1]);
}
