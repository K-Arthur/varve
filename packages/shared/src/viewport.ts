/**
 * Viewport / camera math — the single source of truth for the canvas camera
 * and screen<->world conversions. All editor code (canvas draw, tools,
 * overlays, reveal) imports from here instead of duplicating the math.
 *
 * Coordinate convention (rotation = 0, renderOrigin = 0):
 *
 *   screen = world · zoom + pan          (world → canvas-area CSS px)
 *   world = (screen − pan) / zoom        (canvas-area CSS px → world)
 *
 * With rotation, transforms compose around the viewport centre:
 *   screen = T(pan) · T(vpCentre) · R(θ) · T(−vpCentre) · S(zoom) · world
 *
 * `pan` is in **CSS pixels**. DPR is applied separately on the canvas context.
 *
 * Research basis: HTML Canvas Transform spec, Figma camera model, Illustrator
 * Rotate View, and Strata ADR-0001.
 */

import type { Affine, Point, Rect } from './affine';
import {
  applyAffine,
  identity,
  multiplyAffine,
  rotateRad,
  scale as scaleAffine,
  transformRect,
  translate,
  tryInvertAffine,
} from './affine';

/** Minimum supported zoom (0.1%). */
export const MIN_ZOOM = 0.001;
/** Maximum supported zoom (6400%). */
export const MAX_ZOOM = 64;
/** Default zoom-to-fit cap. */
export const DEFAULT_REVEAL_MAX_ZOOM = MAX_ZOOM;
/** Default padding (CSS px) around a fitted/revealed node. */
export const DEFAULT_REVEAL_PADDING = 40;
/** Duration (ms) for smooth camera animations. */
export const DEFAULT_CAMERA_ANIMATION_MS = 200;
/** Screen-pixel snap acquire threshold (world = threshold / zoom). */
export const SNAP_THRESHOLD_PX = 8;
/** Hysteresis multiplier for sticky snap release. */
export const STICKY_SNAP_RELEASE_FACTOR = 1.5;
/**
 * Legacy floating-origin grid retained for document/API compatibility.
 * Semantic camera transforms no longer rebase unre-based scene geometry.
 */
export const FLOATING_ORIGIN_GRID = 512;

/** Camera state: pan, zoom, optional view rotation (radians). */
export interface Camera {
  pan: { x: number; y: number };
  zoom: number;
  /** View rotation in radians (non-destructive canvas rotate). Default 0. */
  rotation?: number;
}

/** A viewport size in CSS pixels (the canvas-area's clientWidth/Height). */
export interface Viewport {
  width: number;
  height: number;
}

/** Clamp `z` to the supported zoom range. */
export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Snap threshold in world units for the given zoom. */
export function snapThresholdWorld(zoom: number): number {
  return SNAP_THRESHOLD_PX / Math.max(MIN_ZOOM, zoom);
}

/**
 * Return the semantic render origin.
 *
 * A previous implementation derived a 512-unit origin from the camera and
 * subtracted it in some render paths without rebasing the scene geometry in
 * those same paths. Crossing a cell boundary therefore moved every object by
 * 512 world units. Until IR geometry is deliberately rebased as one atomic
 * operation, the only correct shared origin is zero.
 */
export function computeFloatingOrigin(_cam: Camera, _viewport?: Viewport): Point {
  return [0, 0];
}

/**
 * Build the semantic world→screen affine including rotation, zoom, and pan.
 *
 * `origin` is accepted for compatibility with renderers that rebase their
 * geometry before this call. It must not alter semantic coordinates by
 * itself: applying `T(-origin)` to unre-based scene geometry causes a visible
 * grid-cell jump whenever the origin changes.
 */
export function buildWorldToScreenAffine(
  cam: Camera,
  viewport: Viewport,
  _origin: Point = [0, 0],
): Affine {
  const r = cam.rotation ?? 0;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  let m = identity;
  m = multiplyAffine(scaleAffine(cam.zoom), m);
  m = multiplyAffine(translate(-cx, -cy), m);
  if (r !== 0) {
    m = multiplyAffine(rotateRad(r), m);
  }
  m = multiplyAffine(translate(cx + cam.pan.x, cy + cam.pan.y), m);
  return m;
}

/** Build screen→world affine (inverse of {@link buildWorldToScreenAffine}). */
export function buildScreenToWorldAffine(
  cam: Camera,
  viewport: Viewport,
  origin: Point = [0, 0],
): Affine | null {
  return tryInvertAffine(buildWorldToScreenAffine(cam, viewport, origin));
}

/**
 * Convert canvas-area-relative CSS px → world coords.
 */
