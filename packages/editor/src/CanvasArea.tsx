// COMPLEXITY: ~450 — drawContent (~1475 paths) extracted into canvas/renderPipeline.ts, buildToolCtx (~340 paths) into canvas/toolContext.ts, tool-sync effects into tools/useToolManagerSync. Remaining complexity is the component's surface-lifecycle effects and JSX; next step: extract the surface/worker lifecycle effects into a hook.

import { useDroppable } from '@dnd-kit/core';
import { type CompositorBackend, createCompositorBackend } from '@varve/compositor';
import { createEngine, type Engine, getImageCache, prewarmWasmEngine } from '@varve/engine';
import { type ImportFileInput, ImportService } from '@varve/import';
import {
  buildAllVariantCaches,
  buildVariableDependencyMap,
  canBeClipMaskSource,
  type Document,
  documentHasSolo,
  getChangedVariableIds,
  isImageShape,
  type NodeId,
  resolveAllStyles,
  type SceneNode,
} from '@varve/scene';
import { type Camera, computeFloatingOrigin, screenToWorld } from '@varve/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getDesktopAnalytics } from './analytics/desktopAnalytics';
import { resetProfile } from './canvas/adaptiveProfile';
import {
  subscribeToCanvasContextLifecycle,
  subscribeToDevicePixelRatio,
} from './canvas/canvasSurface';
import { DirtyRegionRecorder, type PaintedSurfaceIdentity } from './canvas/dirtyRegion';
import { EngineNodeMemo } from './canvas/engineNodeMemo';
import { useCanvasInputs } from './canvas/inputPipeline';
import { computeInvalidationPlan } from './canvas/invalidationPlan';
import { useOverlayDraw } from './canvas/overlayManager';
import {
  cancelCanvasFrame,
  createCanvasFrameKey,
  createRedrawCoordinator,
  enableDrawDiagnostics,
  type FrameInvalidation,
  getMemoryBudgets,
  installPerfDiagnosticsHandle,
  type RedrawCoordinator,
  type RedrawReason as RedrawCoordinatorReason,
  registerPaintedSurfaceInvalidator,
  registerPerfCameraController,
  registerRedrawCoordinator,
  scheduleCanvasFrame,
  setApplyFixtureHandler,
} from './canvas/perfRuntime';
import { renderContent } from './canvas/renderPipeline';
import { NodeHashMemo, SubtreeIrCache } from './canvas/subtreeIrCache';
import { buildToolContext } from './canvas/toolContext';
import { useDocumentFontReadiness } from './canvas/useDocumentFonts';
import { TouchCandidateMenu } from './components/Breadcrumb/TouchCandidateMenu';
import { CanvasOverlays } from './components/CanvasOverlays';
import { type EditorState, setStartTextEditingHandler, useEditor } from './context';
import { LEGACY_FILE_MIME, VARVE_FILE_MIME } from './dnd-types';
import { collectFilesFromDataTransfer } from './dropUtils';
import { useCollabPresence } from './hooks/useCollabPresence';
import {
  createRenderWorkerHost,
  disposeWorkerFrame,
  isStaleResponse,
  type RenderWorkerHost,
  setCompositorDiagnostics,
} from './render/canvasRenderAdapter';
import type { MockupSurfaceCache } from './render/mockup/mockupIr';
import {
  type FrameSpatialIndex,
  getOrCreateFrameSpatialIndex,
  type SpatialIndex,
  updateSpatialIndexNodes,
} from './scene/spatialIndex';
import {
  createTransformCache,
  invalidateNodes,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import { loadSettings } from './settings';
import type { DraftShape, PixelProbe, ToolContext } from './tools';
import type { CropTool } from './tools/CropTool';
import type { collectSourceEvents } from './tools/inputNormalizer';
import type { PerspectiveTool } from './tools/PerspectiveTool';
import { createSnapSession, type SnapGuide, type SnapSession } from './tools/snapping';
import { useToolManagerSync } from './tools/useToolManagerSync';

/**
 * Quick reference-equality check: returns true when the only top-level field
 * that differs between two Document objects is `variableStore`.
 * All other fields must be reference-equal.
 * Used to detect variable-only changes that can skip full cache invalidation.
 */
function isOnlyVariableStoreChange(oldDoc: Document, newDoc: Document): boolean {
  if (oldDoc === newDoc) return false;
  const keys = new Set([
    ...(Object.keys(oldDoc) as (keyof Document)[]),
    ...(Object.keys(newDoc) as (keyof Document)[]),
  ]);
  for (const key of keys) {
    if (key === 'variableStore') continue;
    if (
      (oldDoc as unknown as Record<string, unknown>)[key] !==
      (newDoc as unknown as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }
  return true;
}

interface EmptyStateHint {
  title: string;
  shortcuts: Array<{ key: string; label: string }>;
  hint: string;
}

const EMPTY_STATE_BY_MODE: Record<string, EmptyStateHint> = {
  design: {
    title: 'Start designing',
    shortcuts: [
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
      { key: 'P', label: 'Pen' },
    ],
    hint: 'or drag an image here',
  },
  print: {
    title: 'Start your layout',
    shortcuts: [
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
    ],
    hint: 'or drag an image to place',
  },
  drawing: {
    title: 'Start painting',
    shortcuts: [
      { key: 'B', label: 'Brush' },
      { key: '⇧P', label: 'Pencil' },
      { key: 'E', label: 'Eraser' },
    ],
    hint: 'or drag an image to trace',
  },
  image: {
    title: 'Edit your photo',
    shortcuts: [{ key: '⌘O', label: 'Open image' }],
    hint: 'or drag an image onto the canvas',
  },
  motion: {
    title: 'Create your first scene',
    shortcuts: [
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
    ],
    hint: 'or drag images to animate',
  },
  codegen: {
    title: 'Select artwork to export',
    shortcuts: [{ key: 'V', label: 'Select' }],
    hint: 'then choose a code format in the Export panel',
  },
  logo: {
    title: 'Design your mark',
    shortcuts: [
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
      { key: 'P', label: 'Pen' },
    ],
    hint: 'or start from a template',
  },
  email: {
    title: 'Design your email',
    shortcuts: [
      { key: 'F', label: 'Frame' },
      { key: 'R', label: 'Rectangle' },
      { key: 'T', label: 'Text' },
    ],
    hint: 'or drag images into the layout',
  },
};

export function getEmptyStateContent(mode: string): EmptyStateHint {
  return EMPTY_STATE_BY_MODE[mode] ?? EMPTY_STATE_BY_MODE.design!;
}

export function CanvasArea({
  canvasContainerRef,
  onContextMenu,
}: {
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>;
  onContextMenu?: (pos: { x: number; y: number }) => void;
}) {
  const contentCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useRef<HTMLDivElement>(null);
  const editor = useEditor();
  const { state, rootNodes } = editor;
  const { setNodeRef: setDroppableRef, isOver: isCanvasDropOver } = useDroppable({
    id: 'canvas-drop-zone',
    data: { accepts: ['layer', 'file', 'Files'] },
  });

  const engineRef = useRef<Engine | null>(null);
  const compositorRef = useRef<CompositorBackend | null>(null);
  const renderWorkerRef = useRef<RenderWorkerHost | null>(null);
  const workerBitmapRef = useRef<{
    bitmap: ImageBitmap;
    docVersion: number;
    camera: Camera;
    viewport: { width: number; height: number };
    dpr: number;
  } | null>(null);
  const requestContentDrawRef = useRef<
    ((source: string, reason: RedrawCoordinatorReason) => void) | null
  >(null);
  const docVersionRef = useRef(0);
  const stateRef = useRef<EditorState>(state);
  stateRef.current = state;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  // Centralized frame invalidation: decides (skip / present / content) before
  // any scene traversal and attributes every frame with its reasons.
  const redrawCoordinatorRef = useRef<RedrawCoordinator | null>(null);
  if (!redrawCoordinatorRef.current) redrawCoordinatorRef.current = createRedrawCoordinator();
  const pendingPresentRef = useRef(false); // worker bitmap awaiting compositing
  const transformCacheRef = useRef<TransformCache>(createTransformCache());
  const settings = loadSettings();
  const budgets = getMemoryBudgets(settings.render.memoryBudget);
  const subtreeIrCacheRef = useRef(new SubtreeIrCache(500, budgets.subtreeIrCacheBytes));
  const mockupSurfaceCacheRef = useRef<MockupSurfaceCache | null>(null);
  // Cross-frame memo for the per-node content hash. Lets pan/zoom/rotate/resize
  // frames (which change neither the document nor world transforms) skip the
  // per-node cacheContentParts + nodeHash loop entirely. See NodeHashMemo.
  const nodeHashMemoRef = useRef(new NodeHashMemo());
  // Cross-frame memo for scene→engine node conversion. During a drag the
  // document is structurally shared, so every node except the edited one keeps
  // its reference and skips toEngineNode entirely. See EngineNodeMemo.
  const engineNodeMemoRef = useRef(new EngineNodeMemo(budgets.engineNodeMemoEntries));
  // Cached canvas position for pointer→world coordinate conversion.
  // Updated by ResizeObserver and refreshed on pointerdown for safety.
  // Avoids getBoundingClientRect() on every pointer-move (the single
  // highest-frequency DOM layout read in the application).
  const canvasRectRef = useRef({ left: 0, top: 0 });

  // Diagnostics HUD is off by default; driven by the persisted Settings >
  // Performance > Diagnostics toggle. The toggle also calls
  // enableDrawDiagnostics directly for an immediate response — this effect
  // re-syncs on mount and whenever this component happens to re-render with
  // a changed persisted value (e.g. after Reset settings).
  useEffect(() => {
    enableDrawDiagnostics(settings.performance.showPerformanceDiagnostics);
    installPerfDiagnosticsHandle();
  }, [settings.performance.showPerformanceDiagnostics]);

  // Track keyboard focus on the inner canvas to drive the parent section's
  // focus-visible ring. Mouse clicks fire focus but we suppress the ring
  // for them — only :focus-visible (keyboard) shows it.
  const canvasFocusedRef = useRef(false);
  const handleCanvasFocus = useCallback(() => {
    canvasFocusedRef.current = true;
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    const section = canvas.closest('.editor-canvas') as HTMLElement | null;
    if (!section) return;
    if (canvas.matches(':focus-visible')) {
      section.setAttribute('data-canvas-focus-visible', 'true');
    }
  }, []);

  const handleCanvasBlur = useCallback(() => {
    canvasFocusedRef.current = false;
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    const section = canvas.closest('.editor-canvas') as HTMLElement | null;
    if (!section) return;
    section.removeAttribute('data-canvas-focus-visible');
  }, []);
  // Frame/group spatial index, cached by fingerprint for fast drag containment.
  const frameIndexRef = useRef<FrameSpatialIndex | null>(null);
  const snapIndexRef = useRef<{
    index: SpatialIndex;
    parentIndex: Map<string, string>;
    documentId: string;
    indexedNodeCount: number;
  } | null>(null);
  const marqueeIndexRef = useRef<SpatialIndex | null>(null);
  const prevDrawDocRef = useRef(state.document);
  const lastRenderedDocRef = useRef(state.document);
  if (state.document !== prevDrawDocRef.current) {
    // Reset adaptive profile on document change — fresh frame timing baseline
    resetProfile();
    const prevDoc = prevDrawDocRef.current;
    if (prevDoc && isOnlyVariableStoreChange(prevDoc, state.document)) {
      // Variable-only change: selectively invalidate only the nodes bound to
      // changed variables. This avoids a full cache wipe + docVersion bump,
      // so all unaffected nodes keep their cached IR and skip rebuild.
      const changedVarIds = getChangedVariableIds(
        prevDoc.variableStore,
        state.document.variableStore,
      );
      if (changedVarIds.size > 0) {
        const depMap = buildVariableDependencyMap(
          state.document.nodes,
          state.document.variableStore,
        );
        for (const varId of changedVarIds) {
          const bound = depMap.get(varId);
          if (bound) {
            for (const nodeId of bound) {
              subtreeIrCacheRef.current.invalidate(nodeId);
            }
          }
        }
      }
    } else {
      // Determine whether this is a structural change (container moved,
      // node added/removed, parent changed) or a property-only change
      // (fill, stroke, opacity, position, etc.). Structural changes force
      // a full cache wipe; property-only changes selectively invalidate
      // only the affected nodes (plus their parents), preserving all
      // other cache entries.
      const plan = computeInvalidationPlan(prevDoc, state.document);
      docVersionRef.current += 1;

      if (plan.isStructural) {
        invalidateTransformCache(transformCacheRef.current);
        subtreeIrCacheRef.current.invalidate();
        // Reference identity already prevents stale reuse; clearing here stops
        // entries for deleted nodes retaining their engine nodes (and any image
        // payloads those reach) until FIFO eviction would drop them.
        engineNodeMemoRef.current.clear();
        frameIndexRef.current = getOrCreateFrameSpatialIndex(state.document, frameIndexRef.current);
        // The snap index caches a parent map, which a structural edit
        // invalidates — drop it so the next snap rebuilds against the new
        // hierarchy. Structural edits are not per-frame, so a rebuild here
        // costs nothing on the drag path.
        snapIndexRef.current = null;
      } else {
        invalidateNodes(transformCacheRef.current, plan.changedIds);
        for (const id of plan.changedIds) {
          subtreeIrCacheRef.current.invalidate(id);
          engineNodeMemoRef.current.invalidate(id);
        }
        // Frame spatial index is unchanged — container bounds haven't changed.
        // The snap index is *not* unchanged: it is keyed by cell, so a node
        // that moved now sits in the wrong cells. Left stale, it silently
        // stops being a snap target once it leaves its original cells. Update
        // just the moved nodes — O(changed), not O(document).
        const snapIndex = snapIndexRef.current;
        if (snapIndex) {
          updateSpatialIndexNodes(snapIndex.index, state.document, plan.changedIds);
        }
      }
    }
    prevDrawDocRef.current = state.document;
  }

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [pixelProbe, setPixelProbe] = useState<PixelProbe | null>(null);
  const [dropTargetFrameId, setDropTargetFrameId] = useState<NodeId | null>(null);
  const [maskDropTargetId, setMaskDropTargetId] = useState<NodeId | null>(null);
  const maskDropTargetRef = useRef<NodeId | null>(null);
  // Incremented by the image cache subscriber so drawContent re-runs after async image loads.
  const [imageCacheStamp, setImageCacheStamp] = useState(0);
  const [fontLoadStamp, setFontLoadStamp] = useState(0);
  // Explicit redraw counter — bumped by requestRedraw() to guarantee drawContent
  // identity changes (and thus a RAF reschedule) on every mutation path, even when
  // rootNodes/zoom/pan etc. are unchanged due to React batching edge cases.
  const [redrawCount, setRedrawCount] = useState(0);
  const contentDrawFrameKey = useRef<string | null>(null);
  contentDrawFrameKey.current ??= createCanvasFrameKey('content');

  // Concurrency guard for drawContent's async body: `drawContent`'s identity
  // (and thus the RAF-scheduling effect below) changes on every document
  // mutation, camera move, etc., but cancelling a *scheduled* animation frame
  // cannot stop a *previous* invocation that's already mid-await on
  // `eng.buildIr()` (a real Tauri IPC round-trip on desktop). Without this
  // guard, bursts of triggers (an image finishing decode right after a doc
  // mutation, continuous pan/zoom) each start their own overlapping native
  // IR build — cheap for small scenes, but for a scene holding a large
  // embedded image (multi-MB base64 payload serialized to/from JSON on every
  // call) overlapping builds can stack up and pin the IPC/JSON-serialization
  // work indefinitely. Coalesce bursts into "one more pass after the current
  // one finishes" instead of firing concurrently.
  const drawInFlightRef = useRef(false);
  const drawPendingRef = useRef(false);

  // B-04: Dirty-rect tracking for partial redraw. Populated by draw()
  // diffing old vs current node world bounds.
  const dirtyRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  // Persistent bounded collector for pre-merge dirty rectangles.
  const dirtyRecorderRef = useRef(new DirtyRegionRecorder());

  // Redraw attribution: the previous camera / decode / font stamps let the
  // diagnostics record WHY a frame is being drawn (see resolveRedrawReason).
  const prevCameraForRedrawRef = useRef<{
    zoom: number;
    pan: { x: number; y: number };
    rotation: number;
  } | null>(null);
  // Camera + surface the content backing store was last fully painted under.
  // Partial redraw retains every pixel outside the dirty rects, so those pixels
  // are only valid while this matches the current frame exactly — a pan or zoom
  // moves them all, which is what produced stale/smeared content while
  // scrolling (auto-pan during a drag changes camera and document together).
  const paintedSurfaceRef = useRef<PaintedSurfaceIdentity | null>(null);
  const prevImageCacheStampForRedrawRef = useRef(imageCacheStamp);
  const prevFontLoadStampForRedrawRef = useRef(fontLoadStamp);

  // Cache CSS custom-property colors so drawContent doesn't call
  // getComputedStyle() every frame (forces style recalc). Updated only on
  // theme change via the effect below.
  const sunkenColorRef = useRef('');
  const accentColorRef = useRef('');
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const cs = getComputedStyle(document.documentElement);
    sunkenColorRef.current = cs.getPropertyValue('--color-surface-sunken').trim();
    accentColorRef.current = cs.getPropertyValue('--color-accent-primary').trim();
  }, [state.themeRevision]);

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const snapSessionRef = useRef<SnapSession>(createSnapSession());

  const collab = useCollabPresence(state.activeId, state.cursorPos, state.pan);
  const [nodeEditTargetId, setNodeEditTargetId] = useState<string | null>(null);
  const [nodeEditSelectedAnchors, setNodeEditSelectedAnchors] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [textEditTargetId, setTextEditTargetId] = useState<string | null>(null);
  // Register module-level bridge so createActionHandlers.editText works
  useEffect(() => {
    setStartTextEditingHandler((nodeId: string) => setTextEditTargetId(nodeId));
    return () => setStartTextEditingHandler(null);
  }, []);
  const pendingAutoTextEditRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<SceneNode | null>(null);
  const [warpMesh, setWarpMesh] = useState<import('@varve/engine').MeshWarp | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [displayDpr, setDisplayDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );
  const [renameDialog, setRenameDialog] = useState<{ defaultValue: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);

  // Touch/stylus deep-selection candidate menu state
  const [deepSelectionCandidates, setDeepSelectionCandidates] = useState<{
    worldX: number;
    worldY: number;
    screenX: number;
    screenY: number;
    candidates: Array<{
      nodeId: import('@varve/scene').NodeId;
      node: import('@varve/scene').SceneNode;
      depth: number;
    }>;
  } | null>(null);

  useEffect(() => {
    const el = contentCanvasRef.current?.parentElement;
    if (!el) return;
    const updateSize = () => {
      setCanvasSize({ width: el.clientWidth, height: el.clientHeight });
      // Cache the canvas element's screen position for pointer→world conversion.
      const canvas = contentCanvasRef.current;
      if (canvas) {
        const r = canvas.getBoundingClientRect();
        canvasRectRef.current = { left: r.left, top: r.top };
      }
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => subscribeToDevicePixelRatio(setDisplayDpr), []);

  // Oracle seam: drop the painted-surface identity so the next frame is an
  // authoritative full redraw of the *same* document and camera. The
  // incremental-vs-full comparison depends on changing nothing else.
  useEffect(() => {
    registerPaintedSurfaceInvalidator(() => {
      paintedSurfaceRef.current = null;
      requestContentDrawRef.current?.('oracle-full-redraw', 'backing-store-recovery');
    });
    return () => registerPaintedSurfaceInvalidator(null);
  }, []);

  // Perf seam: let the visual corpus park the camera at exact zooms without
  // reaching into the React tree. No-op for normal sessions.
  useEffect(() => {
    registerPerfCameraController({
      setZoom: (zoom) => editor.setZoom(zoom),
    });
    return () => registerPerfCameraController(null);
  }, [editor]);

  useEffect(() => {
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    return subscribeToCanvasContextLifecycle(canvas, {
      onLost: () => {
        disposeWorkerFrame(renderWorkerRef.current, workerBitmapRef.current?.bitmap);
        workerBitmapRef.current = null;
        // The backing store is gone: nothing may be retained across the loss,
        // so the recovery frame must be a full redraw.
        paintedSurfaceRef.current = null;
        editorRef.current.announce('Canvas rendering context lost. Waiting to restore rendering.');
      },
      onRestored: () => {
        editorRef.current.announce('Canvas rendering restored.');
        requestContentDrawRef.current?.('context-restore', 'backing-store-recovery');
      },
    });
  }, []);

  useEffect(() => {
    createEngine('auto').then((eng) => {
      engineRef.current = eng;
      // drawContent() bails out entirely while engineRef.current is null, and
      // nothing else re-triggers a draw once this async engine init resolves —
      // force one now so the canvas doesn't stay blank waiting for an
      // unrelated state change (pan/zoom/doc edit) to happen to redraw it.
      requestContentDrawRef.current?.('engine-init', 'backing-store-recovery');
    });
  }, []);

  // Pre-warm WASM engine during idle so first document load is instant
  useEffect(() => {
    prewarmWasmEngine();
  }, []);

  useEffect(() => {
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    let backend: CompositorBackend | null = null;
    void createCompositorBackend(canvas, {
      preferWebGpu: loadSettings().render.preferWebGpu,
    }).then(({ backend: b }) => {
      backend = b;
      compositorRef.current = b;
      setCompositorDiagnostics(
        b.getDiagnostics?.() ?? {
          backendId: b.id,
          gpuActive: b.id === 'webgpu',
          vertexPoolEntries: 0,
          bundleCacheEntries: 0,
          lastFrameVertexBytes: 0,
          adapterIsFallback: false,
        },
      );
      const preferWebGpu = loadSettings().render.preferWebGpu;
      if (preferWebGpu && b.id !== 'webgpu') {
        getDesktopAnalytics().track('renderer_fallback', {
          from: 'webgpu',
          to: 'canvas2d',
          reason: 'unavailable',
        });
      }
      requestContentDrawRef.current?.('compositor-init', 'backing-store-recovery');
    });
    return () => {
      backend?.destroy();
      compositorRef.current = null;
    };
  }, []);

  const workerFailedRef = useRef(false);

  useEffect(() => {
    registerRedrawCoordinator(redrawCoordinatorRef.current);
    setApplyFixtureHandler(async (id) => {
      try {
        const { createPerformanceWorkload } = await import('./performance/workloadCorpus');
        const workload = createPerformanceWorkload(id as never);
        editorRef.current.updateDoc(() => workload.document);
        requestContentDrawRef.current?.('fixture-apply', 'scene-mutation');
        return {
          ok: true,
          id: workload.document.id,
          nodeCount: workload.expected.nodeCount,
          fixtureChecksum: workload.fixtureChecksum,
        };
      } catch {
        return { ok: false };
      }
    });
    return () => {
      registerRedrawCoordinator(null);
      setApplyFixtureHandler(null);
    };
  }, []);

  useEffect(() => {
    renderWorkerRef.current = createRenderWorkerHost(
      (msg) => {
        if (msg.type === 'frameRendered') {
          if (isStaleResponse(docVersionRef.current, msg.docVersion)) {
            redrawCoordinatorRef.current?.noteStaleWorkerResponse();
            disposeWorkerFrame(renderWorkerRef.current, msg.bitmap);
            return;
          }
          if (msg.bitmap) {
            disposeWorkerFrame(renderWorkerRef.current, workerBitmapRef.current?.bitmap);
            workerBitmapRef.current = {
              bitmap: msg.bitmap,
              docVersion: msg.docVersion,
              camera: msg.camera,
              viewport: msg.viewport,
              dpr: msg.dpr,
            };
            pendingPresentRef.current = true;
            requestContentDrawRef.current?.('worker-reply', 'worker-present');
          }
        } else if (msg.type === 'error' && !workerFailedRef.current) {
          workerFailedRef.current = true;
          console.warn('[Varve] Render worker failed, falling back to main-thread:', msg.message);
          requestContentDrawRef.current?.('worker-error', 'backing-store-recovery');
        }
      },
      () => {
        if (!workerFailedRef.current) {
          workerFailedRef.current = true;
          console.warn('[Varve] Render worker stopped permanently; using main-thread Canvas 2D.');
          requestContentDrawRef.current?.('worker-stop', 'backing-store-recovery');
        }
      },
      // Byte-budget the main-thread-visible worker bitmap pipeline: outbound
      // image transfers, the worker backing store, and the retained frame.
      // Over-budget renders are refused up front and fall back to the
      // main-thread path instead of unbounded worker memory.
      { budgetBytes: budgets.workerBitmapBytes },
    );
    return () => {
      renderWorkerRef.current?.terminate();
      renderWorkerRef.current = null;
      workerBitmapRef.current?.bitmap.close();
      workerBitmapRef.current = null;
      workerFailedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const dlg = renameDialogRef.current;
    if (!dlg) return;
    if (renameDialog) {
      dlg.showModal();
      renameInputRef.current?.select();
    } else {
      dlg.close();
    }
  }, [renameDialog]);

  const tm = useToolManagerSync(editor, state, buildToolCtx);

  // Re-render the canvas when solo state changes (non-destructive visibility focus).
  const prevSoloRef = useRef(documentHasSolo(state.document));
  useEffect(() => {
    const hasSolo = documentHasSolo(state.document);
    if (hasSolo !== prevSoloRef.current) {
      prevSoloRef.current = hasSolo;
      requestRedrawRef.current?.();
    }
  });

  // Re-render the canvas whenever an async image finishes loading.
  useEffect(() => {
    const imageCache = getImageCache();
    imageCache.setLimits({ maxBytes: budgets.imageCacheBytes });
    const unsub = imageCache.subscribeGlobal(() => {
      setImageCacheStamp((n) => n + 1);
      requestRedrawRef.current?.();
    });
    return unsub;
  }, [budgets.imageCacheBytes]);

  // Font readiness is derived presentation state: it invalidates every cache
  // holding font-dependent geometry and repaints, and it never touches the
  // document, selection, or history.
  useDocumentFontReadiness(state.document, () => {
    invalidateTransformCache(transformCacheRef.current);
    subtreeIrCacheRef.current.invalidate();
    engineNodeMemoRef.current.clear();
    snapIndexRef.current = null;
    setFontLoadStamp((n) => n + 1);
    requestRedrawRef.current?.();
  });

  // Auto-enter text edit mode after creating a text node via TextTool
  useEffect(() => {
    if (pendingAutoTextEditRef.current && state.selection.length === 1) {
      pendingAutoTextEditRef.current = false;
      const id = state.selection[0] as NodeId;
      const node = state.document.nodes[id];
      if (node?.kind === 'text') {
        setTextEditTargetId(id);
      }
    }
  }, [state.selection, state.document]);

  // ─── ToolContext builder ─────────────────────────────────────────────────
  // `canvasToWorld`/`worldToCanvas`/`canvasDeltaToWorld` are defined inside
  // `buildToolCtx` (below) and include the `getBoundingClientRect()`
  // subtraction. The standalone functions were removed in the coordinate-model
  // repair (Phase 1) — tools must use ctx.canvasToWorld, which accepts
  // viewport-relative clientX/Y.

  function buildToolCtx(
    ev: PointerEvent,
    sourceEvents: ReturnType<typeof collectSourceEvents> = [],
  ): ToolContext {
    // Refresh the cached canvas rect at gesture start for safety.
    // The ResizeObserver keeps it current, but a pointerdown is a
    // definitive sync point.
    const canvas = contentCanvasRef.current;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      canvasRectRef.current = { left: r.left, top: r.top };
    }
    return buildToolContext(
      {
        stateRef,
        editorRef,
        engineRef,
        contentCanvasRef,
        canvasRectRef,
        frameIndexRef,
        transformCacheRef,
        snapSessionRef,
        snapIndexRef,
        marqueeIndexRef,
        pendingAutoTextEditRef,
        nodeEditTargetId,
        setDraft,
        setPixelProbe,
        setDropTargetFrameId,
        setSnapGuides,
        setDeepSelectionCandidates,
        setNodeEditTargetId,
        setNodeEditSelectedAnchors,
        setTextEditTargetId,
        commitCamera,
        rootNodes,
      },
      ev,
      sourceEvents,
    );
  }

  /**
   * Keep gesture math ahead of React rendering while committing the complete
   * camera atomically. Trackpads can deliver several wheel events in one task;
   * updating this ref prevents each event from reusing stale zoom and pan.
   */
  function commitCamera(camera: Camera): void {
    const current = stateRef.current;
    stateRef.current = {
      ...current,
      zoom: camera.zoom,
      pan: camera.pan,
      cameraRotation: camera.rotation ?? current.cameraRotation,
    };
    editorRef.current.setCamera(camera);
  }

  // ── Pre-computed values (memoized on document to avoid per-frame recomputation) ──
  const precomputedStyles = useMemo(
    () => (state.document ? resolveAllStyles(state.document) : new Map()),
    [state.document],
  );
  const precomputedVariantCaches = useMemo(
    () => (state.document ? buildAllVariantCaches(state.document) : new Map()),
    [state.document],
  );
  // ─── Drawing ─────────────────────────────────────────────────────────────

  // ── Content canvas draw: board background, IR replay, outline mode ──────

  const drawContent = useCallback(() => {
    renderContent({
      contentCanvasRef,
      engineRef,
      compositorRef,
      renderWorkerRef,
      workerBitmapRef,
      paintedSurfaceRef,
      dirtyRecorderRef,
      subtreeIrCacheRef,
      nodeHashMemoRef,
      engineNodeMemoRef,
      drawInFlightRef,
      drawPendingRef,
      lastRenderedDocRef,
      docVersionRef,
      redrawCoordinatorRef,
      dirtyRectRef,
      pendingPresentRef,
      workerFailedRef,
      sunkenColorRef,
      transformCacheRef,
      mockupSurfaceCacheRef,
      prevCameraForRedrawRef,
      prevImageCacheStampForRedrawRef,
      prevFontLoadStampForRedrawRef,
      contentDrawFrameKey,
      requestContentDrawRef,
      stateRef,
      displayDpr,
      imageCacheStamp,
      fontLoadStamp,
      precomputedStyles,
      precomputedVariantCaches,
      budgets,
      editor,
      setCompositorDiagnostics,
      scheduleDrawContent: drawContent,
    });
  }, [
    rootNodes,
    state.zoom,
    state.pan.x,
    state.pan.y,
    state.cameraRotation,
    state.canvasMode,
    state.themeRevision,
    state.showOriginalBgNodeId,
    imageCacheStamp,
    fontLoadStamp,
    redrawCount,
    state.motion.currentTime,
    state.motion.isPlaying,
    state.motion.activeTimelineId,
    displayDpr,
    canvasSize.width,
    canvasSize.height,
    precomputedVariantCaches,
    editor.proofEnabled,
  ]);

  // ── requestRedraw: defence-in-depth redraw trigger ────────────────────
  // Bumps redrawCount to guarantee a drawContent identity change whenever a
  // subscription fires outside the normal state paths (image cache, font
  // registry). The stamps those subscriptions also bump would trigger the
  // reactive effect on their own; the count is belt-and-braces for batching
  // edge cases. The coordinator decides whether the resulting frame actually
  // renders.
  const requestRedraw = useCallback(() => {
    setRedrawCount((n) => n + 1);
  }, []);
  const requestRedrawRef = useRef<() => void>(requestRedraw);
  requestRedrawRef.current = requestRedraw;

  // Imperative redraw trigger for non-React draw sources (engine/compositor
  // init, worker frame replies, context-restore), each carrying structured
  // invalidation metadata — the old redrawCount bump forced an extra full
  // clean redraw per call (the measured 56/120 `clean` drag frames). The
  // single `contentDrawFrameKey` coalesces with reactive draws.
  useEffect(() => {
    requestContentDrawRef.current = (source: string, reason: RedrawCoordinatorReason) => {
      const key = contentDrawFrameKey.current;
      if (!key) return;
      const invalidation: FrameInvalidation = {
        reason,
        source,
        contentChanged: reason !== 'worker-present',
        timestamp: performance.now(),
      };
      redrawCoordinatorRef.current?.request(invalidation);
      scheduleCanvasFrame(key, 'canvas', () => drawContent());
    };
  }, [drawContent]);

  // ── RAF scheduling ──────────────────────────────────────────────────────
  // drawContent's identity changes on every document edit, camera move, resize,
  // and theme change (all reach its dependency array, themeRevision included).
  // Schedule a canvas redraw whenever it does, so the painted content stays in
  // sync with the reactive SVG overlays (name labels, selection box). Without
  // this the canvas only repaints on the imperative triggers above, leaving the
  // content stale while overlays move — labels appear to detach/stick.
  useEffect(() => {
    const frameKey = contentDrawFrameKey.current;
    if (!frameKey) return;
    scheduleCanvasFrame(frameKey, 'canvas', () => {
      drawContent();
    });
    return () => {
      cancelCanvasFrame(frameKey);
    };
  }, [drawContent]);

  // ── Overlay draw pipeline ──────────────────────────────────────────────
  useOverlayDraw({
    overlayCanvasRef,
    stateRef,
    transformCacheRef,
    displayDpr,
    accentColorRef,
    sunkenColorRef,
    draft,
    areaSelection: state.areaSelection ?? null,
    dropTargetFrameId,
    maskDropTargetId,
  });

  // ─── Input pipeline (pointer, wheel, keyboard handlers) ──────────────────
  const input = useCanvasInputs({
    contentCanvasRef,
    canvasRectRef,
    editor,
    stateRef,
    tmRef: tm,
    buildToolCtx,
    commitCamera,
    setSnapGuides,
    setHoveredNode,
    setRenameDialog,
    snapSessionRef: snapSessionRef,
    snapIndexRef: snapIndexRef,
    rootNodes,
    canvasFocusedRef,
  });

  // ─── Cursor ───────────────────────────────────────────────────────────────

  const cursor =
    tm.current?.activeToolId === state.tool
      ? tm.current.cursor
      : state.tool === 'refineMask' || state.tool === 'trimapEdit'
        ? 'crosshair'
        : 'default';

  // ─── Render ───────────────────────────────────────────────────────────────

  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!isDragOver) return;
    const cancelFileDrop = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      maskDropTargetRef.current = null;
      setMaskDropTargetId(null);
      setIsDragOver(false);
    };
    window.addEventListener('keydown', cancelFileDrop);
    return () => window.removeEventListener('keydown', cancelFileDrop);
  }, [isDragOver]);

  const computeFileDropWorld = useCallback(
    (clientX: number, clientY: number): readonly [number, number] | null => {
      const rect = contentCanvasRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const cam = {
        pan: stateRef.current.pan,
        zoom: stateRef.current.zoom,
        rotation: stateRef.current.cameraRotation,
      };
      return screenToWorld(
        cam,
        clientX - rect.left,
        clientY - rect.top,
        { width: rect.width, height: rect.height },
        computeFloatingOrigin(cam, { width: rect.width, height: rect.height }),
      );
    },
    [],
  );

  const updateMaskFileDropTarget = useCallback(
    (clientX: number, clientY: number): NodeId | null => {
      const world = computeFileDropWorld(clientX, clientY);
      const hit = world ? editorRef.current.hitTestNode({ x: world[0], y: world[1] }) : null;
      const target = hit?.node;
      const targetId =
        target?.visible && !target.locked && canBeClipMaskSource(target) ? target.id : null;
      maskDropTargetRef.current = targetId;
      setMaskDropTargetId(targetId);
      return targetId;
    },
    [computeFileDropWorld],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.dataTransfer.types.some(
          (t) =>
            t === 'Files' ||
            t === 'application/x-varve-icon' ||
            t.startsWith('image/') ||
            t === 'text/svg+xml',
        )
      ) {
        e.dataTransfer.dropEffect = 'copy';
        setIsDragOver(true);
        updateMaskFileDropTarget(e.clientX, e.clientY);
      }
    },
    [updateMaskFileDropTarget],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    maskDropTargetRef.current = null;
    setMaskDropTargetId(null);
  }, []);

  // Shared by both the HTML5 drop handler and the native Tauri drag-drop
  // listener below — the only difference between the two paths is how
  // `files` and `dropWorld` are obtained.
  const importDroppedFiles = useCallback(
    async (
      files: { name: string; data: Uint8Array | string }[],
      dropWorld: readonly [number, number] | null,
      maskTargetId?: NodeId,
    ) => {
      if (files.length === 0) return;
      const reader = editorRef.current;

      // Parse all files FIRST (expensive SVG parsing) before any setState
      const parsedItems: {
        node: SceneNode;
        sourceDoc: import('@varve/scene').Document;
        position?: { x: number; y: number };
      }[] = [];
      const importInputs = files.map((file): ImportFileInput => {
        if (typeof file.data === 'string') {
          return {
            name: file.name,
            source: 'drop',
            size: new TextEncoder().encode(file.data).byteLength,
            text: file.data,
          };
        }
        return {
          name: file.name,
          source: 'drop',
          size: file.data.byteLength,
          bytes: file.data,
        };
      });
      const report = await ImportService.importFiles(importInputs, {
        center: !dropWorld,
        embedImages: true,
      });

      for (const [i, fileReport] of report.files.entries()) {
        for (const artifact of fileReport.artifacts) {
          for (const id of artifact.nodeIds) {
            const node = artifact.document.nodes[id];
            if (!node) continue;
            // Pass the target through `position` rather than pre-applying it
            // to the node: batchImportNodes is the single positioning
            // authority and re-positions any item without an explicit
            // `position` to the viewport centre — a pre-positioned node
            // with no `position` field would get that fallback applied on
            // top, discarding the drop point.
            parsedItems.push({
              node,
              sourceDoc: artifact.document,
              ...(dropWorld
                ? { position: { x: dropWorld[0] + i * 40, y: dropWorld[1] + i * 40 } }
                : {}),
            });
          }
        }
      }

      // Single batched setState for all imported nodes
      if (parsedItems.length > 0) {
        const allImages = parsedItems.every(({ node }) => isImageShape(node));
        reader.batchImportNodes(
          parsedItems,
          maskTargetId && allImages ? { maskTargetId } : undefined,
        );
      }
      reader.announce(
        `Imported ${report.successCount + report.partialCount} file${report.successCount + report.partialCount === 1 ? '' : 's'}; ${report.failureCount} failed`,
      );
    },
    [],
  );

  const computeDropWorld = useCallback(
    (clientX: number, clientY: number) => computeFileDropWorld(clientX, clientY),
    [computeFileDropWorld],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const maskTargetId = maskDropTargetRef.current ?? undefined;
      setIsDragOver(false);
      maskDropTargetRef.current = null;
      setMaskDropTargetId(null);

      // First check for dnd-kit native files (varve file type, legacy strata
      // type accepted for compatibility)
      const fileMimeTypes = e.dataTransfer.types ?? [];
      const strataFiles =
        fileMimeTypes.includes(VARVE_FILE_MIME) || fileMimeTypes.includes(LEGACY_FILE_MIME);
      if (strataFiles) {
        // Handled by dnd-kit's onDragEnd instead
        return;
      }

      const dropWorld = computeDropWorld(e.clientX, e.clientY);

      // Icon-panel drag-and-drop: the payload carries a sanitized SVG plus
      // provenance; insert through the same command path as the icon browser.
      const iconPayloadJson = e.dataTransfer.getData('application/x-varve-icon');
      if (iconPayloadJson) {
        try {
          const payload = JSON.parse(iconPayloadJson) as {
            name?: string;
            packId?: string;
            providerId?: string;
            svg?: string;
          };
          if (payload.svg && payload.name) {
            const inserted = await editor.insertIconAsset({
              name: payload.name,
              providerId: payload.providerId,
              prefix: payload.packId ?? '',
              svg: payload.svg,
              position: dropWorld ? { x: dropWorld[0], y: dropWorld[1] } : undefined,
            });
            if (inserted) {
              editor.announce(`Inserted icon "${payload.name}"`);
            }
            return;
          }
        } catch {
          // fall through to file handling (unlikely payload shape)
        }
      }

      // Collect all OS files (including folders via FileSystemEntry API)
      const files = await collectFilesFromDataTransfer(e.dataTransfer);
      await importDroppedFiles(files, dropWorld, maskTargetId);
    },
    [computeDropWorld, importDroppedFiles],
  );

  // Native Tauri file drag-and-drop. wry's WebKitGTK backend hooks GTK's own
  // drag-and-drop signals on the WebView widget unconditionally, so the
  // HTML5 dragover/drop handlers above never fire on Linux — this listens
  // to Tauri's window-level drag-drop events instead (absolute file paths,
  // not File objects) and reads each file's bytes via the platform facade.
  useEffect(() => {
    const platform = editorRef.current.platform;
    if (platform?.kind !== 'tauri') return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void platform
      .onNativeFileDrop(async (event) => {
        if (event.type === 'enter' || event.type === 'over') {
          setIsDragOver(true);
          if (event.position.x !== 0 || event.position.y !== 0) {
            updateMaskFileDropTarget(event.position.x, event.position.y);
          }
          return;
        }
        if (event.type === 'leave') {
          setIsDragOver(false);
          maskDropTargetRef.current = null;
          setMaskDropTargetId(null);
          return;
        }
        // event.type === 'drop'
        const maskTargetId = maskDropTargetRef.current ?? undefined;
        setIsDragOver(false);
        maskDropTargetRef.current = null;
        setMaskDropTargetId(null);
        // wry's GTK backend reports (0,0) when a drop fires before any
        // drag-motion event was observed — treat that as "position
        // unknown" rather than mapping it to the window's top-left. And
        // whenever no drop position can be mapped, land the import at the
        // centre of the *current viewport*: the import service has no
        // placement fallback of its own, so nodes would otherwise keep
        // their intrinsic (document-origin) position, which is off-screen
        // whenever the camera is panned away from origin.
        const hasPosition = event.position.x !== 0 || event.position.y !== 0;
        let dropWorld = hasPosition ? computeDropWorld(event.position.x, event.position.y) : null;
        if (!dropWorld) {
          const rect = contentCanvasRef.current?.getBoundingClientRect();
          if (rect) {
            dropWorld = computeDropWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
          }
        }
        const files: { name: string; data: Uint8Array | string }[] = [];
        for (const path of event.paths) {
          try {
            const bytes = await platform.readFileBytes(path);
            const name = path.split(/[/\\]/).pop() ?? path;
            if (name.toLowerCase().endsWith('.svg')) {
              files.push({ name, data: new TextDecoder().decode(bytes) });
            } else {
              files.push({ name, data: bytes });
            }
          } catch (err) {
            editorRef.current.announce(
              `Could not read dropped file: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
        await importDroppedFiles(files, dropWorld, maskTargetId);
      })
      .then((un) => {
        if (cancelled) {
          un();
        } else {
          unlisten = un;
        }
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [computeDropWorld, importDroppedFiles, updateMaskFileDropTarget]);

  const gridSize = Math.max(4, 24 * state.zoom);

  const canvasDropClass = isCanvasDropOver ? ' editor-canvas--dnd-over' : '';

  const setCombinedRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDroppableRef(el);
      if (canvasContainerRef) {
        (canvasContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
      }
    },
    [setDroppableRef, canvasContainerRef],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu?.({ x: e.clientX, y: e.clientY });
    },
    [onContextMenu],
  );

  const activePage = state.document.pages?.find((p) => p.id === state.document.activePageId);
  const artboardRect = activePage
    ? { x: 0, y: 0, w: activePage.width, h: activePage.height }
    : null;

  const stubRemoteCursors = collab.users.slice(0, 2).map((u, i) => ({
    userId: u.id,
    x: 120 + i * 80,
    y: 120 + i * 40,
  }));

  return (
    <section
      ref={setCombinedRef}
      id="editor-main"
      tabIndex={-1}
      className={`editor-canvas gpu-layer${isDragOver ? ' editor-canvas--drag-over' : ''}${canvasDropClass}`}
      aria-label="Canvas"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleContextMenu}
    >
      {/* Zoom-aware dot grid layer */}
      <div
        className="editor-canvas__grid-layer"
        style={{
          backgroundImage: `radial-gradient(circle, var(--color-border-subtle) ${Math.max(0.5, 1 * state.zoom)}px, transparent ${Math.max(0.5, 1 * state.zoom)}px)`,
          backgroundSize: `${gridSize}px ${gridSize}px`,
        }}
      />
      {/* Pixel grid overlay (1px lines at 1:1 zoom) */}
      {state.pixelGridEnabled &&
        state.zoom >= (state.document.gridSettings?.pixelGrid?.zoomThreshold ?? 4) && (
          <div
            className="editor-canvas__pixel-grid"
            style={{
              backgroundImage: [
                'linear-gradient(var(--color-border-subtle) 1px, transparent 1px)',
                'linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
              ].join(', '),
              backgroundSize: `${state.zoom}px ${state.zoom}px`,
              opacity: 0.5,
            }}
          />
        )}
      <canvas
        ref={contentCanvasRef}
        tabIndex={0}
        aria-roledescription="Design canvas"
        aria-label="Design canvas"
        aria-describedby="strata-canvas-announcer-polite"
        data-testid="editor-canvas"
        className="editor-canvas__content-layer"
        style={{ cursor }}
        onFocus={handleCanvasFocus}
        onBlur={handleCanvasBlur}
        onKeyDown={input.handleKeyDown}
        onKeyUp={input.handleKeyUp}
        onDoubleClick={input.handleDoubleClick}
        onPointerDown={input.handlePointerDown}
        onPointerMove={input.handlePointerMove}
        onPointerUp={input.handlePointerUp}
        onPointerCancel={input.handlePointerCancel}
        onPointerLeave={input.onPointerLeave}
      />
      <canvas
        ref={overlayCanvasRef}
        className="editor-canvas__overlay-layer"
        data-testid="canvas-overlay"
      />
      <CanvasOverlays
        contentCanvasRef={contentCanvasRef}
        announcerRef={announcer}
        zoom={state.zoom}
        pan={state.pan}
        cameraRotation={state.cameraRotation}
        tool={state.tool}
        selection={state.selection}
        document={state.document}
        canvasMode={state.canvasMode}
        gridOverlayMode={state.gridOverlayMode}
        colorBlindnessView={state.colorBlindnessView}
        guidesVisible={state.guidesVisible}
        bleedGuidesVisible={state.bleedGuidesVisible}
        layoutGridVisible={state.layoutGridVisible}
        selectedGuideId={state.selectedGuideId}
        unitType={state.unitType}
        rulerMode={state.rulerMode}
        collabUsers={collab.users}
        stubRemoteCursors={stubRemoteCursors}
        snapGuides={snapGuides}
        nodeEditTargetId={nodeEditTargetId}
        nodeEditSelectedAnchors={nodeEditSelectedAnchors}
        textEditTargetId={textEditTargetId}
        setTextEditTargetId={setTextEditTargetId}
        setNodeEditTargetId={setNodeEditTargetId}
        warpMesh={warpMesh}
        setWarpMesh={setWarpMesh}
        hoveredNode={hoveredNode}
        canvasSize={canvasSize}
        cropTool={tm.current?.getTool<CropTool>('crop') ?? null}
        perspectiveTool={tm.current?.getTool<PerspectiveTool>('perspective') ?? null}
        buildToolCtx={buildToolCtx}
        renameDialog={renameDialog}
        setRenameDialog={setRenameDialog}
        renameDialogRef={renameDialogRef}
        renameInputRef={renameInputRef}
        artboardRect={artboardRect}
        pixelProbe={pixelProbe}
      />
      {deepSelectionCandidates && (
        <TouchCandidateMenu
          worldX={deepSelectionCandidates.worldX}
          worldY={deepSelectionCandidates.worldY}
          screenX={deepSelectionCandidates.screenX}
          screenY={deepSelectionCandidates.screenY}
          candidates={deepSelectionCandidates.candidates}
          onSelect={(nodeId) => {
            const e = editorRef.current;
            e.setSelection(nodeId);
            setDeepSelectionCandidates(null);
          }}
          onEnterContainer={(nodeId) => {
            const e = editorRef.current;
            e.enterIsolation(nodeId);
            e.setSelection(nodeId);
            setDeepSelectionCandidates(null);
          }}
          onClose={() => setDeepSelectionCandidates(null)}
        />
      )}
      {/* Empty canvas guidance — shown only when document has no content */}
      {state.document.rootChildren.length === 0 &&
        !isDragOver &&
        (() => {
          const empty = getEmptyStateContent(state.workspaceMode);
          return (
            <div className="editor-canvas__empty-state" role="status" aria-label="Empty canvas">
              <p className="editor-canvas__empty-state-title">{empty.title}</p>
              <div className="editor-canvas__empty-state-shortcuts">
                {empty.shortcuts.map((s) => (
                  <span key={s.key}>
                    <span className="editor-canvas__empty-state-key">{s.key}</span>
                    {s.label}
                  </span>
                ))}
              </div>
              <p className="editor-canvas__empty-state-hint">{empty.hint}</p>
            </div>
          );
        })()}
    </section>
  );
}
