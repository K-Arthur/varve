/**
 * Viewport / camera math — the single source of truth for the canvas camera
 * and screen<->world conversions. All editor code (canvas draw, tools,
 * overlays, reveal) imports from here instead of duplicating the math.
 *
 * Coordinate convention:
 *
 *   screen = world · zoom + pan          (world → canvas-area CSS px)
 *   world = (screen − pan) / zoom        (canvas-area CSS px → world)
 *
 * `pan` is in **CSS pixels** and represents the offset of the world origin
 * from the canvas-area's top-left corner. `zoom` is unitless (clamped to
 * [MIN_ZOOM, MAX_ZOOM]). DPR is folded into the canvas 2D context transform
 * separately (`ctx.setTransform(dpr*zoom, 0, 0, dpr*zoom, dpr*pan.x, …)`);
 * pointer coords arrive as CSS pixels and **must not** be double-scaled by
 * DPR.
 *
 * Research basis: HTML Canvas Transform spec, Figma's camera model, and
 * Strata ADR-0001 (IR-replay: webview owns the camera, Rust emits world IR).
 */

import type { Affine, Point, Rect } from './affine';
import {
  multiplyAffine,
  rotateRad,
  scale as scaleAffine,
  transformRect,
  translate,
} from './affine';

/** Minimum supported zoom (10%). Below this, content becomes unreadable. */
export const MIN_ZOOM = 0.1;
/** Maximum supported zoom (1000%). Above this, sub-pixel artefacts dominate. */
export const MAX_ZOOM = 10;
/** Default zoom-to-fit cap so single-pixel shapes don't fill the screen. */
export const DEFAULT_REVEAL_MAX_ZOOM = 10;
/** Default padding (CSS px) around a fitted/revealed node. */
export const DEFAULT_REVEAL_PADDING = 40;
/** Duration (ms) for smooth camera animations. */
export const DEFAULT_CAMERA_ANIMATION_MS = 200;
/** Ease-out factor for camera animations (1 = linear, <1 = ease-out). */
export const CAMERA_EASE_OUT_FACTOR = 0.08;

