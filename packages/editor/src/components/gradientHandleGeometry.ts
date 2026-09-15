/**
 * Geometry mutations for the canvas gradient handles.
 *
 * The editor never derives a fill transform from the node bounds after an
 * edit. Instead, it edits the canonical unit-fill → node-local affine matrix
 * directly. This preserves an existing skew, reflection, and the untouched
 * radial axis when the user moves one handle.
 */

import type { GradientFill } from '@varve/scene';
import type { Affine, Point, Rect } from '@varve/shared';
import { gradientTransformForBounds } from '@varve/shared';

export type GradientHandleKind =
  | 'linear-start'
  | 'linear-end'
  | 'radial-center'
  | 'radial-u-axis'
  | 'radial-v-axis';

/**
 * Return a direct-edit version of `gradient` with `handle` at `localPoint`.
 * A legacy rotation-only fill is materialized on the first edit.
 */
export function moveGradientHandle(
  gradient: GradientFill,
  bounds: Rect,
  handle: GradientHandleKind,
  localPoint: Point,
): GradientFill {
  const [a, b, c, d, e, f] = gradientTransformForBounds(gradient, bounds);
  let transform: Affine;

  switch (handle) {
    case 'linear-start': {
      // End = (a + .5c + e, b + .5d + f). Keep it fixed while moving start.
      const endX = a + c * 0.5 + e;
      const endY = b + d * 0.5 + f;
      transform = [
        endX - localPoint[0],
        endY - localPoint[1],
        c,
        d,
        localPoint[0] - c * 0.5,
        localPoint[1] - d * 0.5,
      ];
      break;
    }
    case 'linear-end': {
      // Start = (.5c + e, .5d + f). Keep it fixed while moving end.
      const startX = c * 0.5 + e;
      const startY = d * 0.5 + f;
      transform = [
        localPoint[0] - startX,
        localPoint[1] - startY,
        c,
        d,
        startX - c * 0.5,
        startY - d * 0.5,
      ];
      break;
    }
    case 'radial-center':
      // Center = .5u + .5v + translation. Keep both radius axes intact.
      transform = [a, b, c, d, localPoint[0] - (a + c) * 0.5, localPoint[1] - (b + d) * 0.5];
      break;
    case 'radial-u-axis': {
      const centerX = (a + c) * 0.5 + e;
      const centerY = (b + d) * 0.5 + f;
      // The canonical U end is [1, .5], half a matrix column from centre.
      const nextA = (localPoint[0] - centerX) * 2;
      const nextB = (localPoint[1] - centerY) * 2;
      transform = [nextA, nextB, c, d, centerX - (nextA + c) * 0.5, centerY - (nextB + d) * 0.5];
      break;
    }
    case 'radial-v-axis': {
      const centerX = (a + c) * 0.5 + e;
      const centerY = (b + d) * 0.5 + f;
      // The canonical V end is [.5, 1], half a matrix column from centre.
      const nextC = (localPoint[0] - centerX) * 2;
      const nextD = (localPoint[1] - centerY) * 2;
      transform = [a, b, nextC, nextD, centerX - (a + nextC) * 0.5, centerY - (b + nextD) * 0.5];
      break;
    }
  }

  return { ...gradient, transform };
}
