/** Canvas backing-store sizing and display-scale lifecycle helpers. */

import type { Camera, Viewport } from '@varve/shared';
import { computeFloatingOrigin, screenToWorld, worldToScreen } from '@varve/shared';
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';

export interface CanvasGeometry {
  left: number;
  top: number;
  /** Drawable CSS pixels, matching the dimensions used by the renderer. */
  width: number;
  height: number;
}

export interface CanvasViewportAnchor {
  clientX: number;
  clientY: number;
}

export interface CanvasGeometryState {
  canvasSize: { width: number; height: number };
  canvasRectRef: MutableRefObject<{ left: number; top: number }>;
  viewportAnchorRef: MutableRefObject<CanvasViewportAnchor | null>;
  refreshCanvasRect: () => void;
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** Read both the canvas position and its drawable CSS size in one layout pass. */
export function readCanvasGeometry(canvas: HTMLElement): CanvasGeometry {
  const rect = canvas.getBoundingClientRect();
  return {
    left: finiteOrZero(rect.left),
    top: finiteOrZero(rect.top),
    width: Math.max(0, finiteOrZero(canvas.clientWidth || rect.width)),
    height: Math.max(0, finiteOrZero(canvas.clientHeight || rect.height)),
  };
}

function sameCanvasGeometry(a: CanvasGeometry, b: CanvasGeometry): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

function validViewport(viewport: Viewport): boolean {
  return viewport.width > 0 && viewport.height > 0;
}

/**
 * Resize a camera without changing the world point under the active anchor.
 *
 * The anchor is expressed in browser client CSS pixels. When it is omitted,
 * the old and new drawable viewport centres are used. This keeps a manually
 * positioned camera stable through panel/window changes, including rotated
 * views, without touching document state or history.
 */
export function preserveCameraAnchorOnResize(
  camera: Camera,
  previous: CanvasGeometry,
  next: CanvasGeometry,
  anchor?: CanvasViewportAnchor | null,
): Camera {
  const previousViewport: Viewport = { width: previous.width, height: previous.height };
  const nextViewport: Viewport = { width: next.width, height: next.height };
  if (!validViewport(previousViewport) || !validViewport(nextViewport)) return camera;

  const previousClientAnchor = anchor ?? {
    clientX: previous.left + previous.width / 2,
    clientY: previous.top + previous.height / 2,
  };
  const previousLocalX = previousClientAnchor.clientX - previous.left;
  const previousLocalY = previousClientAnchor.clientY - previous.top;
  const previousOrigin = computeFloatingOrigin(camera, previousViewport);
  const worldAnchor = screenToWorld(
    camera,
    previousLocalX,
    previousLocalY,
    previousViewport,
    previousOrigin,
  );

  const nextClientAnchor = anchor ?? {
    clientX: next.left + next.width / 2,
    clientY: next.top + next.height / 2,
  };
  const nextLocalX = nextClientAnchor.clientX - next.left;
  const nextLocalY = nextClientAnchor.clientY - next.top;
  const cameraWithoutPan: Camera = { ...camera, pan: { x: 0, y: 0 } };
  const nextOrigin = computeFloatingOrigin(cameraWithoutPan, nextViewport);
  const projected = worldToScreen(
    cameraWithoutPan,
    worldAnchor[0],
    worldAnchor[1],
    nextViewport,
    nextOrigin,
  );
  return {
    ...camera,
    pan: { x: nextLocalX - projected[0], y: nextLocalY - projected[1] },
  };
}

export interface CanvasCameraState {
  pan: { x: number; y: number };
  zoom: number;
  cameraRotation: number;
}

/** Commit an anchor-preserving resize into an editor-like camera state ref. */
export function commitCameraAnchorOnResize<State extends CanvasCameraState>(
  stateRef: MutableRefObject<State>,
  commitCamera: (camera: Camera) => void,
  previous: CanvasGeometry,
  next: CanvasGeometry,
  anchor: CanvasViewportAnchor | null,
): void {
  const current = stateRef.current;
  const adjusted = preserveCameraAnchorOnResize(
    { pan: current.pan, zoom: current.zoom, rotation: current.cameraRotation },
    previous,
    next,
    anchor,
  );
  if (
    adjusted.pan.x === current.pan.x &&
    adjusted.pan.y === current.pan.y &&
    (adjusted.rotation ?? 0) === current.cameraRotation
  ) {
    return;
  }
  stateRef.current = {
    ...current,
    pan: adjusted.pan,
    zoom: adjusted.zoom,
    cameraRotation: adjusted.rotation ?? current.cameraRotation,
  };
  commitCamera(adjusted);
}

/**
 * Observe drawable size and position without reading layout on every pointer
 * sample. ResizeObserver covers size; captured scroll, viewport resize, and a
 * synchronous input-boundary refresh cover position-only layout movement.
 */
export function subscribeToCanvasGeometry(
  canvas: HTMLElement,
  onChange: (geometry: CanvasGeometry) => void,
): () => void {
  const ownerWindow = canvas.ownerDocument.defaultView;
  let previous: CanvasGeometry | null = null;
  let frame: number | null = null;
  let frameIsTimeout = false;

  const emit = (): void => {
    frame = null;
    const next = readCanvasGeometry(canvas);
    if (previous && sameCanvasGeometry(previous, next)) return;
    previous = next;
    onChange(next);
  };

  const schedule = (): void => {
    if (frame !== null) return;
    if (ownerWindow?.requestAnimationFrame) {
      frameIsTimeout = false;
      frame = ownerWindow.requestAnimationFrame(emit);
    } else if (ownerWindow) {
      frameIsTimeout = true;
      frame = ownerWindow.setTimeout(emit, 0);
    } else {
      emit();
    }
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resizeObserver?.observe(canvas);
  if (canvas.parentElement && canvas.parentElement !== canvas) {
    resizeObserver?.observe(canvas.parentElement);
  }

  const onViewportChange = (): void => schedule();
  ownerWindow?.addEventListener('resize', onViewportChange, { passive: true });
  ownerWindow?.addEventListener('scroll', onViewportChange, { capture: true, passive: true });
  ownerWindow?.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
  ownerWindow?.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });

