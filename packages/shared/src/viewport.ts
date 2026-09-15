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

const DEFAULT_VIEWPORT: Viewport = { width: 1920, height: 1080 };

function isFiniteCamera(cam: Camera): boolean {
  return (
    Number.isFinite(cam.pan.x) &&
    Number.isFinite(cam.pan.y) &&
    Number.isFinite(cam.zoom) &&
    cam.zoom > 0 &&
    (cam.rotation === undefined || Number.isFinite(cam.rotation))
  );
}

function isFiniteViewport(viewport: Viewport): boolean {
  return (
    Number.isFinite(viewport.width) &&
    viewport.width >= 0 &&
    Number.isFinite(viewport.height) &&
    viewport.height >= 0
  );
}

function isFinitePoint(point: Point): boolean {
  return Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function normalizeRect(rect: Rect): Rect | null {
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return null;
  const x2 = rect.x + rect.w;
  const y2 = rect.y + rect.h;
  if (!Number.isFinite(x2) || !Number.isFinite(y2)) return null;
  return {
    x: Math.min(rect.x, x2),
    y: Math.min(rect.y, y2),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  };
}

function projectedScreenBounds(
  cam: Camera,
  viewport: Viewport,
  worldRect: Rect,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const rect = normalizeRect(worldRect);
  if (!rect || !isFiniteCamera(cam) || !isFiniteViewport(viewport)) return null;
  const origin = computeFloatingOrigin(cam, viewport);
  const corners: Point[] = [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x, rect.y + rect.h],
    [rect.x + rect.w, rect.y + rect.h],
  ];
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const [x, y] = worldToScreen(cam, corner[0], corner[1], viewport, origin);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** Clamp `z` to the supported zoom range. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
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
  const safeViewport = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const safeZoom = Number.isFinite(cam.zoom) && cam.zoom > 0 ? clampZoom(cam.zoom) : 1;
  const panX = Number.isFinite(cam.pan.x) ? cam.pan.x : 0;
  const panY = Number.isFinite(cam.pan.y) ? cam.pan.y : 0;
  const r = Number.isFinite(cam.rotation) ? (cam.rotation ?? 0) : 0;
  const cx = safeViewport.width / 2;
  const cy = safeViewport.height / 2;
  let m = identity;
  m = multiplyAffine(scaleAffine(safeZoom), m);
  m = multiplyAffine(translate(-cx, -cy), m);
  if (r !== 0) {
    m = multiplyAffine(rotateRad(r), m);
  }
  m = multiplyAffine(translate(cx + panX, cy + panY), m);
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
  const vp = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const point: Point = [Number.isFinite(cx) ? cx : 0, Number.isFinite(cy) ? cy : 0];
  const inv = buildScreenToWorldAffine(cam, vp, origin);
  if (!inv) return [0, 0];
  const result = applyAffine(inv, point);
  return isFinitePoint(result) ? result : [0, 0];
}

/** Convert world coords → canvas-area-relative CSS px. */
export function worldToScreen(
  cam: Camera,
  wx: number,
  wy: number,
  viewport: Viewport = { width: 1920, height: 1080 },
  origin: Point = [0, 0],
): Point {
  const vp = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const m = buildWorldToScreenAffine(cam, vp, origin);
  const point: Point = [Number.isFinite(wx) ? wx : 0, Number.isFinite(wy) ? wy : 0];
  const result = applyAffine(m, point);
  return isFinitePoint(result) ? result : [0, 0];
}

/** Convert a CSS-pixel delta to a world-space delta. */
export function screenDeltaToWorld(cam: Camera, dx: number, dy: number): Point {
  const z = Number.isFinite(cam.zoom) && cam.zoom > 0 ? cam.zoom : 1;
  const r = Number.isFinite(cam.rotation) ? (cam.rotation ?? 0) : 0;
  const safeDx = Number.isFinite(dx) ? dx : 0;
  const safeDy = Number.isFinite(dy) ? dy : 0;
  if (r === 0) return [safeDx / z, safeDy / z];
  const cos = Math.cos(-r);
  const sin = Math.sin(-r);
  const rx = safeDx * cos - safeDy * sin;
  const ry = safeDx * sin + safeDy * cos;
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
  const rect = normalizeRect(worldRect);
  if (!rect || !isFiniteViewport(viewport)) return 1;
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const safeMaxZoom = Number.isFinite(maxZoom) ? maxZoom : DEFAULT_REVEAL_MAX_ZOOM;
  const availW = Math.max(1, viewport.width - 2 * safePadding);
  const availH = Math.max(1, viewport.height - 2 * safePadding);
  const rectW = Math.max(1e-6, rect.w);
  const rectH = Math.max(1e-6, rect.h);
  return clampZoom(Math.min(availW / rectW, availH / rectH, safeMaxZoom));
}