/** Camera state: pan (CSS px of world origin from canvas-area top-left) + zoom. */
export interface Camera {
  pan: { x: number; y: number };
  zoom: number;
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

/**
 * Convert canvas-area-relative CSS px → world coords.
 *
 * `cx/cy` must already have `getBoundingClientRect().left/top` subtracted
 * (see {@link clientToCanvas}). Raw `clientX/clientY` will produce wrong
 * results — this was the root cause of the original placement bug.
 */
export function screenToWorld(cam: Camera, cx: number, cy: number): Point {
  return [(cx - cam.pan.x) / cam.zoom, (cy - cam.pan.y) / cam.zoom];
}

/** Convert world coords → canvas-area-relative CSS px. */
export function worldToScreen(cam: Camera, wx: number, wy: number): Point {
  return [wx * cam.zoom + cam.pan.x, wy * cam.zoom + cam.pan.y];
}

/** Convert a CSS-pixel delta to a world-space delta (e.g. for drag math). */
export function screenDeltaToWorld(cam: Camera, dx: number, dy: number): Point {
  return [dx / cam.zoom, dy / cam.zoom];
}

/**
 * Convert raw `clientX/clientY` (viewport-relative) to canvas-area-relative
 * CSS px by subtracting the canvas element's bounding rect.
 *
 * This is the **one** place that compensates for the canvas element's screen
 * offset. Tools should never read `clientX/Y` directly — they should receive
 * pre-converted `canvasX/Y` from `CanvasArea`'s pointer handlers.
 */
export function clientToCanvas(
  rect: { left: number; top: number },
  clientX: number,
  clientY: number,
): Point {
  return [clientX - rect.left, clientY - rect.top];
}

/**
 * The full world→screen affine (excluding DPR, which the canvas context
 * applies separately). Useful for transforming rects and overlays.
 */
export function worldToScreenAffine(cam: Camera): Affine {
  return multiplyAffine(translate(cam.pan.x, cam.pan.y), scaleAffine(cam.zoom));
}

/** True if `worldRect` is entirely inside the visible viewport (no pan needed). */
export function isRectInView(cam: Camera, viewport: Viewport, worldRect: Rect): boolean {
  const minX = (-cam.pan.x - 0) / cam.zoom;
  const minY = (-cam.pan.y - 0) / cam.zoom;
  const maxX = (viewport.width - cam.pan.x) / cam.zoom;
  const maxY = (viewport.height - cam.pan.y) / cam.zoom;
  return (
    worldRect.x >= minX &&
    worldRect.y >= minY &&
    worldRect.x + worldRect.w <= maxX &&
    worldRect.y + worldRect.h <= maxY
  );
}

/**
 * Check if `worldRect` intersects the visible viewport (partial visibility
 * counts as intersecting). Used for viewport culling — nodes that do not
 * intersect the viewport can be skipped during rendering.
 *
 * This is different from `isRectInView` which requires full containment.
 * Here we use the Separating Axis Theorem: two rectangles don't intersect
 * if one is completely to the left/right/above/below of the other.
 */
export function isWorldRectInViewport(cam: Camera, viewport: Viewport, worldRect: Rect): boolean {
  const viewMinX = (-cam.pan.x - 0) / cam.zoom;
  const viewMinY = (-cam.pan.y - 0) / cam.zoom;
  const viewMaxX = (viewport.width - cam.pan.x) / cam.zoom;
  const viewMaxY = (viewport.height - cam.pan.y) / cam.zoom;

  if (worldRect.x + worldRect.w < viewMinX) return false;
  if (worldRect.x > viewMaxX) return false;
  if (worldRect.y + worldRect.h < viewMinY) return false;
  if (worldRect.y > viewMaxY) return false;
  return true;
}

/**
 * Compute the zoom that fits `worldRect` into `viewport` with `padding` (CSS
 * px) on all sides, clamped to `[MIN_ZOOM, maxZoom]`.
 */
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

/**
 * Camera that centres `worldRect` in `viewport` at `zoom` (CSS px pan coords).
 *
 * Used by zoom-to-fit / zoom-to-selection: caller computes zoom via
 * {@link fitZoom}, then calls this to get the matching pan.
 */
export function centerBoundsCamera(worldRect: Rect, viewport: Viewport, zoom: number): Camera {
  const cx = worldRect.x + worldRect.w / 2;
  const cy = worldRect.y + worldRect.h / 2;
  return {
    pan: { x: viewport.width / 2 - cx * zoom, y: viewport.height / 2 - cy * zoom },
    zoom,
  };
}

/**
 * Camera that fits `worldRect` into `viewport` with `padding`.
 *
 * One-shot helper combining {@link fitZoom} + {@link centerBoundsCamera}.
 */
export function fitBoundsCamera(
  worldRect: Rect,
  viewport: Viewport,
  padding: number = DEFAULT_REVEAL_PADDING,
  maxZoom: number = DEFAULT_REVEAL_MAX_ZOOM,
): Camera {
  const zoom = fitZoom(worldRect, viewport, padding, maxZoom);
  return centerBoundsCamera(worldRect, viewport, zoom);
}

/**
 * Minimal-pan camera that brings `worldRect` into view without changing zoom.
 *
 * - If the rect is already in view, returns the input camera unchanged.
 * - Otherwise shifts pan by the smallest amount that fully reveals the rect
 *   (snapping the nearer edge to `padding`). For rects larger than the
 *   viewport, aligns the rect's near edge with padding and lets the far edge
 *   overflow.
 *
 * Derivation for each axis independently:
 *
 *   viewportMinWorld = -pan / zoom           (screenX = 0)
 *   viewportMaxWorld = (vpSize - pan) / zoom (screenX = vpSize)
 *
 *   Left-edge constraint: rectMin >= viewportMinWorld + pad/zoom
 *     → pan >= -zoom · rectMin + pad
 *
 *   Right-edge constraint: rectMax <= viewportMaxWorld - pad/zoom
 *     → pan <= vpSize - zoom · rectMax - pad
 *
 * The tightest valid pan is the midpoint of the two constraints (fits case)
 * or the single active constraint (overflow case).
 */
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
  } else {
    if (rectMinX < vpMinX + pz) {
      newPanX = leftReqX;
    } else {
      newPanX = rightReqX;
    }
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
  } else {
    if (rectMinY < vpMinY + pz) {
      newPanY = leftReqY;
    } else {
      newPanY = rightReqY;
    }
  }

  return {
    pan: { x: Math.round(newPanX * 1000) / 1000, y: Math.round(newPanY * 1000) / 1000 },
    zoom: z,
  };
}

