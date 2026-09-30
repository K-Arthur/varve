import type { Document, NodeId } from '@varve/scene';
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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
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
  cameraRotation: number;
  canvasMode: CanvasMode;
  /** Transient, non-document transform preview used during selection drags. */
  transformPreviewStore: TransformPreviewStore;
  /** Publish a camera preview without waking document and inspector consumers. */
  previewCamera: (camera: Camera) => void;
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

export interface TransformPreviewSnapshot {
  /** Committed base document that owns this temporary preview. */
  baseDocument: Document;
  /** Immutable render-only document with the current drag transforms. */
  document: Document;
  /** Node transforms changed since the committed base document. */
  changedNodeIds: readonly NodeId[];
  revision: number;
}

export interface TransformPreviewStore {
  getSnapshot: () => TransformPreviewSnapshot | null;
  subscribe: (listener: () => void) => () => void;
  preview: (
    baseDocument: Document,
    document: Document,
    changedNodeIds: readonly NodeId[],
  ) => TransformPreviewSnapshot;
  clear: () => void;
}

class CanvasTransformPreviewStore implements TransformPreviewStore {
  private snapshot: TransformPreviewSnapshot | null = null;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): TransformPreviewSnapshot | null => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  preview = (
    baseDocument: Document,
    document: Document,
    changedNodeIds: readonly NodeId[],
  ): TransformPreviewSnapshot => {
    if (this.snapshot?.baseDocument === baseDocument && this.snapshot.document === document) {
      return this.snapshot;
    }
    this.snapshot = { baseDocument, document, changedNodeIds, revision: ++this.revision };
    this.publish();
    return this.snapshot;
  };

  clear = (): void => {
    if (!this.snapshot) return;
    this.snapshot = null;
    this.publish();
  };

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

interface CameraSnapshot {
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
}

class CameraPreviewStore {
  private snapshot: CameraSnapshot;
  private baseSnapshot: CameraSnapshot;
  private previewing = false;
  private readonly listeners = new Set<() => void>();

  constructor(initial: CameraSnapshot) {
    this.snapshot = initial;
    this.baseSnapshot = initial;
  }

  getSnapshot = (): CameraSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  preview(next: CameraSnapshot): void {
    if (!this.previewing) {
      this.baseSnapshot = this.snapshot;
      this.previewing = true;
    }
    this.publish(next);
  }

  commit(next: CameraSnapshot): void {
    this.previewing = false;
    this.baseSnapshot = next;
    this.publish(next);
  }

  syncCommitted(next: CameraSnapshot): void {
    if (this.previewing) {
      // An unrelated editor update can render the provider while a gesture is
      // in flight. Keep the preview until React reaches either its base or the
      // committed preview camera; a third camera is an external override.
      if (sameCamera(next, this.baseSnapshot)) return;
      if (sameCamera(next, this.snapshot)) {
        this.previewing = false;
        this.baseSnapshot = next;
        return;
      }
    }
    this.commit(next);
  }