export function screenToWorld(
  cam: Camera,
  cx: number,
  cy: number,
  viewport: Viewport = { width: 1920, height: 1080 },
  origin: Point = [0, 0],
): Point {
  const inv = buildScreenToWorldAffine(cam, viewport, origin);
  if (!inv) return [(cx - cam.pan.x) / cam.zoom, (cy - cam.pan.y) / cam.zoom];
  return applyAffine(inv, [cx, cy]);
}

/** Convert world coords → canvas-area-relative CSS px. */
export function worldToScreen(
  cam: Camera,
  wx: number,
  wy: number,
  viewport: Viewport = { width: 1920, height: 1080 },
  origin: Point = [0, 0],
): Point {
  const m = buildWorldToScreenAffine(cam, viewport, origin);
  return applyAffine(m, [wx, wy]);
}

/** Convert a CSS-pixel delta to a world-space delta. */
export function screenDeltaToWorld(cam: Camera, dx: number, dy: number): Point {
  const z = cam.zoom;
  const r = cam.rotation ?? 0;
  if (r === 0) return [dx / z, dy / z];
  const cos = Math.cos(-r);
  const sin = Math.sin(-r);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  return [rx / z, ry / z];
}

export function clientToCanvas(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): Point {
  return [clientX - rect.left, clientY - rect.top];
}

/** Simplified screen-to-world for SVG overlays and other non-camera use. */
export function simpleWorldToScreen(
  wx: number,
  wy: number,
  zoom: number,
  pan: { x: number; y: number },
): Point {
  return [wx * zoom + pan.x, wy * zoom + pan.y];
}

export function simpleScreenToWorld(
  sx: number,
  sy: number,
  zoom: number,
  pan: { x: number; y: number },
): Point {
  return [(sx - pan.x) / zoom, (sy - pan.y) / zoom];
}

/** Legacy alias — uses zero origin and default viewport. */
export function worldToScreenAffine(cam: Camera): Affine {
  return buildWorldToScreenAffine(cam, { width: 1920, height: 1080 }, [0, 0]);
}

/** Apply camera transform to a Canvas2D context (DPR-aware). */
export function applyCameraTransform(
  ctx: {
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    translate: (x: number, y: number) => void;
    rotate: (r: number) => void;
    scale: (x: number, y: number) => void;
  },
  cam: Camera,
  dpr: number,
  viewport: Viewport,
  _origin: Point,
): void {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const r = cam.rotation ?? 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(cam.pan.x, cam.pan.y);
  ctx.translate(cx, cy);
  if (r !== 0) ctx.rotate(r);
  ctx.translate(-cx, -cy);
  ctx.scale(cam.zoom, cam.zoom);
}

export function isRectInView(cam: Camera, viewport: Viewport, worldRect: Rect): boolean {
  const origin = computeFloatingOrigin(cam, viewport);
  const corners: Point[] = [
    [worldRect.x, worldRect.y],
    [worldRect.x + worldRect.w, worldRect.y],
    [worldRect.x, worldRect.y + worldRect.h],
    [worldRect.x + worldRect.w, worldRect.y + worldRect.h],
  ];
  let minSx = Infinity;
  let minSy = Infinity;
  let maxSx = -Infinity;
  let maxSy = -Infinity;
  for (const c of corners) {
    const [sx, sy] = worldToScreen(cam, c[0], c[1], viewport, origin);
    minSx = Math.min(minSx, sx);
    minSy = Math.min(minSy, sy);
    maxSx = Math.max(maxSx, sx);
    maxSy = Math.max(maxSy, sy);
  }
  return minSx >= 0 && minSy >= 0 && maxSx <= viewport.width && maxSy <= viewport.height;
}

export function isWorldRectInViewport(cam: Camera, viewport: Viewport, worldRect: Rect): boolean {
  const origin = computeFloatingOrigin(cam, viewport);
  const corners: Point[] = [
    [worldRect.x, worldRect.y],
    [worldRect.x + worldRect.w, worldRect.y],
    [worldRect.x, worldRect.y + worldRect.h],
    [worldRect.x + worldRect.w, worldRect.y + worldRect.h],
  ];
  let minSx = Infinity;
  let minSy = Infinity;
  let maxSx = -Infinity;
  let maxSy = -Infinity;
  for (const c of corners) {
    const [sx, sy] = worldToScreen(cam, c[0], c[1], viewport, origin);
    minSx = Math.min(minSx, sx);
    minSy = Math.min(minSy, sy);
    maxSx = Math.max(maxSx, sx);
    maxSy = Math.max(maxSy, sy);
  }
  if (maxSx < 0 || maxSy < 0) return false;
  if (minSx > viewport.width || minSy > viewport.height) return false;
  return true;
}

