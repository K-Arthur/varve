/**
 * Ruler tick projection under view rotation — maps world-axis ticks to screen
 * positions along the top/left ruler edges.
 */
import type { Point, Viewport } from '@varve/shared';
import { type EditorCameraState, editorScreenToWorld, editorWorldToScreen } from './cameraState';

export type RulerStripAxis = 'horizontal' | 'vertical';

/** Screen position on the ruler strip for a world X tick (top ruler). */
export function projectWorldXToTopEdge(
  worldX: number,
  cam: EditorCameraState,
  viewport: Viewport,
): number | null {
  const [x1, y1] = editorWorldToScreen(cam, worldX, 0, viewport);
  const [x2, y2] = editorWorldToScreen(cam, worldX, 10_000, viewport);
  const dy = y2 - y1;
  if (Math.abs(dy) < 1e-6) return null;
  const t = (0 - y1) / dy;
  return x1 + t * (x2 - x1);
}

/** Screen position on the ruler strip for a world Y tick (left ruler). */
export function projectWorldYToLeftEdge(
  worldY: number,
  cam: EditorCameraState,
  viewport: Viewport,
): number | null {
  const [x1, y1] = editorWorldToScreen(cam, 0, worldY, viewport);
  const [x2, y2] = editorWorldToScreen(cam, 10_000, worldY, viewport);
  const dx = x2 - x1;
  if (Math.abs(dx) < 1e-6) return null;
  const t = (0 - x1) / dx;
  return y1 + t * (y2 - y1);
}

/** Map a pointer on the top ruler strip to world coordinates. */
export function topRulerScreenToWorld(
  screenX: number,
  cam: EditorCameraState,
  viewport: Viewport,
): Point {
  return editorScreenToWorld(cam, screenX, 0, viewport);
}

/** Map a pointer on the left ruler strip to world coordinates. */
export function leftRulerScreenToWorld(
  screenY: number,
  cam: EditorCameraState,
  viewport: Viewport,
): Point {
  return editorScreenToWorld(cam, 0, screenY, viewport);
}

export function visibleWorldSpanOnRulerEdge(
  strip: RulerStripAxis,
  cam: EditorCameraState,
  viewport: Viewport,
): { min: number; max: number } {
  const corners: Point[] = [
    editorScreenToWorld(cam, 0, 0, viewport),
    editorScreenToWorld(cam, viewport.width, 0, viewport),
    editorScreenToWorld(cam, viewport.width, viewport.height, viewport),
    editorScreenToWorld(cam, 0, viewport.height, viewport),
  ];
  const axis = strip === 'horizontal' ? 0 : 1;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const c of corners) {
    min = Math.min(min, c[axis]);
    max = Math.max(max, c[axis]);
  }
  return { min, max };
}
