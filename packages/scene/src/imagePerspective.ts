/**
 * Non-destructive four-corner (perspective) transform of an image fill.
 *
 * A perspective quad maps the image node's box rectangle (0,0)-(w,h) in
 * node-local coordinates onto an arbitrary convex quadrilateral. The engine
 * renders this through its canonical projective `warpedImage` primitive
 * (solved with the shared normalized-DLT homography solver), so the source
 * pixels and crop are never baked away and remain fully re-editable.
 *
 * The quad is intentionally expressed in node-local space (not source pixels
 * and not world space) so it composes correctly under the node's own
 * transform and so changing the crop only re-bakes the cached surface, not
 * the quad itself.
 */

import { isQuadValid, type Quad, type Vec2 } from '@varve/engine';
import type { Point } from '@varve/shared';

/**
 * Non-destructive four-corner (perspective) transform of an image fill.
 *
 * The quad maps the image node's box rectangle (0,0)-(w,h) in node-local
 * coordinates onto an arbitrary convex quadrilateral (corner order
 * [top-left, top-right, bottom-right, bottom-left]). Defined here (rather
 * than in types.ts) to avoid a circular import with the normalization
 * helpers that live in this module.
 */
export interface ImageFillPerspective {
  quad: readonly [Point, Point, Point, Point];
}

/** Four corner points in node-local coordinates: [TL, TR, BR, BL]. */
export type PerspectiveQuad = readonly [Point, Point, Point, Point];

/** Axis-aligned identity quad for a box of size (w, h). */
export function defaultPerspectiveQuad(w: number, h: number): PerspectiveQuad {
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

function toVec2(p: Point): Vec2 {
  return { x: p[0], y: p[1] };
}

/** Convert the scene perspective quad to the engine's Quad ([Vec2; 4]). */
export function perspectiveQuadToEngineQuad(quad: PerspectiveQuad): Quad {
  return [toVec2(quad[0]), toVec2(quad[1]), toVec2(quad[2]), toVec2(quad[3])];
}

/**
 * Validate a perspective quad: must be four finite [x,y] points forming a
 * valid convex, non-degenerate, non-self-crossing quadruple. Degenerate or
 * folded quads are rejected so rendering never receives corrupted geometry.
 */
export function isPerspectiveQuadValid(quad: PerspectiveQuad | undefined): boolean {
  if (!quad || quad.length !== 4) return false;
  for (const p of quad) {
    if (
      !Array.isArray(p) ||
      p.length !== 2 ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1])
    ) {
      return false;
    }
  }
  return isQuadValid(perspectiveQuadToEngineQuad(quad));
}

/**
 * Normalize a persisted perspective transform. Returns undefined for an
 * absent or invalid quad (callers drop the field rather than render broken
 * geometry). Validity mirrors the engine's projective solver requirements.
 */
export function normalizeImagePerspective(
  perspective: ImageFillPerspective | undefined,
): ImageFillPerspective | undefined {
  if (!perspective) return undefined;
  return isPerspectiveQuadValid(perspective.quad) ? { quad: perspective.quad } : undefined;
}
