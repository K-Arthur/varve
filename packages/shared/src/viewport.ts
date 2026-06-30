/**
 * Viewport / camera math — the single source of truth for the canvas camera
 * and screen↔world conversions. All editor code (canvas draw, tools,
 * overlays, reveal) imports from here instead of duplicating the math.
 *
 * Coordinate convention (verified against CanvasArea.tsx:235):
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
import { multiplyAffine, rotateRad, scale as scaleAffine, translate, transformRect } from './affine';

/** Minimum supported zoom (10%). Below this, content becomes unreadable. */
export const MIN_ZOOM = 0.1;
/** Maximum supported zoom (1000%). Above this, sub-pixel artefacts dominate. */
export const MAX_ZOOM = 10;
/** Default zoom-to-fit cap so single-pixel shapes don't fill the screen. */
export const DEFAULT_REVEAL_MAX_ZOOM = 10;
/** Default padding (CSS px) around a fitted/revealed node. */
export const DEFAULT_REVEAL_PADDING = 40;

/** Camera state: pan (CSS px of world origin from canvas-area top-left) + zoom. */
export interface Camera {
  pan: Point;
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
  return [(cx - cam.pan[0]) / cam.zoom, (cy - cam.pan[1]) / cam.zoom];
}

/** Convert world coords → canvas-area-relative CSS px. */
export function worldToScreen(cam: Camera, wx: number, wy: number): Point {
  return [wx * cam.zoom + cam.pan[0], wy * cam.zoom + cam.pan[1]];
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
  return multiplyAffine(translate(cam.pan[0], cam.pan[1]), scaleAffine(cam.zoom));
}

/** True if `worldRect` is entirely inside the visible viewport (no pan needed). */
export function isRectInView(cam: Camera, viewport: Viewport, worldRect: Rect): boolean {
  const minX = (-cam.pan[0] - 0) / cam.zoom;
  const minY = (-cam.pan[1] - 0) / cam.zoom;
  const maxX = (viewport.width - cam.pan[0]) / cam.zoom;
  const maxY = (viewport.height - cam.pan[1]) / cam.zoom;
  return (
    worldRect.x >= minX &&
    worldRect.y >= minY &&
    worldRect.x + worldRect.w <= maxX &&
    worldRect.y + worldRect.h <= maxY
  );
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
export function centerBoundsCamera(
  worldRect: Rect,
  viewport: Viewport,
  zoom: number,
): Camera {
  const cx = worldRect.x + worldRect.w / 2;
  const cy = worldRect.y + worldRect.h / 2;
  return {
    pan: [viewport.width / 2 - cx * zoom, viewport.height / 2 - cy * zoom],
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
 */
export function revealBoundsCamera(
  cam: Camera,
  viewport: Viewport,
  worldRect: Rect,
  padding: number = DEFAULT_REVEAL_PADDING,
): Camera {
  // World-space viewport bounds.
  const viewMinX = -cam.pan[0] / cam.zoom;
  const viewMinY = -cam.pan[1] / cam.zoom;
  const viewMaxX = (viewport.width - cam.pan[0]) / cam.zoom;
  const viewMaxY = (viewport.height - cam.pan[1]) / cam.zoom;
  const pad = padding / cam.zoom; // padding in world units

  const rectMinX = worldRect.x;
  const rectMinY = worldRect.y;
  const rectMaxX = worldRect.x + worldRect.w;
  const rectMaxY = worldRect.y + worldRect.h;

  // No shift needed if rect is already in view (with padding).
  if (
    rectMinX >= viewMinX + pad &&
    rectMinY >= viewMinY + pad &&
    rectMaxX <= viewMaxX - pad &&
    rectMaxY <= viewMaxY - pad
  ) {
    return cam;
  }

  // Compute world-space deltas. For each axis:
  // - If rect is smaller than viewport-inner, snap the nearer edge to padding.
  // - If rect is larger, align the rect's near edge (top or left) to padding.
  let dxWorld = 0;
  let dyWorld = 0;

  // X axis.
  const fitsX = worldRect.w <= (viewMaxX - viewMinX) - 2 * pad;
  if (fitsX) {
    if (rectMinX < viewMinX + pad) {
      dxWorld = rectMinX - (viewMinX + pad); // shift left edge into view
    } else if (rectMaxX > viewMaxX - pad) {
      dxWorld = rectMaxX - (viewMaxX - pad); // shift right edge into view
    }
  } else if (rectMinX < viewMinX + pad) {
    dxWorld = rectMinX - (viewMinX + pad);
  } else if (rectMaxX > viewMaxX - pad) {
    dxWorld = rectMaxX - (viewMaxX - pad);
  }

  // Y axis.
  const fitsY = worldRect.h <= (viewMaxY - viewMinY) - 2 * pad;
  if (fitsY) {
    if (rectMinY < viewMinY + pad) {
      dyWorld = rectMinY - (viewMinY + pad);
    } else if (rectMaxY > viewMaxY - pad) {
      dyWorld = rectMaxY - (viewMaxY - pad);
    }
  } else if (rectMinY < viewMinY + pad) {
    dyWorld = rectMinY - (viewMinY + pad);
  } else if (rectMaxY > viewMaxY - pad) {
    dyWorld = rectMaxY - (viewMaxY - pad);
  }

  if (dxWorld === 0 && dyWorld === 0) return cam;

  // Pan shift in CSS px (world delta × zoom).
  return {
    pan: [cam.pan[0] + dxWorld * cam.zoom, cam.pan[1] + dyWorld * cam.zoom],
    zoom: cam.zoom,
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
  const screenX = wx * cam.zoom + cam.pan[0];
  const screenY = wy * cam.zoom + cam.pan[1];
  return {
    pan: [screenX - wx * z, screenY - wy * z],
    zoom: z,
  };
}

/**
 * Transform a local-space rect to a screen-space rect by composing
 * `local→world` (the node's world matrix) with the camera. Used by overlays.
 */
export function localRectToScreen(
  worldMatrix: Affine,
  cam: Camera,
  localRect: Rect,
): Rect {
  return transformRect(worldToScreenAffine(cam), transformRect(worldMatrix, localRect));
}

/** Apply a CSS-pixel rotation about the screen-space anchor to a camera. */
export function rotateAboutScreenPoint(
  _cam: Camera,
  _screenAnchor: Point,
  _radians: number,
): Camera {
  // Camera rotation is not supported in the current viewport model — the
  // canvas only supports pan + zoom. This stub exists so future artboard
  // rotation can be added without reshaping the API. For now it is a no-op.
  void rotateRad;
  return _cam;
}