export function centerBoundsCamera(worldRect: Rect, viewport: Viewport, zoom: number): Camera {
  const rect = normalizeRect(worldRect) ?? { x: 0, y: 0, w: 0, h: 0 };
  const safeViewport = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : 1;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return {
    pan: {
      x: safeViewport.width / 2 - cx * safeZoom,
      y: safeViewport.height / 2 - cy * safeZoom,
    },
    zoom: safeZoom,
    rotation: 0,
  };
}

/** Center a world AABB while preserving the current view rotation. */
export function centerBoundsCameraWithRotation(
  worldRect: Rect,
  viewport: Viewport,
  zoom: number,
  rotation: number,
): Camera {
  const rect = normalizeRect(worldRect) ?? { x: 0, y: 0, w: 0, h: 0 };
  const safeViewport = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? clampZoom(zoom) : 1;
  const safeRotation = Number.isFinite(rotation) ? rotation : 0;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const viewportCx = safeViewport.width / 2;
  const viewportCy = safeViewport.height / 2;
  const cos = Math.cos(safeRotation);
  const sin = Math.sin(safeRotation);
  const rotatedX = cos * (cx * safeZoom - viewportCx) - sin * (cy * safeZoom - viewportCy);
  const rotatedY = sin * (cx * safeZoom - viewportCx) + cos * (cy * safeZoom - viewportCy);
  return {
    pan: { x: viewportCx - viewportCx - rotatedX, y: viewportCy - viewportCy - rotatedY },
    zoom: safeZoom,
    rotation: safeRotation,
  };
}

/** Fit a world AABB without resetting the user's non-destructive view rotation. */
export function fitBoundsCameraWithRotation(
  worldRect: Rect,
  viewport: Viewport,
  rotation: number,
  padding: number = DEFAULT_REVEAL_PADDING,
  maxZoom: number = DEFAULT_REVEAL_MAX_ZOOM,
): Camera {
  const rect = normalizeRect(worldRect);
  const safeViewport = isFiniteViewport(viewport) ? viewport : DEFAULT_VIEWPORT;
  const safeRotation = Number.isFinite(rotation) ? rotation : 0;
  if (!rect) {
    return centerBoundsCameraWithRotation({ x: 0, y: 0, w: 0, h: 0 }, safeViewport, 1, 0);
  }
  const absCos = Math.abs(Math.cos(safeRotation));
  const absSin = Math.abs(Math.sin(safeRotation));
  const projected = {
    x: 0,
    y: 0,
    w: rect.w * absCos + rect.h * absSin,
    h: rect.w * absSin + rect.h * absCos,
  };
  const zoom = fitZoom(projected, safeViewport, padding, maxZoom);
  return centerBoundsCameraWithRotation(rect, safeViewport, zoom, safeRotation);
}

/**
 * Reveal a world AABB with a screen-space pan while preserving zoom/rotation.
 * Projected corners are used so rotated views do not reveal the wrong edge.
 */
