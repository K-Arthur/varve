import type { NodeId, SceneNode } from '@strata/scene';
import {
  animateCamera,
  clampZoom,
  fitBoundsCamera,
  revealBoundsCamera,
  screenToWorld,
  type Viewport,
  zoomAboutPoint,
} from '@strata/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo } from 'react';
import type { CanvasMode, EditorState } from './types';

export interface ViewportContextValue {
  zoom: number;
  pan: { x: number; y: number };
  canvasMode: CanvasMode;
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
  const animRef = panAnimationRef ?? { current: null };

  const patch = useCallback(
    (partial: Partial<EditorState>) => setState((s) => ({ ...s, ...partial })),
    [setState],
  );

  const setZoom = useCallback((z: number) => patch({ zoom: clampZoom(z) }), [patch]);

  const setPan = useCallback(
    (p: { x: number; y: number }) => patch({ pan: { x: p.x, y: p.y } }),
    [patch],
  );

  const zoomIn = useCallback(
    () => patch((s: EditorState) => ({ zoom: clampZoom(s.zoom * 1.25) })),
    [patch],
  );

  const zoomOut = useCallback(
    () => patch((s: EditorState) => ({ zoom: clampZoom(s.zoom / 1.25) })),
    [patch],
  );

  const zoomTo = useCallback((level: number) => patch({ zoom: clampZoom(level) }), [patch]);

  const smoothZoomTo = useCallback(
    (targetZoom: number, durationMs = 200) => {
      const s = stateRef.current;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      const toZoom = clampZoom(targetZoom);
      animateCamera(
        { zoom: s.zoom, pan: s.pan },
        { zoom: toZoom, pan: s.pan },
        durationMs,
        (camera) => patch({ zoom: camera.zoom, pan: camera.pan }),
        (id) => {
          animRef.current = id;
        },
      );
    },
    [patch, stateRef, animRef],
  );

  const smoothPanTo = useCallback(
    (target: { x: number; y: number }, durationMs = 200) => {
      const s = stateRef.current;
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      animateCamera(
        { zoom: s.zoom, pan: s.pan },
        { zoom: s.zoom, pan: target },
        durationMs,
        (camera) => patch({ zoom: camera.zoom, pan: camera.pan }),
        (id) => {
          animRef.current = id;
        },
      );
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
    (cx: number, cy: number) => screenToWorld({ pan: state.pan, zoom: state.zoom }, cx, cy),
    [state.pan, state.zoom],
  );

  const worldToCanvas = useCallback(
    (wx: number, wy: number) => {
      const cam = { pan: state.pan, zoom: state.zoom };
      return {
        x: (wx - cam.pan.x) * cam.zoom,
        y: (wy - cam.pan.y) * cam.zoom,
      };
    },
    [state.pan, state.zoom],
  );

  const canvasDeltaToWorld = useCallback(
    (dx: number, dy: number) => ({ dx: dx / state.zoom, dy: dy / state.zoom }),
    [state.zoom],
  );

  const revealSelection = useCallback(
    (opts?: { nodeId?: NodeId; fit?: boolean; padding?: number; viewport?: Viewport }) => {
      const s = stateRef.current;
      const vp = opts?.viewport ?? { width: window.innerWidth, height: window.innerHeight };
      const padding = opts?.padding ?? 40;

      if (opts?.fit) {
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
          s,
          vp,
          { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
          padding,
        );
        smoothZoomTo(target.zoom, 300);
        smoothPanTo(target.pan, 300);
      } else if (opts?.nodeId) {
        const n = s.document.nodes[opts.nodeId];
        if (!n) return;
        const b = nodeWorldBoundsInner(n);
        if (!b) return;
        const target = revealBoundsCamera(s, vp, b, padding);
        smoothZoomTo(target.zoom, 250);
        smoothPanTo(target.pan, 250);
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
