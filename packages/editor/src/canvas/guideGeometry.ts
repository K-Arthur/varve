/**
 * Screen-space geometry for world-axis-aligned layout guides under view rotation.
 */
import type { Viewport } from '@strata/shared';
import { type EditorCameraState, editorScreenToWorld, editorWorldToScreen } from './cameraState';

export interface GuideAxisLine {
  axis: 'horizontal' | 'vertical';
  position: number;
}

/** World-span large enough to cover the visible viewport at any rotation. */
function visibleWorldSpan(cam: EditorCameraState, viewport: Viewport): number {
  const corners: Array<[number, number]> = [
    [0, 0],
    [viewport.width, 0],
    [viewport.width, viewport.height],
    [0, viewport.height],
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [sx, sy] of corners) {
    const [wx, wy] = editorScreenToWorld(cam, sx, sy, viewport);
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    maxY = Math.max(maxY, wy);
    maxX = Math.max(maxX, wx);
  }
  const margin = Math.max(viewport.width, viewport.height) / Math.max(cam.zoom, 0.001);
  return Math.max(maxX - minX, maxY - minY) + margin * 2;
}

export function guideLineScreenEndpoints(
  guide: GuideAxisLine,
  cam: EditorCameraState,
  viewport: Viewport,
): { x1: number; y1: number; x2: number; y2: number } {
  const span = visibleWorldSpan(cam, viewport);
  const center = editorScreenToWorld(cam, viewport.width / 2, viewport.height / 2, viewport);

  if (guide.axis === 'vertical') {
    const [x1, y1] = editorWorldToScreen(cam, guide.position, center[1] - span, viewport);
    const [x2, y2] = editorWorldToScreen(cam, guide.position, center[1] + span, viewport);
    return { x1, y1, x2, y2 };
  }

  const [x1, y1] = editorWorldToScreen(cam, center[0] - span, guide.position, viewport);
  const [x2, y2] = editorWorldToScreen(cam, center[0] + span, guide.position, viewport);
  return { x1, y1, x2, y2 };
}

/** Map a screen pointer position to the guide's world-axis coordinate. */
export function screenToGuidePosition(
  guide: GuideAxisLine,
  screenX: number,
  screenY: number,
  cam: EditorCameraState,
  viewport: Viewport,
): number {
  const [wx, wy] = editorScreenToWorld(cam, screenX, screenY, viewport);
  return guide.axis === 'vertical' ? wx : wy;
}

/** Squared distance from a screen point to a guide line segment. */
export function distanceSqToGuideLine(
  guide: GuideAxisLine,
  cam: EditorCameraState,
  viewport: Viewport,
  screenX: number,
  screenY: number,
): number {
  const { x1, y1, x2, y2 } = guideLineScreenEndpoints(guide, cam, viewport);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ddx = screenX - x1;
    const ddy = screenY - y1;
    return ddx * ddx + ddy * ddy;
  }
  const t = Math.max(0, Math.min(1, ((screenX - x1) * dx + (screenY - y1) * dy) / lenSq));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  const ex = screenX - px;
  const ey = screenY - py;
  return ex * ex + ey * ey;
}