  emit();

  return () => {
    resizeObserver?.disconnect();
    ownerWindow?.removeEventListener('resize', onViewportChange);
    ownerWindow?.removeEventListener('scroll', onViewportChange, true);
    ownerWindow?.visualViewport?.removeEventListener('resize', onViewportChange);
    ownerWindow?.visualViewport?.removeEventListener('scroll', onViewportChange);
    if (frame !== null) {
      if (frameIsTimeout) ownerWindow?.clearTimeout(frame);
      else ownerWindow?.cancelAnimationFrame(frame);
      frame = null;
    }
  };
}

/** React lifecycle wrapper for the shared canvas geometry contract. */
export function useCanvasGeometry(
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  onGeometryChange?: (
    previous: CanvasGeometry,
    next: CanvasGeometry,
    anchor: CanvasViewportAnchor | null,
  ) => void,
): CanvasGeometryState {
  const canvasRectRef = useRef({ left: 0, top: 0 });
  const viewportAnchorRef = useRef<CanvasViewportAnchor | null>(null);
  const canvasGeometryRef = useRef<CanvasGeometry | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const applyCanvasGeometry = useCallback(
    (geometry: CanvasGeometry) => {
      const previous = canvasGeometryRef.current;
      if (previous && previous.width > 0 && previous.height > 0) {
        onGeometryChange?.(previous, geometry, viewportAnchorRef.current);
      }
      canvasGeometryRef.current = geometry;
      canvasRectRef.current = { left: geometry.left, top: geometry.top };
      setCanvasSize((previousSize) => {
        if (previousSize.width === geometry.width && previousSize.height === geometry.height) {
          return previousSize;
        }
        return { width: geometry.width, height: geometry.height };
      });
    },
    [onGeometryChange],
  );

  const refreshCanvasRect = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) applyCanvasGeometry(readCanvasGeometry(canvas));
  }, [applyCanvasGeometry, canvasRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return subscribeToCanvasGeometry(canvas, applyCanvasGeometry);
  }, [applyCanvasGeometry, canvasRef]);

  return { canvasSize, canvasRectRef, viewportAnchorRef, refreshCanvasRect };
}

export function canvasBackingSize(cssSize: number, dpr: number): number {
  if (!Number.isFinite(cssSize) || !Number.isFinite(dpr) || cssSize <= 0 || dpr <= 0) return 0;
  return Math.max(1, Math.round(cssSize * dpr));
}

export function resizeCanvasBackingStore(
  canvas: Pick<HTMLCanvasElement, 'width' | 'height'>,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): boolean {
  const width = canvasBackingSize(cssWidth, dpr);
  const height = canvasBackingSize(cssHeight, dpr);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

export function subscribeToDevicePixelRatio(
  onChange: (dpr: number) => void,
  target: Window = window,
): () => void {
  let query: MediaQueryList | null = null;
  const createQuery = target.matchMedia?.bind(target);
  const handleChange = (): void => {
    query?.removeEventListener('change', handleChange);
    const dpr = target.devicePixelRatio || 1;
    query = createQuery?.(`(resolution: ${dpr}dppx)`) ?? null;
    query?.addEventListener('change', handleChange);
    onChange(dpr);
  };
  target.addEventListener('resize', handleChange);
  handleChange();
  return () => {
    target.removeEventListener('resize', handleChange);
    query?.removeEventListener('change', handleChange);
  };
}

export function subscribeToCanvasContextLifecycle(
  canvas: HTMLCanvasElement,
  handlers: { onLost: () => void; onRestored: () => void },
): () => void {
  const onLost = (event: Event): void => {
    event.preventDefault();
    handlers.onLost();
  };
  const onRestored = (): void => handlers.onRestored();
  canvas.addEventListener('contextlost', onLost);
  canvas.addEventListener('contextrestored', onRestored);
  return () => {
    canvas.removeEventListener('contextlost', onLost);
    canvas.removeEventListener('contextrestored', onRestored);
  };
}
