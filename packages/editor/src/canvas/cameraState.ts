/**
 * Editor camera helpers — maps EditorState viewport fields to shared Camera type.
 */
import type { Camera, Point, Rect, Viewport } from '@varve/shared';
import {
  applyCameraTransform,
  computeFloatingOrigin,
  fitBoundsCamera,
  resetViewRotation,
  rotateAboutScreenPoint,
  screenToWorld,
  worldToScreen,
} from '@varve/shared';

export interface EditorCameraState {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
}

export function toCamera(state: EditorCameraState): Camera {
  return {
    pan: state.pan,
    zoom: state.zoom,
    rotation: state.cameraRotation,
  };
}

export function cameraPatch(
  cam: Camera,
): Pick<EditorCameraState, 'zoom' | 'pan' | 'cameraRotation'> {
  return {
    zoom: cam.zoom,
    pan: cam.pan,
    cameraRotation: cam.rotation ?? 0,
  };
}

export function editorScreenToWorld(
  state: EditorCameraState,
  cx: number,
  cy: number,
  viewport: Viewport,
): Point {
  const cam = toCamera(state);
  const origin = computeFloatingOrigin(cam, viewport);
  return screenToWorld(cam, cx, cy, viewport, origin);
}

export function editorWorldToScreen(
  state: EditorCameraState,
  wx: number,
  wy: number,
  viewport: Viewport,
): Point {
  const cam = toCamera(state);
  const origin = computeFloatingOrigin(cam, viewport);
  return worldToScreen(cam, wx, wy, viewport, origin);
}

export function fitBoundsToState(
  bounds: Rect,
  viewport: Viewport,
  padding = 40,
): Pick<EditorCameraState, 'zoom' | 'pan' | 'cameraRotation'> {
  const cam = fitBoundsCamera(bounds, viewport, padding);
  return cameraPatch(cam);
}

export function rotateViewAtScreen(
  state: EditorCameraState,
  screenAnchor: Point,
  radians: number,
  viewport: Viewport,
): Pick<EditorCameraState, 'zoom' | 'pan' | 'cameraRotation'> {
  const cam = rotateAboutScreenPoint(toCamera(state), screenAnchor, radians, viewport);
  return cameraPatch(cam);
}

export function resetViewRotationState(
  state: EditorCameraState,
  viewport: Viewport,
): Pick<EditorCameraState, 'zoom' | 'pan' | 'cameraRotation'> {
  return cameraPatch(resetViewRotation(toCamera(state), viewport));
}

/** Resolve editor canvas viewport from DOM or fallback. */
export function getEditorViewport(canvasEl?: HTMLElement | null): Viewport {
  const el = canvasEl ?? document.querySelector<HTMLElement>('.editor-canvas');
  if (el) return { width: el.clientWidth, height: el.clientHeight };
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight - 120 : 1080,
  };
}

/** Apply DPR-aware camera transform with floating origin to a Canvas2D context. */
export function applyEditorCameraToCtx(
  ctx: CanvasRenderingContext2D,
  state: EditorCameraState,
  dpr: number,
  viewport: Viewport,
): { cam: Camera; origin: Point } {
  const cam = toCamera(state);
  const origin = computeFloatingOrigin(cam, viewport);
  applyCameraTransform(ctx, cam, dpr, viewport, origin);
  return { cam, origin };
}