export function fitZoom(
  worldRect: Rect,
  viewport: Viewport,
  padding: number,
  maxZoom: number = DEFAULT_REVEAL_MAX_ZOOM,
): number {
  const availW = Math.max(1, viewport.width - 2 * padding);
  const availH = Math.max(1, viewport.height - 2 * padding);
  const rectW = Math.max(1e-6, worldRect.w);
  const rectH = Math.max(1e-6, worldRect.h);
  return clampZoom(Math.min(availW / rectW, availH / rectH, maxZoom));
}

export function centerBoundsCamera(worldRect: Rect, viewport: Viewport, zoom: number): Camera {
  const cx = worldRect.x + worldRect.w / 2;
  const cy = worldRect.y + worldRect.h / 2;
  return {
    pan: { x: viewport.width / 2 - cx * zoom, y: viewport.height / 2 - cy * zoom },
    zoom,
    rotation: 0,
  };
}

export function fitBoundsCamera(
  worldRect: Rect,
  viewport: Viewport,
  padding: number = DEFAULT_REVEAL_PADDING,
  maxZoom: number = DEFAULT_REVEAL_MAX_ZOOM,
): Camera {
  const zoom = fitZoom(worldRect, viewport, padding, maxZoom);
  return centerBoundsCamera(worldRect, viewport, zoom);
}

export function revealBoundsCamera(
  cam: Camera,
  viewport: Viewport,
  worldRect: Rect,
  padding: number = DEFAULT_REVEAL_PADDING,
): Camera {
  const z = cam.zoom;
  const pz = padding / z;

  const panX = cam.pan.x;
  const panY = cam.pan.y;

  const rectMinX = worldRect.x;
  const rectMinY = worldRect.y;
  const rectMaxX = worldRect.x + worldRect.w;
  const rectMaxY = worldRect.y + worldRect.h;

  const vpMinX = -panX / z;
  const vpMinY = -panY / z;
  const vpMaxX = (viewport.width - panX) / z;
  const vpMaxY = (viewport.height - panY) / z;
  if (
    rectMinX >= vpMinX + pz &&
    rectMinY >= vpMinY + pz &&
    rectMaxX <= vpMaxX - pz &&
    rectMaxY <= vpMaxY - pz
  ) {
    return cam;
  }

  const leftReqX = -z * rectMinX + padding;
  const rightReqX = viewport.width - z * rectMaxX - padding;
  const vpWidthWorld = vpMaxX - vpMinX;
  const fitsX = worldRect.w <= vpWidthWorld - 2 * pz;

  let newPanX: number;
  if (fitsX) {
    if (panX < leftReqX) {
      newPanX = leftReqX <= rightReqX ? leftReqX : (leftReqX + rightReqX) / 2;
    } else if (panX > rightReqX) {
      newPanX = rightReqX >= leftReqX ? rightReqX : (leftReqX + rightReqX) / 2;
    } else {
      newPanX = panX;
    }
  } else if (rectMinX < vpMinX + pz) {
    newPanX = leftReqX;
  } else {
    newPanX = rightReqX;
  }

  const leftReqY = -z * rectMinY + padding;
  const rightReqY = viewport.height - z * rectMaxY - padding;
  const vpHeightWorld = vpMaxY - vpMinY;
  const fitsY = worldRect.h <= vpHeightWorld - 2 * pz;

  let newPanY: number;
  if (fitsY) {
    if (panY < leftReqY) {
      newPanY = leftReqY <= rightReqY ? leftReqY : (leftReqY + rightReqY) / 2;
    } else if (panY > rightReqY) {
      newPanY = rightReqY >= leftReqY ? rightReqY : (leftReqY + rightReqY) / 2;
    } else {
      newPanY = panY;
    }
  } else if (rectMinY < vpMinY + pz) {
    newPanY = leftReqY;
  } else {
    newPanY = rightReqY;
  }

  return {
    pan: { x: Math.round(newPanX * 1000) / 1000, y: Math.round(newPanY * 1000) / 1000 },
    zoom: z,
    rotation: cam.rotation,
  };
}

/**
 * Zoom the camera to `newZoom`, adjusting `pan` so the given world point
 * stays under the same screen position.
 *
 * Solved as a single closed-form calculation. The render origin is semantic
 * zero until a future renderer rebases both geometry and camera atomically.
 */
