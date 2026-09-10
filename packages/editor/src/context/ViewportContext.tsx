import type { NodeId } from '@varve/scene';
import {
  type Camera,
  centerBoundsCameraWithRotation,
  clampZoom,
  fitBoundsCameraWithRotation,
  revealBoundsCameraWithRotation,
  screenDeltaToWorld,
  type Viewport,
} from '@varve/shared';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { editorScreenToWorld, editorWorldToScreen, getEditorViewport } from '../canvas/cameraState';
import { activeSurfaceRootIds, resolveNavigationBounds } from '../navigation/navigationBounds';
import { isReducedMotion, subscribeReducedMotion } from './reducedMotionManager';
import type { CanvasMode, EditorState } from './types';
import {
  animateCameraTo,
  cancelCameraTransition,
  computeZoomStep,
  computeZoomTo,
  getCanvasViewport,
} from './viewportOps';

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
    behavior?: 'reveal' | 'center' | 'fit';
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

  const setZoom = useCallback(
    (z: number) => {
      // Anchor around the viewport center so the point under the canvas
      // center stays put — identical to `useEditor().setZoom` (both go
      // through `computeZoomTo`). A plain `clampZoom` patch would diverge.
      cancelCameraTransition(animRef);
      const s = stateRef.current;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      patch(computeZoomTo(camState, z, getEditorViewport()));
    },
    [patch, stateRef, animRef],
  );

  const setCamera = useCallback(
    (camera: Camera) => {
      cancelCameraTransition(animRef);
      patch({
        zoom: clampZoom(camera.zoom),
        pan: { x: camera.pan.x, y: camera.pan.y },
        cameraRotation: camera.rotation ?? stateRef.current.cameraRotation,
      });
    },
    [patch, stateRef, animRef],
  );

  const setPan = useCallback(
    (p: { x: number; y: number }) => {
      cancelCameraTransition(animRef);
      patch({ pan: { x: p.x, y: p.y } });
    },
    [patch, animRef],
  );

  const zoomIn = useCallback(() => {
    cancelCameraTransition(animRef);
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    patch(computeZoomStep(camState, 'in', getEditorViewport()));
  }, [patch, stateRef, animRef]);

  const zoomOut = useCallback(() => {
    cancelCameraTransition(animRef);
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    patch(computeZoomStep(camState, 'out', getEditorViewport()));
  }, [patch, stateRef, animRef]);

  const zoomTo = useCallback(
    (level: number) => {
      cancelCameraTransition(animRef);
      const s = stateRef.current;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      patch(computeZoomTo(camState, level, getEditorViewport()));
    },
    [patch, stateRef, animRef],
  );

  const smoothZoomTo = useCallback(
    (targetZoom: number, durationMs = 200) => {
      const s = stateRef.current;
      const clamped = clampZoom(targetZoom);
      const startCam: Camera = { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation };
      const endCam: Camera = { zoom: clamped, pan: s.pan, rotation: s.cameraRotation };
      animateCameraTo(animRef, startCam, endCam, durationMs, rmRef.current, (camera) =>
        patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 }),
      );
    },
    [patch, stateRef, animRef],
  );

  const smoothPanTo = useCallback(
    (target: { x: number; y: number }, durationMs = 200) => {
      const s = stateRef.current;
      const startCam: Camera = { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation };
      const endCam: Camera = { zoom: s.zoom, pan: target, rotation: s.cameraRotation };
      animateCameraTo(animRef, startCam, endCam, durationMs, rmRef.current, (camera) =>
        patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 }),
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
      const vp = getCanvasViewport();
      const start: Camera = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
      const target = revealBoundsCameraWithRotation(start, vp, bounds, opts?.padding ?? 40);
      animateCameraTo(animRef, start, target, opts?.durationMs ?? 300, rmRef.current, (camera) =>
        patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 }),
      );
    },
    [stateRef, patch, animRef],
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
    (opts?: {
      nodeId?: NodeId;
      fit?: boolean;
      behavior?: 'reveal' | 'center' | 'fit';
      padding?: number;
      viewport?: Viewport;
    }) => {
      const s = stateRef.current;
      const nodeIds = opts?.nodeId ? [opts.nodeId] : s.selection;
      const resolved = resolveNavigationBounds(s.document, nodeIds, {
        activeSurfaceRootIds: activeSurfaceRootIds(s.document, s.workspaceMode),
      });
      if (!resolved.bounds) return;
      const vp = opts?.viewport ?? getCanvasViewport();
      const start: Camera = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
      const padding = opts?.padding ?? 40;
      const behavior = opts?.behavior ?? (opts?.fit ? 'fit' : 'reveal');
      const target =
        behavior === 'fit'
          ? fitBoundsCameraWithRotation(resolved.bounds, vp, s.cameraRotation, padding)
          : behavior === 'center'
            ? centerBoundsCameraWithRotation(resolved.bounds, vp, s.zoom, s.cameraRotation)
            : revealBoundsCameraWithRotation(start, vp, resolved.bounds, padding);
      if (target.zoom === s.zoom && target.pan.x === s.pan.x && target.pan.y === s.pan.y) return;
      animateCameraTo(
        animRef,
        start,
        target,
        behavior === 'fit' ? 300 : 250,
        rmRef.current,
        (camera) =>
          patch({ zoom: camera.zoom, pan: camera.pan, cameraRotation: camera.rotation ?? 0 }),
      );
    },
    [stateRef, patch, animRef],
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