export function revealBoundsCameraWithRotation(
  cam: Camera,
  viewport: Viewport,
  worldRect: Rect,
  padding: number = DEFAULT_REVEAL_PADDING,
): Camera {
  if (!isFiniteCamera(cam) || !isFiniteViewport(viewport)) return cam;
  const projected = projectedScreenBounds(cam, viewport, worldRect);
  if (!projected) return cam;
  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const { minX, minY, maxX, maxY } = projected;
  const usableW = Math.max(1, viewport.width - safePadding * 2);
  const usableH = Math.max(1, viewport.height - safePadding * 2);
  if (
    minX >= safePadding &&
    minY >= safePadding &&
    maxX <= safePadding + usableW &&
    maxY <= safePadding + usableH
  ) {
    return cam;
  }

  const dx =
    minX < safePadding
      ? safePadding - minX
      : maxX > safePadding + usableW
        ? safePadding + usableW - maxX
        : 0;
  const dy =
    minY < safePadding
      ? safePadding - minY
      : maxY > safePadding + usableH
        ? safePadding + usableH - maxY
        : 0;
  return { ...cam, pan: { x: cam.pan.x + dx, y: cam.pan.y + dy } };
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
  return revealBoundsCameraWithRotation(cam, viewport, worldRect, padding);
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
  if (!isFiniteCamera(cam) || !isFinitePoint(worldAnchor) || !Number.isFinite(newZoom)) return cam;
  const z = clampZoom(newZoom);
  const vp = viewport ?? DEFAULT_VIEWPORT;
  if (!isFiniteViewport(vp) || vp.width === 0 || vp.height === 0) return cam;
  const origin: Point = viewport ? computeFloatingOrigin(cam, viewport) : [0, 0];
  const [screenX, screenY] = worldToScreen(cam, worldAnchor[0], worldAnchor[1], vp, origin);
  if (![screenX, screenY].every(Number.isFinite)) return cam;
  return placeWorldPointAtScreen(cam, worldAnchor, [screenX, screenY], z, vp);
}

/**
 * Place a world point at an explicit viewport-local CSS pixel position.
 *
 * This is the general form of focal-point zoom. It is needed when the
 * screen-space anchor moves during a gesture (for example, a pinch centroid):
 * the world point captured at gesture start must follow the moving centroid
 * while the zoom changes. Clamping happens before the translation is solved,
 * so a zoom-limit hit cannot introduce a focal-point jump.
 */
export function placeWorldPointAtScreen(
  cam: Camera,
  worldAnchor: Point,
  screenAnchor: Point,
  newZoom: number = cam.zoom,
  viewport: Viewport = DEFAULT_VIEWPORT,
): Camera {
  if (
    !isFiniteCamera(cam) ||
    !isFinitePoint(worldAnchor) ||
    !isFinitePoint(screenAnchor) ||
    !Number.isFinite(newZoom) ||
    !isFiniteViewport(viewport) ||
    viewport.width === 0 ||
    viewport.height === 0
  ) {
    return cam;
  }
  const z = clampZoom(newZoom);
  const origin = computeFloatingOrigin(cam, viewport);
  const baseCam: Camera = { ...cam, pan: { x: 0, y: 0 }, zoom: z };
  const [baseX, baseY] = worldToScreen(baseCam, worldAnchor[0], worldAnchor[1], viewport, origin);
  if (![baseX, baseY].every(Number.isFinite)) return cam;
  return {
    ...cam,
    zoom: z,
    pan: { x: screenAnchor[0] - baseX, y: screenAnchor[1] - baseY },
  };
}

export function localRectToScreen(worldMatrix: Affine, cam: Camera, localRect: Rect): Rect {
  return transformRect(
    buildWorldToScreenAffine(cam, DEFAULT_VIEWPORT),
    transformRect(worldMatrix, localRect),
  );
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
  if (!documentBounds || !isFiniteCamera(cam) || !isFiniteViewport(viewport)) return cam;
  const projected = projectedScreenBounds(cam, viewport, documentBounds);
  if (!projected) return cam;
  const z = cam.zoom;
  const safeMargin = Number.isFinite(margin) ? Math.max(0, margin) : 500;
  const marginScreen = safeMargin * z;
  let newPanX = cam.pan.x;
  if (projected.maxX < -marginScreen) {
    newPanX = cam.pan.x + (-marginScreen - projected.maxX);
  } else if (projected.minX > viewport.width + marginScreen) {
    newPanX = cam.pan.x - (projected.minX - (viewport.width + marginScreen));
  }
  let newPanY = cam.pan.y;
  if (projected.maxY < -marginScreen) {
    newPanY = cam.pan.y + (-marginScreen - projected.maxY);
  } else if (projected.minY > viewport.height + marginScreen) {
    newPanY = cam.pan.y - (projected.minY - (viewport.height + marginScreen));
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