export function zoomAboutPoint(
  cam: Camera,
  worldAnchor: Point,
  newZoom: number,
  viewport?: Viewport,
): Camera {
  const z = clampZoom(newZoom);
  const vp = viewport ?? { width: 1920, height: 1080 };
  const origin: Point = viewport ? computeFloatingOrigin(cam, viewport) : [0, 0];
  const [screenX, screenY] = worldToScreen(cam, worldAnchor[0], worldAnchor[1], vp, origin);
  const baseCam: Camera = { ...cam, pan: { x: 0, y: 0 }, zoom: z };
  const [baseX, baseY] = worldToScreen(baseCam, worldAnchor[0], worldAnchor[1], vp, origin);
  return {
    ...cam,
    zoom: z,
    pan: { x: screenX - baseX, y: screenY - baseY },
  };
}

export function localRectToScreen(worldMatrix: Affine, cam: Camera, localRect: Rect): Rect {
  return transformRect(worldToScreenAffine(cam), transformRect(worldMatrix, localRect));
}

export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = 1 - (1 - clamped) ** 3;
  const fromRot = from.rotation ?? 0;
  const toRot = to.rotation ?? 0;
  return {
    pan: {
      x: from.pan.x + (to.pan.x - from.pan.x) * eased,
      y: from.pan.y + (to.pan.y - from.pan.y) * eased,
    },
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
    rotation: fromRot + (toRot - fromRot) * eased,
  };
}

export function animateCamera(
  start: Camera,
  end: Camera,
  elapsed: number,
  duration: number = DEFAULT_CAMERA_ANIMATION_MS,
): { camera: Camera; done: boolean } {
  const t = Math.min(1, elapsed / Math.max(1, duration));
  return { camera: lerpCamera(start, end, t), done: t >= 1 };
}

export function clampCamera(
  cam: Camera,
  viewport: Viewport,
  documentBounds: Rect | null,
  margin: number = 500,
): Camera {
  if (!documentBounds) return cam;
  const origin = computeFloatingOrigin(cam, viewport);
  const z = cam.zoom;
  const marginScreen = margin * z;
  const topLeft = worldToScreen(cam, documentBounds.x, documentBounds.y, viewport, origin);
  const bottomRight = worldToScreen(
    cam,
    documentBounds.x + documentBounds.w,
    documentBounds.y + documentBounds.h,
    viewport,
    origin,
  );
  let newPanX = cam.pan.x;
  if (bottomRight[0] < -marginScreen) {
    newPanX = cam.pan.x + (-marginScreen - bottomRight[0]);
  } else if (topLeft[0] > viewport.width + marginScreen) {
    newPanX = cam.pan.x - (topLeft[0] - (viewport.width + marginScreen));
  }
  let newPanY = cam.pan.y;
  if (bottomRight[1] < -marginScreen) {
    newPanY = cam.pan.y + (-marginScreen - bottomRight[1]);
  } else if (topLeft[1] > viewport.height + marginScreen) {
    newPanY = cam.pan.y - (topLeft[1] - (viewport.height + marginScreen));
  }
  return { ...cam, pan: { x: newPanX, y: newPanY } };
}

/** Rotate view about a screen-space anchor; keeps anchor fixed on screen. */
export function rotateAboutScreenPoint(
  cam: Camera,
  screenAnchor: Point,
  radians: number,
  viewport: Viewport = { width: 1920, height: 1080 },
): Camera {
  const origin = computeFloatingOrigin(cam, viewport);
  const worldAnchor = screenToWorld(cam, screenAnchor[0], screenAnchor[1], viewport, origin);
  const newRot = (cam.rotation ?? 0) + radians;
  const rotated: Camera = { ...cam, rotation: newRot };
  const newScreen = worldToScreen(rotated, worldAnchor[0], worldAnchor[1], viewport, origin);
  return {
    ...rotated,
    pan: {
      x: cam.pan.x + (screenAnchor[0] - newScreen[0]),
      y: cam.pan.y + (screenAnchor[1] - newScreen[1]),
    },
  };
}

/** Reset view rotation to 0, keeping viewport centre stable. */
export function resetViewRotation(
  cam: Camera,
  viewport: Viewport = { width: 1920, height: 1080 },
): Camera {
  if ((cam.rotation ?? 0) === 0) return cam;
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  return rotateAboutScreenPoint(cam, [cx, cy], -(cam.rotation ?? 0), viewport);
}

/** Logarithmic zoom step factor (matches pro tool feel). */
export const ZOOM_STEP_FACTOR = 1.25;

/** Compute next zoom level for zoom-in/out buttons. */
export function stepZoom(current: number, direction: 'in' | 'out'): number {
  return clampZoom(direction === 'in' ? current * ZOOM_STEP_FACTOR : current / ZOOM_STEP_FACTOR);
}
