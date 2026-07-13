/**
 * Shared zoom math for `EditorProvider`'s `value` and `ViewportContext` —
 * both used to reimplement `zoomIn`/`zoomOut`/`zoomTo` independently, and
 * had silently diverged: `EditorProvider` anchored the zoom around the
 * actual canvas center, `ViewportContext` did a naive `zoom * 1.25` with no
 * anchor point, so `useEditor().zoomIn()` and `useViewport().zoomIn()`
 * produced visibly different results. This module is the single
 * implementation both now delegate to.
 */
import { clampZoom, stepZoom, type Viewport, zoomAboutPoint } from '@strata/shared';
import {
  cameraPatch,
  type EditorCameraState,
  editorScreenToWorld,
  toCamera,
} from '../canvas/cameraState';

type CameraPatch = Pick<EditorCameraState, 'zoom' | 'pan' | 'cameraRotation'>;

function zoomAboutViewportCenter(
  camState: EditorCameraState,
  targetZoom: number,
  viewport: Viewport,
): CameraPatch {
  const centre = editorScreenToWorld(camState, viewport.width / 2, viewport.height / 2, viewport);
  const newCam = zoomAboutPoint(toCamera(camState), centre, targetZoom, viewport);
  return cameraPatch(newCam);
}

/** Step zoom in/out by one increment, anchored around the viewport center. */
export function computeZoomStep(
  camState: EditorCameraState,
  direction: 'in' | 'out',
  viewport: Viewport,
): CameraPatch {
  return zoomAboutViewportCenter(camState, stepZoom(camState.zoom, direction), viewport);
}

/** Zoom to an exact level, anchored around the viewport center. */
export function computeZoomTo(
  camState: EditorCameraState,
  level: number,
  viewport: Viewport,
): CameraPatch {
  return zoomAboutViewportCenter(camState, clampZoom(level), viewport);
}