  private publish(next: CameraSnapshot): void {
    if (sameCamera(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

function sameCamera(a: CameraSnapshot, b: CameraSnapshot): boolean {
  return (
    a.zoom === b.zoom && a.pan.x === b.pan.x && a.pan.y === b.pan.y && a.rotation === b.rotation
  );
}

function cameraSnapshot(state: EditorState): CameraSnapshot {
  return {
    zoom: state.zoom,
    pan: state.pan,
    rotation: state.cameraRotation,
  };
}

function normalizedCamera(camera: Camera, fallbackRotation: number): CameraSnapshot {
  return {
    zoom: clampZoom(camera.zoom),
    pan: { x: camera.pan.x, y: camera.pan.y },
    rotation: camera.rotation ?? fallbackRotation,
  };
}

interface InternalViewportContextValue extends ViewportContextValue {
  cameraStore: CameraPreviewStore;
}

const ViewportCtx = createContext<InternalViewportContextValue | null>(null);

export function useViewport(): ViewportContextValue {
  const ctx = useContext(ViewportCtx);
  if (!ctx) throw new Error('useViewport must be used within EditorProvider');
  const camera = useSyncExternalStore(
    ctx.cameraStore.subscribe,
    ctx.cameraStore.getSnapshot,
    ctx.cameraStore.getSnapshot,
  );
  return useMemo(
    () => ({
      canvasMode: ctx.canvasMode,
      transformPreviewStore: ctx.transformPreviewStore,
      previewCamera: ctx.previewCamera,
      setCamera: ctx.setCamera,
      setZoom: ctx.setZoom,
      setPan: ctx.setPan,
      zoomIn: ctx.zoomIn,
      zoomOut: ctx.zoomOut,
      zoomTo: ctx.zoomTo,
      smoothZoomTo: ctx.smoothZoomTo,
      smoothPanTo: ctx.smoothPanTo,
      smoothReveal: ctx.smoothReveal,
      setCanvasMode: ctx.setCanvasMode,
      canvasToWorld: ctx.canvasToWorld,
      worldToCanvas: ctx.worldToCanvas,
      canvasDeltaToWorld: ctx.canvasDeltaToWorld,
      revealSelection: ctx.revealSelection,
      fitAll: ctx.fitAll,
      zoom: camera.zoom,
      pan: camera.pan,
      cameraRotation: camera.rotation,
    }),
    [camera, ctx],
  );
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
  const cameraStoreRef = useRef<CameraPreviewStore | null>(null);
  if (!cameraStoreRef.current)
    cameraStoreRef.current = new CameraPreviewStore(cameraSnapshot(state));
  const cameraStore = cameraStoreRef.current;
  const transformPreviewStoreRef = useRef<CanvasTransformPreviewStore | null>(null);
  if (!transformPreviewStoreRef.current)
    transformPreviewStoreRef.current = new CanvasTransformPreviewStore();
  const transformPreviewStore = transformPreviewStoreRef.current;
  const previousDocumentRef = useRef<{ activeId: string; documentId: string } | null>(null);

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

  const previewCamera = useCallback(
    (camera: Camera) => {
      cancelCameraTransition(animRef);
      const next = normalizedCamera(camera, stateRef.current.cameraRotation);
      stateRef.current = {
        ...stateRef.current,
        zoom: next.zoom,
        pan: next.pan,
        cameraRotation: next.rotation,
      };
      cameraStore.preview(next);
    },
    [animRef, cameraStore, stateRef],
  );

  const setCamera = useCallback(
    (camera: Camera) => {
      cancelCameraTransition(animRef);
      const next = normalizedCamera(camera, stateRef.current.cameraRotation);
      stateRef.current = {
        ...stateRef.current,
        zoom: next.zoom,
        pan: next.pan,
        cameraRotation: next.rotation,
      };
      cameraStore.commit(next);
      setState((s) =>
        s.zoom === next.zoom &&
        s.pan.x === next.pan.x &&
        s.pan.y === next.pan.y &&
        s.cameraRotation === next.rotation
          ? s
          : {
              ...s,
              zoom: next.zoom,
              pan: next.pan,
              cameraRotation: next.rotation,
            },
      );
    },
    [animRef, cameraStore, setState, stateRef],
  );

  useEffect(() => {
    const currentDocument = { activeId: state.activeId, documentId: state.document.id };
    const previousDocument = previousDocumentRef.current;
    if (
      previousDocument &&
      (previousDocument.activeId !== currentDocument.activeId ||
        previousDocument.documentId !== currentDocument.documentId)
    ) {
      cameraStore.commit(cameraSnapshot(state));
    } else {
      cameraStore.syncCommitted(cameraSnapshot(state));
    }
    previousDocumentRef.current = currentDocument;
  }, [
    cameraStore,
    state.activeId,
    state.cameraRotation,
    state.document.id,
    state.pan.x,
    state.pan.y,
    state.zoom,
  ]);

  const setZoom = useCallback(
    (z: number) => {
      // Anchor around the viewport center so the point under the canvas
      // center stays put — identical to `useEditor().setZoom` (both go
      // through `computeZoomTo`). A plain `clampZoom` patch would diverge.
      cancelCameraTransition(animRef);
      const s = stateRef.current;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      setCamera({ ...computeZoomTo(camState, z, getEditorViewport()), rotation: s.cameraRotation });
    },
    [setCamera, stateRef, animRef],
  );

  const setPan = useCallback(
    (p: { x: number; y: number }) => {
      const s = stateRef.current;
      setCamera({ zoom: s.zoom, pan: p, rotation: s.cameraRotation });
    },
    [setCamera, stateRef],
  );

  const zoomIn = useCallback(() => {
    cancelCameraTransition(animRef);
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    setCamera({
      ...computeZoomStep(camState, 'in', getEditorViewport()),
      rotation: s.cameraRotation,
    });
  }, [setCamera, stateRef, animRef]);

  const zoomOut = useCallback(() => {
    cancelCameraTransition(animRef);
    const s = stateRef.current;
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
    setCamera({
      ...computeZoomStep(camState, 'out', getEditorViewport()),
      rotation: s.cameraRotation,
    });
  }, [setCamera, stateRef, animRef]);

  const zoomTo = useCallback(
    (level: number) => {
      cancelCameraTransition(animRef);
      const s = stateRef.current;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      setCamera({
        ...computeZoomTo(camState, level, getEditorViewport()),
        rotation: s.cameraRotation,
      });
    },
    [setCamera, stateRef, animRef],
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
      const current = stateRef.current;
      const pt = editorScreenToWorld(
        { zoom: current.zoom, pan: current.pan, cameraRotation: current.cameraRotation },
        cx,
        cy,
        getEditorViewport(),
      );
      return { x: pt[0], y: pt[1] };
    },
    [stateRef],
  );

  const worldToCanvas = useCallback(
    (wx: number, wy: number) => {
      // Must go through the floating-origin-aware transform
      // (editorWorldToScreen) that the canvas actually paints with — a naive
      // world*zoom+pan drifts from the real paint position once panned away
      // from world (0,0). See packages/editor/src/canvas/cameraState.ts.
      const current = stateRef.current;
      const pt = editorWorldToScreen(
        { zoom: current.zoom, pan: current.pan, cameraRotation: current.cameraRotation },
        wx,
        wy,
        getEditorViewport(),
      );
      return { x: pt[0], y: pt[1] };
    },
    [stateRef],
  );

  const canvasDeltaToWorld = useCallback(
    (dx: number, dy: number) => {
      const current = stateRef.current;
      const [wdx, wdy] = screenDeltaToWorld(
        { pan: current.pan, zoom: current.zoom, rotation: current.cameraRotation },
        dx,
        dy,
      );
      return { dx: wdx, dy: wdy };
    },
    [stateRef],
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

  const value = useMemo<InternalViewportContextValue>(
    () => ({
      zoom: state.zoom,
      pan: state.pan,
      cameraRotation: state.cameraRotation,
      canvasMode: state.canvasMode,
      cameraStore,
      transformPreviewStore,
      previewCamera,
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
      state.cameraRotation,
      state.canvasMode,
      cameraStore,
      transformPreviewStore,
      previewCamera,
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
