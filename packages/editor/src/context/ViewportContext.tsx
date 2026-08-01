import type { NodeId, SceneNode } from '@strata/scene';
import {
  animateCamera,
  type Camera,
  clampZoom,
  fitBoundsCamera,
  revealBoundsCamera,
  screenDeltaToWorld,
  type Viewport,
} from '@strata/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { editorScreenToWorld, editorWorldToScreen, getEditorViewport } from '../canvas/cameraState';
import { isReducedMotion, subscribeReducedMotion } from './reducedMotionManager';
import type { CanvasMode, EditorState } from './types';
import { computeZoomStep, computeZoomTo } from './viewportOps';

export interface ViewportContextValue {
  zoom: number;
  pan: { x: number; y: number };
  canvasMode: CanvasMode;
  setCamera: (camera: Camera) => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomTo: (level: number) => void;
  smoothZoomTo: (targetZoom: number, durationMs?: number) => void;
  smoothPanTo: (target: { x: number; y: number }, durationMs?: number) => void;
  smoothReveal: (
    bounds: { x: number; y: number; w: number; h: number },
    opts?: { padding?: number; durationMs?: number },
  ) => void;
  setCanvasMode: (mode: CanvasMode) => void;
  canvasToWorld: (cx: number, cy: number) => { x: number; y: number };
  worldToCanvas: (wx: number, wy: number) => { x: number; y: number };
  canvasDeltaToWorld: (dx: number, dy: number) => { dx: number; dy: number };
  revealSelection: (opts?: {
    nodeId?: NodeId;
    fit?: boolean;
    padding?: number;
    viewport?: Viewport;
  }) => void;
  fitAll: () => void;
}

const ViewportCtx = createContext<ViewportContextValue | null>(null);

export function useViewport(): ViewportContextValue {
  const ctx = useContext(ViewportCtx);
  if (!ctx) throw new Error('useViewport must be used within EditorProvider');
  return ctx;
}

interface ViewportProviderProps {
  children: ReactNode;
  state: EditorState;
  setState: React.Dispatch<React.SetStateAction<EditorState>>;
  stateRef: React.MutableRefObject<EditorState>;
  panAnimationRef?: React.MutableRefObject<number | null>;
}

