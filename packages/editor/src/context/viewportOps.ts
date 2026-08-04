/**
 * Shared zoom math for `EditorProvider`'s `value` and `ViewportContext` —
 * both used to reimplement `zoomIn`/`zoomOut`/`zoomTo` independently, and
 * had silently diverged: `EditorProvider` anchored the zoom around the
 * actual canvas center, `ViewportContext` did a naive `zoom * 1.25` with no
 * anchor point, so `useEditor().zoomIn()` and `useViewport().zoomIn()`
 * produced visibly different results. This module is the single
 * implementation both now delegate to.
 */
import type { Document } from '@varve/scene';
import { buildParentIndexMap, walkNodes } from '@varve/scene';
import { clampZoom, fitBoundsCamera, stepZoom, type Viewport, zoomAboutPoint } from '@varve/shared';
import {
  cameraPatch,
  type EditorCameraState,
  editorScreenToWorld,
  toCamera,
} from '../canvas/cameraState';
import { nodeWorldBounds } from '../scene/world';

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

/**
 * The canvas's own rendered size — narrower than the full window whenever
 * the layers/inspector side panels are open. Centering math that uses
 * `window.innerWidth` instead visibly off-centers the result by roughly
 * half the panel width, since `pan` is resolved against the canvas
 * element's own local coordinate space, not page-absolute screen space.
 * Falls back to a window-based estimate only when no canvas is mounted yet.
 */
export function getCanvasViewport(): Viewport {
  const canvasEl =
    typeof document !== 'undefined' ? document.querySelector<HTMLElement>('.editor-canvas') : null;
  if (canvasEl) return { width: canvasEl.clientWidth, height: canvasEl.clientHeight };
  return {
    width: typeof window !== 'undefined' ? window.innerWidth : 1200,
    height: typeof window !== 'undefined' ? window.innerHeight - 120 : 700,
  };
}

/**
 * Compute a camera (zoom/pan) that frames every node in `doc` across all
 * pages, or `null` for a genuinely empty document (caller should fall back
 * to a default camera in that case). Shared by the "Fit all" action and by
 * document-open, so a freshly opened file whose content lives far from
 * world origin doesn't default to a camera that's nowhere near it.
 */
export function computeFitAllCamera(
  doc: Document,
  viewport: Viewport,
): { zoom: number; pan: { x: number; y: number } } | null {
  const entries = walkNodes(doc);
  // nodeWorldBounds falls back to an O(n) linear scan (getParent) for every
  // node's ancestor-chain lookup when no parentIndex is passed. Called once
  // per node here, that made document-open O(n^2) in node count -- 20,000
  // flat nodes pegged a CPU core for 10+ minutes without finishing.
  // buildParentIndexMap is a single O(n) pass; reusing it below makes the
  // whole loop O(n).
  const parentIndex = buildParentIndexMap(doc);
  let union: { x: number; y: number; w: number; h: number } | null = null;
  for (const [id] of entries) {
    const b = nodeWorldBounds(doc, id, parentIndex);
    if (!b) continue;
    if (!union) {
      union = { ...b };
      continue;
    }
    const minX = Math.min(union.x, b.x);
    const minY = Math.min(union.y, b.y);
    const maxX = Math.max(union.x + union.w, b.x + b.w);
    const maxY = Math.max(union.y + union.h, b.y + b.h);
    union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (!union) return null;
  return fitBoundsCamera(union, viewport, 40);
}