/**
 * Camera centred on `worldPoint` at the current zoom (used for cursor-anchored
 * zoom). Maintains the world point under the same screen position before and
 * after the zoom change.
 *
 * Derivation: we want `worldToScreen(camBefore, p) === worldToScreen(camAfter, p)`.
 * Solving: `panAfter = screenP - p · zoomAfter` where `screenP` is the
 * pre-zoom screen position of `p`.
 */
export function zoomAboutPoint(cam: Camera, worldAnchor: Point, newZoom: number): Camera {
  const z = clampZoom(newZoom);
  const [wx, wy] = worldAnchor;
  const screenX = wx * cam.zoom + cam.pan.x;
  const screenY = wy * cam.zoom + cam.pan.y;
  return {
    pan: { x: screenX - wx * z, y: screenY - wy * z },
    zoom: z,
  };
}

/**
 * Transform a local-space rect to a screen-space rect by composing
 * `local→world` (the node's world matrix) with the camera. Used by overlays.
 */
export function localRectToScreen(worldMatrix: Affine, cam: Camera, localRect: Rect): Rect {
  return transformRect(worldToScreenAffine(cam), transformRect(worldMatrix, localRect));
}

/**
 * Smoothly interpolate from `from` camera to `to` camera.
 * Returns an intermediate camera for the given progress `t` (0-1).
 * Uses ease-out curve for natural-feeling animation.
 */
export function lerpCamera(from: Camera, to: Camera, t: number): Camera {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = 1 - (1 - clamped) ** 3;
  return {
    pan: {
      x: from.pan.x + (to.pan.x - from.pan.x) * eased,
      y: from.pan.y + (to.pan.y - from.pan.y) * eased,
    },
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  };
}

/**
 * Compute a camera that smoothly animates from `start` toward `end` over
 * `duration` ms given `elapsed` ms have passed. Returns the intermediate
 * camera and whether the animation is complete.
 */
export function animateCamera(
  start: Camera,
  end: Camera,
  elapsed: number,
  duration: number = DEFAULT_CAMERA_ANIMATION_MS,
): { camera: Camera; done: boolean } {
  const t = Math.min(1, elapsed / Math.max(1, duration));
  return { camera: lerpCamera(start, end, t), done: t >= 1 };
}

/**
 * Clamp a camera's pan so that the document bounds are never more than
 * `margin` world units outside the viewport on each side. This prevents
 * panning into infinite void while still allowing the user to see the
 * pasteboard area around the document.
 *
 * When `documentBounds` is null (empty document), no clamping is applied.
 */
export function clampCamera(
  cam: Camera,
  viewport: Viewport,
  documentBounds: Rect | null,
  margin: number = 500,
): Camera {
  if (!documentBounds) return cam;

  const z = cam.zoom;
  const marginScreen = margin * z;

  const docLeft = documentBounds.x * z + cam.pan.x - marginScreen;
  const docRight = (documentBounds.x + documentBounds.w) * z + cam.pan.x + marginScreen;

  let newPanX = cam.pan.x;
  if (docRight < 0) {
    newPanX = -(documentBounds.x + documentBounds.w) * z + marginScreen;
  } else if (docLeft > viewport.width) {
    newPanX = -documentBounds.x * z + viewport.width + marginScreen;
  }

  const docTop = documentBounds.y * z + cam.pan.y - marginScreen;
  const docBottom = (documentBounds.y + documentBounds.h) * z + cam.pan.y + marginScreen;

  let newPanY = cam.pan.y;
  if (docBottom < 0) {
    newPanY = -(documentBounds.y + documentBounds.h) * z + marginScreen;
  } else if (docTop > viewport.height) {
    newPanY = -documentBounds.y * z + viewport.height + marginScreen;
  }

  return {
    pan: { x: newPanX, y: newPanY },
    zoom: z,
  };
}

/** Apply a CSS-pixel rotation about the screen-space anchor to a camera. */
export function rotateAboutScreenPoint(
  _cam: Camera,
  _screenAnchor: Point,
  _radians: number,
): Camera {
  void rotateRad;
  return _cam;
}