export function ViewportProvider({
  children,
  state,
  setState,
  stateRef,
  panAnimationRef,
}: ViewportProviderProps) {
  // `useRef` always returns the same object across renders, unlike a
  // `?? { current: null }` fallback literal, which allocates a fresh object
  // every render whenever the caller doesn't pass `panAnimationRef` — that
  // was silently defeating every `useCallback` (and, transitively, this
  // provider's own context value memo) that depended on `animRef`. See
  // docs/quality/editorprovider-surface.md for how this was found.
  const internalAnimRef = useRef<number | null>(null);
  const animRef = panAnimationRef ?? internalAnimRef;
  const rmRef = useRef(isReducedMotion());

  useEffect(() => {
    const unsub = subscribeReducedMotion((v) => {
      rmRef.current = v;
    });
    return unsub;
  }, []);

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const setZoom = useCallback((z: number) => patch({ zoom: clampZoom(z) }), [patch]);

  const setCamera = useCallback(
    (camera: Camera) =>
      patch({
        zoom: clampZoom(camera.zoom),
        pan: { x: camera.pan.x, y: camera.pan.y },
        cameraRotation: camera.rotation ?? stateRef.current.cameraRotation,
      }),
    [patch, stateRef],
  );

  const setPan = useCallback(
    (p: { x: number; y: number }) => patch({ pan: { x: p.x, y: p.y } }),
    [patch],
  );

  const zoomIn = useCallback(() => {
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    patch(computeZoomStep(camState, 'in', getEditorViewport()));
  }, [patch, stateRef]);

  const zoomOut = useCallback(() => {
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    patch(computeZoomStep(camState, 'out', getEditorViewport()));
  }, [patch, stateRef]);

  const zoomTo = useCallback(
    (level: number) => {
      const s = stateRef.current;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      patch(computeZoomTo(camState, level, getEditorViewport()));
    },
    [patch, stateRef],
  );

  const smoothZoomTo = useCallback(
    (targetZoom: number, durationMs = 200) => {
      const s = stateRef.current;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      const clamped = clampZoom(targetZoom);
      // Reduced motion: jump instantly, no animation.
      if (rmRef.current) {
        patch({ zoom: clamped });
        return;
      }
      const startCam = { zoom: s.zoom, pan: s.pan };
      const endCam = { zoom: clamped, pan: s.pan };
      const startTime = performance.now();
      const frame = () => {
        const elapsed = performance.now() - startTime;
        const result = animateCamera(startCam, endCam, elapsed, durationMs);
        patch({ zoom: result.camera.zoom, pan: result.camera.pan });
        if (!result.done) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          animRef.current = null;
        }
      };
      animRef.current = requestAnimationFrame(frame);
    },
    [patch, stateRef, animRef],
  );

  const smoothPanTo = useCallback(
    (target: { x: number; y: number }, durationMs = 200) => {
      const s = stateRef.current;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      // Reduced motion: jump instantly, no animation.
      if (rmRef.current) {
        patch({ pan: { x: target.x, y: target.y } });
        return;
      }
      const startCam = { zoom: s.zoom, pan: s.pan };
      const endCam = { zoom: s.zoom, pan: target };
      const startTime = performance.now();
      const frame = () => {
        const elapsed = performance.now() - startTime;
        const result = animateCamera(startCam, endCam, elapsed, durationMs);
        patch({ zoom: result.camera.zoom, pan: result.camera.pan });
        if (!result.done) {
          animRef.current = requestAnimationFrame(frame);
        } else {
          animRef.current = null;
        }
      };
      animRef.current = requestAnimationFrame(frame);
    },
    [patch, stateRef, animRef],
  );

  const smoothReveal = useCallback(
    (
      bounds: { x: number; y: number; w: number; h: number },
      opts?: { padding?: number; durationMs?: number },
    ) => {
      const s = stateRef.current;
      const vp = { width: window.innerWidth, height: window.innerHeight };
      const target = revealBoundsCamera(s, vp, bounds, opts?.padding ?? 40);
      smoothZoomTo(target.zoom, opts?.durationMs ?? 300);
      smoothPanTo(target.pan, opts?.durationMs ?? 300);
    },
    [stateRef, smoothZoomTo, smoothPanTo],
  );

  const setCanvasMode = useCallback((mode: CanvasMode) => patch({ canvasMode: mode }), [patch]);

  const canvasToWorld = useCallback(
    (cx: number, cy: number) => {
      const pt = editorScreenToWorld(
        { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
        cx,
        cy,
        getEditorViewport(),
      );
      return { x: pt[0], y: pt[1] };
    },
    [state.pan, state.zoom, state.cameraRotation],
  );

  const worldToCanvas = useCallback(
    (wx: number, wy: number) => {
      // Must go through the floating-origin-aware transform
      // (editorWorldToScreen) that the canvas actually paints with — a naive
      // world*zoom+pan drifts from the real paint position once panned away
      // from world (0,0). See packages/editor/src/canvas/cameraState.ts.
      const pt = editorWorldToScreen(
        { zoom: state.zoom, pan: state.pan, cameraRotation: state.cameraRotation },
        wx,
        wy,
        getEditorViewport(),
      );
      return { x: pt[0], y: pt[1] };
    },
    [state.pan, state.zoom, state.cameraRotation],
  );

  const canvasDeltaToWorld = useCallback(
    (dx: number, dy: number) => {
      const [wdx, wdy] = screenDeltaToWorld(
        { pan: state.pan, zoom: state.zoom, rotation: state.cameraRotation },
        dx,
        dy,
      );
      return { dx: wdx, dy: wdy };
    },
    [state.zoom, state.cameraRotation, state.pan],
  );

  const revealSelection = useCallback(
    (opts?: { nodeId?: NodeId; fit?: boolean; padding?: number; viewport?: Viewport }) => {
      const s = stateRef.current;
      const vp = opts?.viewport ?? { width: window.innerWidth, height: window.innerHeight };
      const padding = opts?.padding ?? 40;

      if (opts?.nodeId) {
        const n = s.document.nodes[opts.nodeId];
        if (!n) return;
        const b = nodeWorldBoundsInner(n);
        if (!b) return;
        const target = opts?.fit
          ? fitBoundsCamera(b, vp, padding)
          : revealBoundsCamera(s, vp, b, padding);
        smoothZoomTo(target.zoom, opts?.fit ? 300 : 250);
        smoothPanTo(target.pan, opts?.fit ? 300 : 250);
      } else if (opts?.fit) {
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        const entries = Object.values(s.document.nodes);
        if (entries.length === 0) return;
        for (const n of entries) {
          if (!n) continue;
          const b = nodeWorldBoundsInner(n);
          if (!b) continue;
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
        const target = fitBoundsCamera(
          { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
          vp,
          padding,
        );
        smoothZoomTo(target.zoom, 300);
        smoothPanTo(target.pan, 300);
      } else {
        const sel = s.selection;
        if (sel.length === 0) return;
        let minX = Infinity,
          minY = Infinity,
          maxX = -Infinity,
          maxY = -Infinity;
        for (const id of sel) {
          const n = s.document.nodes[id];
          if (!n) continue;
          const b = nodeWorldBoundsInner(n);
          if (!b) continue;
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.w);
          maxY = Math.max(maxY, b.y + b.h);
        }
        const target = revealBoundsCamera(
          s,
          vp,
          { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
          padding,
        );
        smoothZoomTo(target.zoom, 250);
        smoothPanTo(target.pan, 250);
      }
    },
    [stateRef, smoothZoomTo, smoothPanTo],
  );

  const fitAll = useCallback(() => revealSelection({ fit: true }), [revealSelection]);

  const value = useMemo<ViewportContextValue>(
    () => ({
      zoom: state.zoom,
      pan: state.pan,
      canvasMode: state.canvasMode,
      setCamera,
      setZoom,
      setPan,
      zoomIn,
      zoomOut,
      zoomTo,
      smoothZoomTo,
      smoothPanTo,
      smoothReveal,
      setCanvasMode,
      canvasToWorld,
      worldToCanvas,
      canvasDeltaToWorld,
      revealSelection,
      fitAll,
    }),
    [
      state.zoom,
      state.pan,
      state.canvasMode,
      setCamera,
      setZoom,
      setPan,
      zoomIn,
      zoomOut,
      zoomTo,
      smoothZoomTo,
      smoothPanTo,
      smoothReveal,
      setCanvasMode,
      canvasToWorld,
      worldToCanvas,
      canvasDeltaToWorld,
      revealSelection,
      fitAll,
    ],
  );

  return <ViewportCtx.Provider value={value}>{children}</ViewportCtx.Provider>;
}

function nodeWorldBoundsInner(n: SceneNode): { x: number; y: number; w: number; h: number } | null {
  const tx = n.transform[4] ?? 0;
  const ty = n.transform[5] ?? 0;
  if (n.kind === 'shape') {
    const s = (n as import('@strata/scene').ShapeNode).shape;
    if (s.kind === 'rect') return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
    if (s.kind === 'ellipse')
      return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle')
      return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
    if (s.kind === 'line') {
      const minX = Math.min(s.from[0], s.to[0]);
      const maxX = Math.max(s.from[0], s.to[0]);
      const minY = Math.min(s.from[1], s.to[1]);
      const maxY = Math.max(s.from[1], s.to[1]);
      return { x: tx + minX, y: ty + minY, w: maxX - minX || 1, h: maxY - minY || 1 };
    }
  }
  if (n.kind === 'frame') {
    const f = n as import('@strata/scene').FrameNode;
    return { x: tx, y: ty, w: f.w ?? 200, h: f.h ?? 160 };
  }
  if (n.kind === 'group') {
    return null;
  }
  return null;
}
