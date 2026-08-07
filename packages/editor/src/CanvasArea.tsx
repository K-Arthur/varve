// COMPLEXITY: ~780 — Extracted inputPipeline (~200 paths), overlayManager
// (~200 paths), toolDispatcher (~50 paths). Remaining complexity is in
// drawContent (~400 paths) and buildToolCtx (~120 paths). Next step: extract
// drawContent into renderPipeline.ts and buildToolCtx into toolContext.ts.
/**
 * Canvas area — the main drawing surface.
 *
 * Architecture: ToolManager routes raw pointer/keyboard events to per-tool
 * state machines. ONE set of pointer handlers on the canvas delegates to
 * toolManager.activeTool.onPointerX(). No global "create rectangle" path.
 *
 * Research basis: MDN Pointer Events, MDN Canvas DPR scaling,
 *                 ToolManager pattern from Figma/Penpot architecture.
 */

import { useDroppable } from '@dnd-kit/core';
import { type CompositorBackend, createCompositorBackend } from '@varve/compositor';
import {
  adjustmentsToFilters,
  applyBackgroundBlurBackdrop,
  applyChromaticAberration,
  applyFilterWithCompositing,
  applyGlassMaterialBackdrop,
  applyGlitch,
  applyLayerBlur,
  applyStyleOverrides,
  CompositeCanvas,
  computeScreenBounds,
  createEngine,
  type Engine,
  type EngineColor,
  type SceneNode as EngineNode,
  fitRasterDimensions,
  gaussianBlurSeparable,
  getFontRegistry,
  getImageCache,
  mapBlendMode,
  prewarmWasmEngine,
  type ReplayTarget,
  renderEnhancedMask,
  replayIr,
  traceSceneNodeOutline,
} from '@varve/engine';
import { type ImportFileInput, ImportService } from '@varve/import';
import {
  addNode,
  applyBindingsToNode,
  buildAllVariantCaches,
  buildParentIndexMap,
  buildVariableDependencyMap,
  canBeClipMaskSource,
  createVariableStore,
  type Document,
  getChangedVariableIds,
  getEffectiveNode,
  getGuidesForPage,
  isContainer,
  isImageShape,
  isWarpedContainer,
  makeRasterLayerNode,
  multipageRootNodes,
  type NodeId,
  nextNodeId,
  resolveAdjustmentScope,
  resolveAllStyles,
  type SceneNode,
  walkNodes,
} from '@varve/scene';
import {
  type Camera,
  computeFloatingOrigin,
  isWorldRectInViewport,
  managedColorToCss,
  screenToWorld,
  worldToScreen,
} from '@varve/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeProfile, resetProfile } from './canvas/adaptiveProfile';
import {
  applyEditorCameraToCtx,
  toCamera as editorToCamera,
  viewportWorldRect,
} from './canvas/cameraState';
import {
  resizeCanvasBackingStore,
  subscribeToCanvasContextLifecycle,
  subscribeToDevicePixelRatio,
} from './canvas/canvasSurface';
import { canCullDescendantsWithContainerBounds } from './canvas/containerCulling';
import { computeDirtyPruneDecision, rectsIntersectAny } from './canvas/dirtyQuery';
import {
  DirtyRegionRecorder,
  type PaintedSurfaceIdentity,
  type RedrawReason,
  resolveFullRedrawReason,
  resolveRedrawReason,
  surfaceMatchesBackingStore,
} from './canvas/dirtyRegion';
import { computeFrameDirtyRegion } from './canvas/dirtyRegionMerge';
import { expandReplayList } from './canvas/dirtyReplay';
import { EngineNodeMemo } from './canvas/engineNodeMemo';
import { parseGridTemplate } from './canvas/gridTemplate';
import { useCanvasInputs } from './canvas/inputPipeline';
import { computeInvalidationPlan } from './canvas/invalidationPlan';
import { useOverlayDraw } from './canvas/overlayManager';
import {
  openFullRedraw,
  openMultiRectPartialClip,
  openUnionPartialClip,
} from './canvas/partialPaint';
import {
  beginContentFrame,
  beginInteractionSpan,
  cancelCanvasFrame,
  createCanvasFrameKey,
  createNodeWorkCounters,
  createRedrawCoordinator,
  enableDrawDiagnostics,
  endFrameTiming,
  type FrameInvalidation,
  getAdaptiveCacheLimits,
  getAverageFrameTime,
  getMemoryBudgets,
  getOverBudgetCount,
  installPerfDiagnosticsHandle,
  isSnapMetricsEnabled,
  type RedrawCoordinator,
  type RedrawReason as RedrawCoordinatorReason,
  recordFrame,
  recordMergedDirty,
  recordNodeWork,
  recordPruneScreenRects,
  recordSnapMetrics,
  registerRedrawCoordinator,
  resolveDirtyScreenRect,
  scheduleCanvasFrame,
  setApplyFixtureHandler,
  startFrameTiming,
} from './canvas/perfRuntime';
import { drawPageDecorations, tryPresentWorkerFrame } from './canvas/presentWorkerFrame';
import { NodeHashMemo, SubtreeIrCache } from './canvas/subtreeIrCache';
import { getToolManager } from './canvas/toolDispatcher';
import { appearancePaddingWorld, expandRect, nodeVisualWorldBounds } from './canvas/visualBounds';
import { TouchCandidateMenu } from './components/Breadcrumb/TouchCandidateMenu';
import { CanvasOverlays } from './components/CanvasOverlays';
import {
  type EditorState,
  nodeWorldBoundsFn,
  setStartTextEditingHandler,
  useEditor,
} from './context';
import { LEGACY_FILE_MIME, VARVE_FILE_MIME } from './dnd-types';
import { collectFilesFromDataTransfer } from './dropUtils';
import { HitTestEngine } from './hitTest/HitTestEngine';
import { useCollabPresence } from './hooks/useCollabPresence';
import { type CropState, commitImageCropExtended } from './imageCrop';
import { applyPropertyPath } from './propertyPath';
import {
  closeImageBitmapMap,
  collectImageBitmaps,
  createRenderWorkerHost,
  disposeWorkerFrame,
  isStaleResponse,
  type RenderWorkerHost,
  sceneCanUseWorkerRenderer,
  sceneNeedsStructuralCompositing,
  sceneNodeToEngineNode,
  setCompositorDiagnostics,
  workerBitmapDelta,
} from './render/canvasRenderAdapter';
import { decorateMockupIr, MockupSurfaceCache } from './render/mockup/mockupIr';
import {
  collectMasterOffsets,
  offsetWorldBounds,
  offsetWorldTransform,
} from './scene/masterOffsets';
import {
  type FrameSpatialIndex,
  getOrCreateFrameSpatialIndex,
  getOrCreateSpatialIndex,
  queryRect,
  type SpatialIndex,
  updateSpatialIndexNodes,
} from './scene/spatialIndex';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateNodes,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import { loadSettings } from './settings';
import { sampleTimelineAt } from './timeline/TimelineSampler';
import type { DraftShape, ToolContext } from './tools';
import type { CropTool } from './tools/CropTool';
import { collectSourceEvents } from './tools/inputNormalizer';
import type { RefineMaskTool } from './tools/RefineMaskTool';
import {
  createSnapSession,
  filterSnapTargets,
  pageSnapTargets,
  type SnapGuide,
  type SnapSession,
  snapPosition,
  snapTargetSearchRect,
} from './tools/snapping';
import { applyWarpToSelection } from './warp/warpActions';
import {
  evaluateWarpedContainerItems,
  warpedContainerWorldBounds,
} from './warp/warpContainerRender';

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

let _showOriginalBgNodeId: string | null = null;

export function toEngineNode(node: SceneNode, doc: Document): EngineNode {
  return sceneNodeToEngineNode(
    node,
    {
      showOriginalBackgroundNodeId: _showOriginalBgNodeId,
      useMaskRenderProxy: true,
    },
    doc,
  );
}

function subtreeEffectPadding(document: Document, rootIds: readonly NodeId[]): number {
  let padding = 2;
  const stack = [...rootIds];
  while (stack.length > 0) {
    const node = document.nodes[stack.pop()!];
    if (!node) continue;
    if ('effects' in node && node.effects) {
      for (const effect of node.effects) {
        if (!effect.visible) continue;
        if (effect.type === 'dropShadow') {
          padding = Math.max(
            padding,
            Math.abs(effect.x) + Math.abs(effect.y) + effect.blur * 3 + effect.spread,
          );
        } else if (effect.type === 'outerGlow') {
          padding = Math.max(padding, effect.blur * 3 + effect.spread);
        } else if (effect.type === 'layerBlur') {
          padding = Math.max(padding, effect.radius * 3);
        } else if (effect.type === 'chromaticAberration') {
          const intensity = effect.intensity ?? 1;
          const o = effect.offsets;
          padding = Math.max(
            padding,
            Math.ceil(
              Math.max(
                Math.abs(o.redX),
                Math.abs(o.redY),
                Math.abs(o.greenX),
                Math.abs(o.greenY),
                Math.abs(o.blueX),
                Math.abs(o.blueY),
              ) * intensity,
            ),
          );
        } else if (effect.type === 'glitch') {
          const o = effect.channelShift;
          padding = Math.max(
            padding,
            Math.ceil(
              Math.max(
                effect.strength,
                effect.blockStrength,
                Math.abs(o.redX),
                Math.abs(o.redY),
                Math.abs(o.greenX),
                Math.abs(o.greenY),
                Math.abs(o.blueX),
                Math.abs(o.blueY),
              ),
            ),
          );
        }
      }
    }
    if ('children' in node) stack.push(...node.children);
  }
  return Math.ceil(padding);
}

/**
 * Render an inner shadow or inner glow effect on a pre-flattened group canvas.
 * Uses the same silhouette-difference technique as paintInsetEffect in replay.ts
 * but operates on a CompositeCanvas containing the full group's rendered content.
 */
function renderGroupInsetEffect(
  effect: {
    type: 'innerShadow' | 'innerGlow';
    blur: number;
    spread: number;
    color: import('@varve/engine').EngineColor;
    opacity: number;
    blendMode: import('@varve/scene').BlendMode;
  },
  gCanvas: CompositeCanvas,
  renderScale: number,
  mode: 'shadow' | 'glow',
): void {
  const w = gCanvas.width;
  const h = gCanvas.height;
  if (w <= 0 || h <= 0) return;

  const blur = effect.blur * renderScale;
  const spread = effect.spread * renderScale;
  const ctx = gCanvas.ctx;

  // Get full silhouette of the group content
  const silhouetteData = ctx.getImageData(0, 0, w, h);

  // Create an offscreen canvas for the inset effect
  const insetCanvas = document.createElement('canvas');
  insetCanvas.width = w;
  insetCanvas.height = h;
  const insetCtx = insetCanvas.getContext('2d');
  if (!insetCtx) return;

  if (mode === 'shadow') {
    // Inner shadow: offset the silhouette and subtract from original
    // Draw full silhouette first
    insetCtx.putImageData(silhouetteData, 0, 0);
    // Apply shadow color via source-in
    insetCtx.globalCompositeOperation = 'source-in';
    const { r, g, b } = 'r' in effect.color ? effect.color : { r: 0, g: 0, b: 0 };
    insetCtx.fillStyle = `rgba(${r},${g},${b},1)`;
    insetCtx.fillRect(0, 0, w, h);
    insetCtx.globalCompositeOperation = 'source-over';

    // Blur the solid silhouette
    const blurData = insetCtx.getImageData(0, 0, w, h);
    if (blur > 0) {
      const blurred = gaussianBlurSeparable(blurData, Math.max(1, blur));
      insetCtx.putImageData(blurred, 0, 0);
    }

    // Cut hole where original content was
    insetCtx.globalCompositeOperation = 'destination-out';
    insetCtx.putImageData(silhouetteData, 0, 0);
    insetCtx.globalCompositeOperation = 'source-over';

    // Composite the inset shadow onto the group canvas with effect opacity
    const insetImage = insetCtx.getImageData(0, 0, w, h).data;
    const dst = ctx.getImageData(0, 0, w, h);
    const opacity = effect.opacity ?? 1;
    for (let i = 3; i < dst.data.length; i += 4) {
      const sa = insetImage[i]! / 255;
      dst.data[i - 3] = dst.data[i - 3]! * (1 - sa * opacity);
      dst.data[i - 2] = dst.data[i - 2]! * (1 - sa * opacity);
      dst.data[i - 1] = dst.data[i - 1]! * (1 - sa * opacity);
      dst.data[i] = Math.max(dst.data[i]!, insetImage[i]! * opacity);
    }
    ctx.putImageData(dst, 0, 0);
  } else {
    // Inner glow: shrink silhouette, blur the ring between original and shrunken
    const shrinkPx = Math.max(1, Math.round(spread));
    // Draw full silhouette
    insetCtx.putImageData(silhouetteData, 0, 0);
    // Erode by spread (darken at edges)
    if (spread > 0) {
      const erodeCanvas = document.createElement('canvas');
      erodeCanvas.width = w;
      erodeCanvas.height = h;
      const erodeCtx = erodeCanvas.getContext('2d');
      if (erodeCtx) {
        erodeCtx.putImageData(silhouetteData, 0, 0);
        erodeCtx.filter = `blur(${shrinkPx}px)`;
        erodeCtx.globalCompositeOperation = 'source-over';
        erodeCtx.drawImage(insetCanvas, 0, 0);
        const erodeResult = erodeCtx.getImageData(0, 0, w, h);
        insetCtx.putImageData(erodeResult, 0, 0);
      }
    }
    // Colorize to glow color
    insetCtx.globalCompositeOperation = 'source-in';
    const { r: gr, g: gg, b: gb } = 'r' in effect.color ? effect.color : { r: 200, g: 200, b: 255 };
    insetCtx.fillStyle = `rgba(${gr},${gg},${gb},1)`;
    insetCtx.fillRect(0, 0, w, h);
    insetCtx.globalCompositeOperation = 'source-over';

    // Blur
    const gData = insetCtx.getImageData(0, 0, w, h);
    if (blur > 0) {
      const blurred = gaussianBlurSeparable(gData, Math.max(1, blur));
      insetCtx.putImageData(blurred, 0, 0);
    }

    // Subtract original silhouette (glow only where content exists)
    insetCtx.globalCompositeOperation = 'destination-in';
    insetCtx.putImageData(silhouetteData, 0, 0);
    insetCtx.globalCompositeOperation = 'source-over';

    // Composite
    const glowImage = insetCtx.getImageData(0, 0, w, h);
    const dst = ctx.getImageData(0, 0, w, h);
    const opacity = effect.opacity ?? 1;
    for (let i = 0; i < dst.data.length; i += 4) {
      const ga = glowImage.data[i + 3]! / 255;
      dst.data[i] = dst.data[i]! * (1 - ga * opacity) + glowImage.data[i]! * ga * opacity;
      dst.data[i + 1] =
        dst.data[i + 1]! * (1 - ga * opacity) + glowImage.data[i + 1]! * ga * opacity;
      dst.data[i + 2] =
        dst.data[i + 2]! * (1 - ga * opacity) + glowImage.data[i + 2]! * ga * opacity;
      dst.data[i + 3] = Math.max(dst.data[i + 3]!, glowImage.data[i + 3]!);
    }
    ctx.putImageData(dst, 0, 0);
  }
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
  const handleCanvasFocus = useCallback(() => {
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    const section = canvas.closest('.editor-canvas') as HTMLElement | null;
    if (!section) return;
    if (canvas.matches(':focus-visible')) {
      section.setAttribute('data-canvas-focus-visible', 'true');
    }
  }, []);

  const handleCanvasBlur = useCallback(() => {
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
  const [dropTargetFrameId, setDropTargetFrameId] = useState<NodeId | null>(null);
  const [maskDropTargetId, setMaskDropTargetId] = useState<NodeId | null>(null);
  const maskDropTargetRef = useRef<NodeId | null>(null);
  // Incremented by the image cache subscriber so drawContent re-runs after async image loads.
  const [imageCacheStamp, setImageCacheStamp] = useState(0);
  // Independent stamp for font loads — previously both used imageCacheStamp, so a font
  // loading during an image-heavy frame could clear the pending image-laden state.
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
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => subscribeToDevicePixelRatio(setDisplayDpr), []);

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
      // The backend resolves asynchronously; drawContent() may have already run
      // (and silently no-op'd via optional chaining) with compositorRef still null.
      // Force one redraw now that a backend is actually available.
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

  const tm = useRef<ReturnType<typeof getToolManager> | null>(null);
  if (!tm.current) {
    tm.current = getToolManager();
  }

  // Sync active tool to ToolManager when state.tool changes
  useEffect(() => {
    if (tm.current) {
      const ctx = buildToolCtx({} as PointerEvent);
      tm.current.setTool(state.tool, ctx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.tool]);

  // Push live refine-mask brush options into the active tool instance.
  useEffect(() => {
    if (state.tool !== 'refineMask' || !tm.current) return;
    const tool = tm.current.getTool<RefineMaskTool>('refineMask');
    tool?.setOptions(state.refineMaskOptions);
  }, [state.refineMaskOptions, state.tool]);

  useEffect(() => {
    if (state.tool !== 'trimapEdit' || !tm.current) return;
    const tool = tm.current.getTool<import('./tools/TrimapEditTool').TrimapEditTool>('trimapEdit');
    tool?.setOptions(state.trimapEditOptions);
  }, [state.trimapEditOptions, state.tool]);

  // Sync brush settings to the paint/eraser tool.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'paint' && state.tool !== 'eraser') return;
    const paintTool = tm.current.getTool<import('./tools/PaintTool').PaintTool>('paint');
    const eraserTool = tm.current.getTool<import('./tools/PaintTool').PaintTool>('eraser');
    const active = state.tool === 'eraser' ? eraserTool : paintTool;
    active?.updatePresetFromSettings(state.brushSettings);
  }, [state.brushSettings, state.tool]);

  // Sync brush settings to the smudge tool.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'smudge') return;
    const smudgeTool = tm.current.getTool<import('./tools/SmudgeTool').SmudgeTool>('smudge');
    smudgeTool?.updatePresetFromSettings(state.brushSettings);
  }, [state.brushSettings, state.tool]);

  // Sync stroke smoothing to the pencil tool's stabilizer. Reuses the same
  // brushSettings.smoothing field the raster brush already exposes, so the
  // Inspector's existing Smoothing control drives vector pencil strokes too.
  useEffect(() => {
    if (!tm.current) return;
    if (state.tool !== 'pencil') return;
    const pencilTool = tm.current.getTool<import('./tools/PencilTool').PencilTool>('pencil');
    pencilTool?.setStabilization(state.brushSettings.smoothing);
  }, [state.brushSettings.smoothing, state.tool]);

  useEffect(() => {
    if (!tm.current) return;
    const crop = tm.current.getTool<CropTool>('crop');
    if (!crop) return;
    crop.setCommitHandler((cropState: CropState) => {
      const id = crop.getNodeId();
      if (!id) return;
      editor.updateDoc((doc) => commitImageCropExtended(doc, id, cropState));
      editor.announce('Crop applied');
    });
    return () => crop.setCommitHandler(null);
  }, [editor, state.tool]);

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

  // Re-render the canvas whenever async fonts finish loading.
  // Without this, dynamic fonts (Google Fonts, FontFace) render in the
  // fallback typeface on the first frame and never update.
  // Uses its own stamp (not imageCacheStamp) so font loading never clears
  // the pending image-laden state on a frame.
  useEffect(() => {
    const unsub = getFontRegistry().subscribe(() => {
      setFontLoadStamp((n) => n + 1);
      requestRedrawRef.current?.();
    });
    return unsub;
  }, []);

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
    sourceEvents = collectSourceEvents(ev, true),
  ): ToolContext {
    const s = stateRef.current;
    const e = editorRef.current;
    const eng = engineRef.current;
    return {
      document: s.document,
      selection: s.selection,
      zoom: s.zoom,
      pan: s.pan,
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      pointerType: (ev.pointerType as 'mouse' | 'pen' | 'touch') ?? 'mouse',
      pointerPressure: ev.pressure ?? 0,
      tiltX: ev.tiltX ?? 0,
      tiltY: ev.tiltY ?? 0,
      twist: ev.twist ?? 0,
      tangentialPressure:
        (ev as PointerEvent & { tangentialPressure?: number }).tangentialPressure ?? 0,
      pointerWidth: Math.max(0, (ev as PointerEvent & { width?: number }).width ?? 1),
      pointerHeight: Math.max(0, (ev as PointerEvent & { height?: number }).height ?? 1),
      altitudeAngle: (ev as PointerEvent & { altitudeAngle?: number }).altitudeAngle ?? Math.PI / 2,
      azimuthAngle: (ev as PointerEvent & { azimuthAngle?: number }).azimuthAngle ?? 0,
      hasCoalescedEvents: typeof ev.getCoalescedEvents === 'function',
      hasPredictedEvents: typeof ev.getPredictedEvents === 'function',
      sourceEvents,
      foregroundColor: s.foregroundColor,
      maskPreviewMode: s.maskPreviewMode,
      setMaskPreviewMode: (mode) => e.setMaskPreviewMode(mode),
      snapEnabled: s.snapEnabled,
      snapGrid: s.snapGrid,
      isolatedNodeId: s.isolatedNodeId,
      enterIsolation: (nodeId) => e.enterIsolation(nodeId),
      exitIsolation: () => e.exitIsolation(),

      createShapeAt: (world, size, parentId, pathPoints, pathClosed) =>
        e.createShapeAt(world, size, parentId, pathPoints, pathClosed),
      createTextNodeAt: (world, size, parentId, text) => {
        pendingAutoTextEditRef.current = true;
        e.createTextNodeAt(world, size, parentId, text);
      },
      setSelection: (id) => e.setSelection(id),
      toggleSelection: (id, additive) => e.toggleSelection(id, additive),
      isSelected: (id) => e.isSelected(id),
      setNodePosition: (id, x, y) => e.setNodePosition(id, x, y),
      setNodeSize: (id, w, h) => e.setNodeSize(id, w, h),
      updateNode: (id, updater) => e.updateNode(id, updater),
      setActivePage: (pageId) => e.setActivePage(pageId),
      movePageOnPasteboard: (pageId, x, y) => e.movePageOnPasteboard(pageId, x, y),
      resizePage: (pageId, w, h) => e.resizePage(pageId, w, h),
      removeSelected: () => e.removeSelected(),
      duplicateSelected: () => e.duplicateSelected(),
      reparentNode: (id, newParentId, toIndex) => e.reparentNode(id, newParentId, toIndex),
      setCamera: (camera) => commitCamera(camera),
      setPan: (p) => e.setPan(p),
      setZoom: (z) => e.setZoom(z),
      announce: (msg) => e.announce(msg),
      announceSelection: (selected) => e.announceSelection(selected),
      announceOperation: (op, result) => e.announceOperation(op, result),
      setDraft,
      rootNodes: () => rootNodes(),
      getNode: (id) => s.document.nodes[id],

      // FIX: `canvasToWorld` now accepts viewport-relative clientX/Y and
      // subtracts the canvas bounding rect internally. This fixes the
      // placement bug where all drawing tools passed raw clientX/Y without
      // accounting for the canvas element's screen offset below the menubar.
      // See BaseTool.ts:66-67.
      canvasToWorld: (cx, cy) => {
        const rect = contentCanvasRef.current?.getBoundingClientRect();
        return e.canvasToWorld(cx - (rect?.left ?? 0), cy - (rect?.top ?? 0));
      },
      worldToCanvas: (wx, wy) => e.worldToCanvas(wx, wy),
      canvasDeltaToWorld: (dx, dy) => e.canvasDeltaToWorld(dx, dy),

      setPointerCapture: (pointerId) => {
        try {
          const el = contentCanvasRef.current;
          if (el) el.setPointerCapture(pointerId);
        } catch (err) {
          // If this throws, BaseTool.onPointerDown aborts before setting
          // drag.kind = 'dragging', silently breaking every drag-to-create
          // tool (pointermove is a no-op while drag.kind stays 'idle').
          // Surface it instead of failing silently.
          if (typeof console !== 'undefined') {
            console.warn('[Strata] setPointerCapture failed:', err);
          }
        }
      },
      releasePointerCapture: (pointerId) => {
        try {
          const el = contentCanvasRef.current;
          if (el) el.releasePointerCapture(pointerId);
        } catch {
          // Pointer may have been released by the browser already (e.g. blur
          // during paste). Silently ignore — no functional impact.
        }
      },

      findContainingFrame: (world) => e.findContainingFrame(world, frameIndexRef.current),
      setDropTargetFrame: setDropTargetFrameId,
      nodeWorldBounds: (n) =>
        getCachedWorldBounds(transformCacheRef.current, s.document, n.id) ?? nodeWorldBoundsFn(n),

      engine: eng,
      canvasElement: contentCanvasRef.current,
      hitTest: (world) => e.hitTestNode(world),
      hitTestWithPolicy: (world, policyName) => e.hitTestNodeWithPolicy(world, policyName),

      beginTransaction: () => e.beginTransaction(),
      commitTransaction: () => e.commitTransaction(),
      abortTransaction: () => e.abortTransaction(),

      setTool: (id) => e.setTool(id),
      setWarpEdit: (target) => e.setWarpEdit(target),
      applyWarpToSelection: (presetKind) => applyWarpToSelection(e, presetKind),
      setFocusedNode: (id) => e.setFocusedNode(id),
      clearFocusedNode: () => e.clearFocusedNode(),
      focusNextSelectedNode: () => e.focusNextSelectedNode(),
      focusPreviousSelectedNode: () => e.focusPreviousSelectedNode(),
      nodeEditTargetId,
      setNodeEditTargetId,
      setNodeEditSelectedAnchors,
      setTextEditTargetId,
      setTableEdit: (state) => e.setTableEdit(state),

      snapPosition: (bounds, _targets) => {
        if (!s.snapEnabled) {
          snapSessionRef.current = createSnapSession();
          return { x: bounds.x, y: bounds.y, guides: [] };
        }
        const snapMetricsOn = isSnapMetricsEnabled();
        const snapStart = snapMetricsOn ? performance.now() : 0;
        const finishSnapPrefilter = beginInteractionSpan('snap.prefilter');

        // D-02: Spatial + hierarchical filtering of snap targets
        const doc = stateRef.current.document;
        let snapIndex = snapIndexRef.current;
        if (!snapIndex || snapIndex.documentId !== doc.id) {
          snapIndex = {
            index: getOrCreateSpatialIndex(doc, null),
            parentIndex: buildParentIndexMap(doc),
            documentId: doc.id,
            indexedNodeCount: Object.keys(doc.nodes).length,
          };
          snapIndexRef.current = snapIndex;
        }
        const queryStart = snapMetricsOn ? performance.now() : 0;
        const nearbyIds = queryRect(snapIndex.index, snapTargetSearchRect(bounds, s.zoom));
        const queryDurationMs = snapMetricsOn ? performance.now() - queryStart : 0;
        const nearbyBoundsWithIds: Array<{
          nodeId: string;
          bounds: { x: number; y: number; w: number; h: number };
        }> = [];
        for (const nodeId of nearbyIds) {
          const node = doc.nodes[nodeId];
          if (!node) continue;
          // Semantic filter: hidden nodes are not visible, so snapping to their
          // edges would produce invisible feedback — exclude them as candidates.
          if (node.visible === false) continue;
          // Read through the transform cache rather than recomputing. This runs
          // on every pointer move of a drag, and the uncached nodeWorldBounds
          // re-derives a group's bounds by unioning all of its children every
          // time — a 932-node drag profile attributed 7.6% of CPU to
          // groupWorldBounds reached from here. The cache invalidates exactly
          // the nodes an edit touched, so during a drag only the dragged node
          // recomputes and the surrounding snap targets stay cached.
          const b =
            getCachedWorldBounds(transformCacheRef.current, doc, node.id) ??
            nodeWorldBoundsFn(node);
          if (b) nearbyBoundsWithIds.push({ nodeId: node.id, bounds: b });
        }
        const parentIdx = snapIndex.parentIndex;
        const selection = stateRef.current.selection;
        const draggedId = selection[0] ?? '';
        const filtered = filterSnapTargets(
          bounds,
          { zoom: s.zoom },
          nearbyBoundsWithIds,
          parentIdx,
          draggedId,
          // Semantic filter: every object moving in the same selection is an
          // invalid target — snapping a multi-selection against its own members
          // both wastes evaluation and produces incorrect guides.
          selection.length > 1 ? new Set(selection) : undefined,
        );
        finishSnapPrefilter({
          indexedCandidates: snapIndex.indexedNodeCount,
          broadPhaseCandidates: nearbyIds.size,
          semanticCandidates: filtered.length,
        });

        // Page trim snap targets (M6): every placed page's trim bounds, so
        // nodes snap to page edges on any page of the pasteboard — not only
        // the active page's trim at the origin.
        const pageBoundsTargets = pageSnapTargets(doc);
        if (draggedId) {
          const parentId = parentIdx.get(draggedId);
          if (parentId) {
            const parentNode = doc.nodes[parentId];
            if (parentNode && 'w' in parentNode) {
              pageBoundsTargets.push({
                x: 0,
                y: 0,
                w: (parentNode as { w: number }).w,
                h: (parentNode as { h: number }).h,
              });
            }
          }
        }

        let layoutGridStep: number | undefined;
        if (draggedId) {
          const parentId = parentIdx.get(draggedId);
          if (parentId) {
            const parentNode = doc.nodes[parentId];
            if (parentNode?.kind === 'frame' && parentNode.layoutStyle) {
              const cols = parseGridTemplate(
                parentNode.layoutStyle.gridTemplateColumns ?? '',
                parentNode.w,
              );
              if (cols.length > 0) {
                layoutGridStep =
                  cols[0]! + (parentNode.layoutStyle.columnGap ?? parentNode.layoutStyle.gap ?? 0);
              }
            }
          }
        }

        const allTargets = [...filtered, ...pageBoundsTargets];
        const guideTargets =
          getGuidesForPage(doc, doc.activePageId).map((guide) => ({
            axis: guide.axis,
            position: guide.position,
          })) ?? [];
        const gridConfig =
          s.snapEnabled && s.documentGrid?.snapEnabled ? s.documentGrid : undefined;
        const finishSnapEvaluate = beginInteractionSpan('snap.evaluate');
        const result = snapPosition(
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          allTargets,
          gridConfig,
          undefined,
          {
            zoom: s.zoom,
            session: snapSessionRef.current,
            guideTargets,
            layoutGridStep,
            pixelGridSnap: s.snapEnabled && s.pixelGridSnapEnabled,
          },
        );
        snapSessionRef.current = result.session;
        setSnapGuides(result.guides);
        finishSnapEvaluate({
          finePhaseCandidates: allTargets.length,
          winningX: result.x !== bounds.x,
          winningY: result.y !== bounds.y,
        });
        if (snapMetricsOn) {
          recordSnapMetrics({
            ts: performance.now(),
            sceneObjectCount: snapIndex.indexedNodeCount,
            indexedCandidateCount: snapIndex.indexedNodeCount,
            broadPhaseResultCount: nearbyIds.size,
            semanticFilteredCount: filtered.length,
            finePhaseEvalCount: allTargets.length,
            queryDurationMs,
            evalDurationMs: performance.now() - snapStart,
            winningX: result.x !== bounds.x,
            winningY: result.y !== bounds.y,
          });
        }
        return { x: result.x, y: result.y, guides: result.guides };
      },
      isSnapExcluded: (id: string) => {
        const n = stateRef.current.document.nodes[id];
        return n?.snapExcluded === true;
      },

      getTrimapData: (nodeId) => e.getTrimapData(nodeId),
      setTrimapPreview: (trimap, width, height) => {
        const nodeId = s.selection[0];
        if (nodeId) e.setTrimapData(nodeId, trimap, width, height);
      },
      commitTrimapEdit: (trimap) => {
        const nodeId = s.selection[0];
        if (!nodeId) return;
        const entry = e.getTrimapData(nodeId);
        if (entry) e.setTrimapData(nodeId, trimap, entry.width, entry.height);
      },
      applySam2Segmentation: (params) => e.applySam2Segmentation(params),
      cancelSam2Segmentation: () => e.cancelSam2Segmentation(),
      commitRasterMask: (nodeId, dataUrl, width, height) => {
        import('./backgroundRemoval/commitRasterMask').then(({ commitRasterMask }) => {
          e.updateDoc((doc) => commitRasterMask(doc, nodeId, { dataUrl, width, height }));
        });
      },
      createRasterLayer: (width, height) => {
        const s2 = stateRef.current;
        const { id, doc: d2 } = nextNodeId(s2.document);
        const layer = makeRasterLayerNode(id, { width, height }, { name: 'Brush Layer' });
        const newDoc = addNode(d2, layer);
        e.updateDoc(() => newDoc);
        return id;
      },
      lastPointerEvent: ev,
      touchMultiSelect: s.touchMultiSelect,
      showDeepSelectionMenu: (world, screenX, screenY) => {
        // Gather all nodes beneath the touch point using touch policy
        const hitEngine = HitTestEngine.withPolicy(stateRef.current.document, 'touchDeepSelect', {
          zoom: stateRef.current.zoom,
          isolatedNodeId: stateRef.current.isolatedNodeId,
        });
        const candidates = hitEngine.findNodesAtPoint(world);
        if (candidates.length > 1) {
          setDeepSelectionCandidates({
            worldX: world.x,
            worldY: world.y,
            screenX,
            screenY,
            candidates: candidates.map((c) => ({
              nodeId: c.nodeId,
              node: c.node,
              depth: 0,
            })),
          });
        }
      },
    };
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
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // Zero-size viewport guard: if the canvas or its container has no layout
    // dimensions (display:none, not-yet-sized grid cell, off-screen mount),
    // bail out. The ResizeObserver will fire when dimensions become available,
    // bumping canvasSize and triggering a new drawContent.
    const vpWidth = parent.clientWidth;
    const vpHeight = parent.clientHeight;
    if (vpWidth === 0 || vpHeight === 0) {
      return;
    }

    const dpr = displayDpr;
    const cssW = vpWidth;
    const cssH = vpHeight;
    resizeCanvasBackingStore(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const eng = engineRef.current;
    if (!eng) return;

    if (drawInFlightRef.current) {
      // A previous draw is still awaiting eng.buildIr()/painting. Don't start
      // an overlapping one — remember to run once more when it finishes so
      // the latest state still gets painted.
      drawPendingRef.current = true;
      return;
    }
    drawInFlightRef.current = true;

    // Suppressed-clean decision, before any scene traversal (was a full
    // visible-list pass with redrawReason 'clean').
    const entry = beginContentFrame({
      coordinator: redrawCoordinatorRef.current!,
      getState: () => stateRef.current,
      imageCacheStamp,
      fontLoadStamp,
      cssW,
      cssH,
      dpr,
      hasPendingPresent: pendingPresentRef.current,
    });
    if (!entry) {
      // The async IIFE never runs for a skipped frame; release the guard.
      drawInFlightRef.current = false;
      return;
    }
    const { coordinator, snapshot: frameSnapshot, decision: frameDecision } = entry;

    const frameStart = startFrameTiming();
    let frameBackend: CompositorBackend | null = null;
    let compositorFrameOpen = false;
    let dirtyClipOpen = false;

    (async () => {
      if (!ctx) return;
      const ctxNN = ctx;
      const s = stateRef.current;
      const doc = s.document;
      _showOriginalBgNodeId = s.showOriginalBgNodeId ?? null;

      let boardColor = sunkenColorRef.current;
      {
        const bg = doc.canvasBackground;
        if (bg) {
          if (bg.space === 'rgb') {
            boardColor = `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${(bg.a / 255).toFixed(3)})`;
          } else {
            try {
              boardColor = managedColorToCss(bg);
            } catch {
              boardColor = sunkenColorRef.current;
            }
          }
        }
      }

      // Present-only path: composite the worker bitmap, nothing else. Page
      // decorations are not part of the worker IR, so they repaint through
      // the paintUnderlays hook between the board fill and the bitmap.
      if (frameDecision.kind === 'present') {
        const presented = tryPresentWorkerFrame({
          ctx,
          canvas,
          boardColor,
          wb: workerBitmapRef.current,
          compositor: compositorRef.current,
          camera: { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation ?? 0 },
          viewport: { width: cssW, height: cssH },
          dpr,
          docVersion: docVersionRef.current,
          frameStart,
          coordinator,
          decision: frameDecision,
          snapshot: frameSnapshot,
          cacheDiag: subtreeIrCacheRef.current.diagnostics(),
          paintUnderlays: (decorCtx) =>
            drawPageDecorations(
              decorCtx,
              doc,
              s,
              { width: cssW, height: cssH },
              {
                themeRevision: s.themeRevision,
                activePageId: doc.activePageId ?? null,
              },
            ),
        });
        if (presented) {
          pendingPresentRef.current = false;
          // The present path repaints the whole surface (board fill + bitmap)
          // and only runs when the bitmap camera equals the current camera, so
          // the backing store now shows this camera in full.
          paintedSurfaceRef.current = {
            zoom: s.zoom,
            panX: s.pan.x,
            panY: s.pan.y,
            rotation: s.cameraRotation ?? 0,
            dpr,
            surfaceW: canvas.width,
            surfaceH: canvas.height,
          };
          return;
        }
      }

      // Shared multipage scene (ADR-0144): walk every visible page's
      // content and backgrounds plus pasteboard/global items, culling pages
      // whose placed trim bounds miss the viewport before they reach the
      // per-node loop. The world rect is the AABB of the viewport corners
      // (over-inclusive under camera rotation — safe for culling).
      const viewportWorld = viewportWorldRect(s, { width: cssW, height: cssH });
      const entries = walkNodes(doc, multipageRootNodes(doc, { viewportWorldRect: viewportWorld }));
      // Master projection offsets (M8, ADR-0132): projected master items
      // render at their page's placement — master roots sit at the pasteboard
      // origin, so the loop applies the containing page's translation.
      const masterOffsets = collectMasterOffsets(doc);
      const nodeWork = createNodeWorkCounters();
      nodeWork.totalSceneNodes = Object.keys(doc.nodes).length;
      nodeWork.candidates = entries.size;
      const cache = transformCacheRef.current;
      // Use parent client dimensions (cssW/cssH) instead of getBoundingClientRect()
      // to avoid forcing a layout recalc on every frame. The canvas is sized to
      // fill its parent, so these are identical to the bounding rect dimensions.
      const vp = { width: cssW, height: cssH };
      const VP_W = cssW;
      const VP_H = cssH;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      const cam = editorToCamera(camState);
      const applyCam = (targetCtx: CanvasRenderingContext2D) =>
        applyEditorCameraToCtx(targetCtx, camState, dpr, vp);
      const hiddenByContainer = new Set<string>();
      const resolvedStyles = doc === state.document ? precomputedStyles : resolveAllStyles(doc);
      // getParent() is O(n) per call; nodeWorldTransform/nodeWorldBounds walk
      // the ancestor chain with it. Build the O(n) parent index lazily — only
      // when the culling loop actually finds a cullable container — so camera
      // moves on flat docs (unchanged doc, no containers) never pay for it.
      let parentIndex: Map<NodeId, NodeId> | undefined;

      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        if (
          isContainer(n) &&
          canCullDescendantsWithContainerBounds(n) &&
          'children' in n &&
          n.children.length > 0
        ) {
          parentIndex ??= buildParentIndexMap(doc);
          const containerBounds = nodeVisualWorldBounds(doc, id, resolvedStyles, parentIndex);
          if (containerBounds && !isWorldRectInViewport(cam, vp, containerBounds)) {
            const queue = [...n.children];
            while (queue.length > 0) {
              const childId = queue.pop()!;
              hiddenByContainer.add(childId);
              const child = doc.nodes[childId];
              if (child && 'children' in child && child.children) {
                queue.push(...child.children);
              }
            }
          }
        }
      }

      nodeWork.rejectedByContainer = hiddenByContainer.size;
      nodeWork.traversalMs = performance.now() - frameStart;

      const dirtyRecorder = dirtyRecorderRef.current;
      dirtyRecorder.reset();
      const frameDirty = computeFrameDirtyRegion({
        previous: lastRenderedDocRef.current,
        next: doc,
        recorder: dirtyRecorderRef.current,
        parentIndex,
        worldToScreen: (wx, wy) => worldToScreen(cam, wx, wy, vp, computeFloatingOrigin(cam, vp)),
        viewportW: VP_W,
        viewportH: VP_H,
      });
      const dirty = frameDirty.dirty;
      const mergedDirty = recordMergedDirty(frameDirty.mergedDirty);
      dirtyRectRef.current = dirty.kind === 'full' ? null : frameDirty.dirtyScreenRect;
      if (frameDirty.fullFallback) nodeWork.fullFallback = true;

      const variantCaches =
        doc === state.document ? precomputedVariantCaches : buildAllVariantCaches(doc);
      const variableStore = doc.variableStore ?? createVariableStore();

      const setupMs = performance.now() - frameStart;
      const preLoopStart = performance.now();

      // One profile per frame (pre-loop) so pruning, worker and paint agree.
      const profile = computeProfile(getAverageFrameTime(), getOverBudgetCount(), entries.size);
      const cacheMultiplier = profile.cacheMultiplier;
      const profileCanUseWorker = profile.enableWorker;

      // Pruning is only safe when the paint path uses a partial redraw and
      // pointless when the worker draws the whole frame anyway.
      const workerWillRender =
        Boolean(renderWorkerRef.current) &&
        !workerFailedRef.current &&
        profileCanUseWorker &&
        sceneCanUseWorkerRenderer(doc, (src) => getImageCache().isLoaded(src)) &&
        !sceneNeedsStructuralCompositing(doc);
      // One shared surface-validity result per frame: the prune gate and the
      // paint gate must agree, or a pruned replay lands on a fully cleared
      // surface and erases every node outside the dirty region.
      const currentSurface: PaintedSurfaceIdentity = {
        zoom: s.zoom,
        panX: s.pan.x,
        panY: s.pan.y,
        rotation: s.cameraRotation ?? 0,
        dpr,
        surfaceW: canvas.width,
        surfaceH: canvas.height,
      };
      const surfaceMatch = surfaceMatchesBackingStore(paintedSurfaceRef.current, currentSurface);
      const pruneDecision = computeDirtyPruneDecision({
        dirtyKind: dirty.kind,
        merged: mergedDirty,
        profileEnablePartialRedraw: profile.enablePartialRedraw,
        rotation: s.cameraRotation ?? 0,
        dirtyScreenRect: dirtyRectRef.current,
        viewportW: VP_W,
        viewportH: VP_H,
        workerWillRender,
        surfaceMatch,
        worldToScreen: (wx: number, wy: number) =>
          worldToScreen(cam, wx, wy, vp, computeFloatingOrigin(cam, vp)),
      });
      const dirtyWorldRects = pruneDecision.worldRects;
      const pruneScreenRects = pruneDecision.screenRects;
      recordPruneScreenRects(pruneScreenRects);

      const nodeIds: string[] = [];
      const flatNodes: EngineNode[] = [];
      const engineMemo = engineNodeMemoRef.current;
      // Counters are cumulative; snapshot them to report per-frame deltas.
      const engineMemoComputesAtStart = engineMemo.computes;
      const engineMemoHitsAtStart = engineMemo.hits;
      // The motion sampler below mutates the produced engine nodes in place, so
      // memoized objects must not be handed out while a timeline is active.
      const canMemoEngineNodes = !s.motion.activeTimelineId;
      engineMemo.beginFrame(
        doc.paints,
        doc.rasterMaskAssets,
        doc.styles,
        s.showOriginalBgNodeId ?? '',
      );
      for (const [id] of entries) {
        const raw = doc.nodes[id];
        if (!raw) continue;
        let n = getEffectiveNode(doc, id, variantCaches) ?? raw;
        if (!n.visible) continue;
        if (n.kind === 'group') continue;
        if (hiddenByContainer.has(id)) continue;
        n = applyBindingsToNode(n, variableStore);
        let world = getCachedWorldTransform(cache, doc, id);
        let worldBounds = getCachedWorldBounds(cache, doc, id);
        const masterOffset = masterOffsets.get(id);
        if (masterOffset) {
          world = offsetWorldTransform(world, masterOffset);
          worldBounds = offsetWorldBounds(worldBounds, masterOffset);
        }
        const styleOverrides = resolvedStyles.get(id);
        // Cull before converting to an engine node. appearancePaddingWorld reads
        // only `strokes`/`effects`; sceneNodeToEngineNode copies both by
        // reference and applyStyleOverrides is the same `{...a, ...b}` merge, so
        // this padding is identical to the post-conversion value it replaces —
        // offscreen nodes now skip the conversion entirely.
        const appearance = applyStyleOverrides(n, styleOverrides);
        const padding = appearancePaddingWorld(appearance, world);
        const visualBounds = worldBounds ? expandRect(worldBounds, padding) : null;
        nodeWork.visibilityTested++;
        if (padding > 0) nodeWork.effectExpanded++;
        if (visualBounds && !isWorldRectInViewport(cam, vp, visualBounds)) {
          nodeWork.rejectedByViewport++;
          continue;
        }
        // Dirty-region-driven visible-list construction: a node whose world
        // render bounds miss every merged dirty rect is rejected outright —
        // the per-rect clip means its pixels cannot change, so replaying it
        // is pure waste (this was the measured 40-89% of replayed nodes).
        if (dirtyWorldRects && visualBounds && !rectsIntersectAny(visualBounds, dirtyWorldRects)) {
          nodeWork.prunableByDirty++;
          nodeWork.rejectedByDirty++;
          continue;
        }

        let engineNode = canMemoEngineNodes ? engineMemo.get(id, n, world) : undefined;
        if (!engineNode) {
          let built = toEngineNode(n, doc);
          if (styleOverrides) built = applyStyleOverrides(built, styleOverrides);
          // Resolve path shape for text-on-path rendering. This reads a
          // *different* node's geometry and patches the shared shape object, so
          // these nodes are never memoized: the memo key cannot observe the path
          // node's identity and would serve a stale pathShape after it moves.
          const pathNodeId = built.pathTextSettings?.pathNodeId;
          const isPathText =
            !!pathNodeId && (built as { shape?: { kind: string } }).shape?.kind === 'text';
          if (isPathText) {
            const pathNode = doc.nodes[pathNodeId] as import('@varve/scene').ShapeNode | undefined;
            if (pathNode?.shape) {
              (built.shape as Record<string, unknown>).pathShape = pathNode.shape;
            }
          }
          engineNode = { ...built, transform: world };
          if (canMemoEngineNodes && !isPathText) {
            engineMemo.set(id, n, world, engineNode);
          }
        }
        nodeWork.acceptedForReplay++;
        if (n.kind === 'rasterLayer') nodeWork.rasterRepainted++;
        else nodeWork.vectorRepainted++;
        nodeIds.push(id);
        flatNodes.push(engineNode);
      }
      const preLoopMs = performance.now() - preLoopStart;
      nodeWork.visibilityMs = preLoopMs;
      nodeWork.cacheReused = engineMemo.hits - engineMemoHitsAtStart;

      // Replay-set expansion: ancestors, mask sources and full flatten-group
      // subtrees replay too; their IR is appended (order is irrelevant).
      let replaySet: Set<string> | null = null;
      if (dirtyWorldRects && nodeIds.length > 0) {
        parentIndex ??= buildParentIndexMap(doc);
        const expanded = expandReplayList({
          doc,
          appendIds: nodeIds,
          parentIndex,
          cache,
          variantCaches,
          variableStore,
          resolvedStyles,
          engineMemo,
          canMemoEngineNodes,
          showOriginalBgNodeId: s.showOriginalBgNodeId ?? '',
        });
        replaySet = expanded.replaySet;
        nodeWork.ancestorsIncluded = expanded.ancestorsIncluded;
        nodeWork.compositingDependencies = expanded.compositingDependencies;
        nodeIds.push(...expanded.nodeIds);
        flatNodes.push(...expanded.flatNodes);
      }
      recordNodeWork(nodeWork, dirtyRecorderRef.current);

      if (s.motion.activeTimelineId) {
        const sample = sampleTimelineAt(doc, s.motion.activeTimelineId, s.motion.currentTime);
        if (sample.overrides.size > 0) {
          for (let i = 0; i < flatNodes.length; i++) {
            const nodeId = nodeIds[i];
            if (!nodeId) continue;
            const props = sample.overrides.get(nodeId);
            if (!props) continue;
            const fn = flatNodes[i];
            if (!fn) continue;
            for (const [prop, val] of props) {
              applyPropertyPath(fn as unknown as Record<string, unknown>, prop, val);
            }
          }
        }
      }

      const docVersion = docVersionRef.current;
      const animatedNodeIds = new Set<string>();

      if (s.motion.activeTimelineId) {
        const activeTl = doc.timelines?.[s.motion.activeTimelineId];
        for (const tr of activeTl?.tracks ?? []) {
          if (tr.enabled === false) continue;
          if (tr.nestedTimelineId) {
            const nested = doc.timelines?.[tr.nestedTimelineId];
            for (const ntr of nested?.tracks ?? []) {
              if (ntr.enabled !== false) animatedNodeIds.add(ntr.nodeId);
            }
          } else if (tr.keyframes.length > 0) {
            animatedNodeIds.add(tr.nodeId);
          }
        }
      }

      const canUsePerNodeIrCache = s.canvasMode === 'full';
      let ir: Awaited<ReturnType<Engine['buildIr']>>;
      let buildIrMs = 0;
      let hashMs = 0;
      let replayStartTime = 0;
      let replayMs = 0;
      let cacheHitsInFrame = 0;

      if (canUsePerNodeIrCache && nodeIds.length > 0) {
        const hashStart = performance.now();
        const irSlots: Array<Awaited<ReturnType<Engine['buildIr']>>[number] | undefined> =
          new Array(nodeIds.length);
        const nodesToBuild: EngineNode[] = [];
        const buildSlotIndices: number[] = [];
        // The per-node content hash is memoized across frames. `doc` (immutable,
        // structurally shared) changing is the sole signal that any node content
        // could have changed; showOriginalBgNodeId is the one content input that
        // is not part of `doc`. beginFrame clears the memo when either changes,
        // so a document edit can never surface a stale hash.
        const memo = nodeHashMemoRef.current;
        memo.beginFrame(doc, s.showOriginalBgNodeId ?? '');

        for (let i = 0; i < nodeIds.length; i++) {
          const nodeId = nodeIds[i]!;
          const fn = flatNodes[i];
          if (!fn) continue;
          const isAnimated = animatedNodeIds.has(nodeId);
          if (!isAnimated) {
            const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
            const { hash } = memo.hash(nodeId, fn, styleKey);
            const cached = subtreeIrCacheRef.current.get(nodeId, hash);
            if (cached) {
              irSlots[i] = cached;
              cacheHitsInFrame++;
              continue;
            }
          }
          nodesToBuild.push(fn);
          buildSlotIndices.push(i);
        }
        // Per-frame hash-loop cost: sits inside the frame but outside buildIrMs,
        // so it is otherwise invisible in diagnostics (see FrameDiagnostics.hashMs).
        hashMs = performance.now() - hashStart;

        if (buildSlotIndices.length === 0) {
          ir = irSlots as Awaited<ReturnType<Engine['buildIr']>>;
        } else if (buildSlotIndices.length === nodeIds.length) {
          const t0 = performance.now();
          ir = await eng.buildIr({ nodes: flatNodes });
          buildIrMs = performance.now() - t0;
          for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            const fn = flatNodes[i];
            const item = ir[i];
            if (!nodeId || !fn || !item) continue;
            if (!animatedNodeIds.has(nodeId)) {
              const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
              // Memoized from the lookup loop above (same doc + transform) → hit.
              const { hash } = memo.hash(nodeId, fn, styleKey);
              subtreeIrCacheRef.current.set(nodeId, hash, item);
            }
          }
        } else {
          const t0b = performance.now();
          const built = await eng.buildIr({ nodes: nodesToBuild });
          buildIrMs = performance.now() - t0b;
          let builtIdx = 0;
          for (const slot of buildSlotIndices) {
            const nodeId = nodeIds[slot];
            const fn = flatNodes[slot];
            const item = built[builtIdx++];
            if (item) irSlots[slot] = item;
            if (nodeId && fn && item && !animatedNodeIds.has(nodeId)) {
              const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
              // Memoized from the lookup loop above (same doc + transform) → hit.
              const { hash } = memo.hash(nodeId, fn, styleKey);
              subtreeIrCacheRef.current.set(nodeId, hash, item);
            }
          }
          ir = irSlots as Awaited<ReturnType<Engine['buildIr']>>;
        }
      } else {
        const t0c = performance.now();
        ir = await eng.buildIr({ nodes: flatNodes });
        buildIrMs = performance.now() - t0c;
      }
      const needsStructural = sceneNeedsStructuralCompositing(doc);

      if (s.canvasMode === 'outline') {
        const outlineColor: EngineColor = { space: 'rgb', r: 30, g: 30, b: 36, a: 255 };
        for (let i = 0; i < ir.length; i++) {
          const item = ir[i];
          if (item) {
            ir[i] = {
              ...item,
              fill: outlineColor,
              fills: [],
              effects: [],
              opacity: 1,
              blendMode: 'normal' as const,
              strokes: [
                {
                  color: outlineColor,
                  weight: 1.5,
                  align: 'center' as const,
                  dashPattern: [],
                  dashOffset: 0,
                  cap: 'round' as const,
                  join: 'round' as const,
                  miterLimit: 4,
                  visible: true,
                },
              ],
            };
          }
        }
      }

      type IrItem = (typeof ir)[number];
      const irByNodeId = new Map<string, IrItem>();
      for (let i = 0; i < nodeIds.length; i++) {
        const nid = nodeIds[i];
        const item = ir[i];
        if (nid && item) irByNodeId.set(nid, item);
      }

      frameBackend = compositorRef.current;
      frameBackend?.beginFrame(
        {
          items: ir,
          camera: { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation ?? 0 },
          viewport: { width: VP_W, height: VP_H },
          docVersion,
        },
        { applyCamera: false, clear: false },
      );
      compositorFrameOpen = frameBackend !== null;

      const dirtyRect = dirtyRectRef.current;
      const usePartialRedraw =
        profile.enablePartialRedraw &&
        (s.cameraRotation ?? 0) === 0 &&
        // Retained pixels belong to the previous camera/surface; reusing them
        // after a pan, zoom or resize is exactly the stale-pixel failure.
        surfaceMatch === 'match' &&
        dirtyRect &&
        dirtyRect.w > 0 &&
        dirtyRect.h > 0 &&
        dirtyRect.w * dirtyRect.h < VP_W * VP_H * 0.6;

      // Multi-rect partial: clear/fill each merged rect; the clip covers
      // exactly those rects, never the gaps (retained pixels stay valid).
      const multiRectPartial = usePartialRedraw && pruneScreenRects !== null;
      if (multiRectPartial) {
        openMultiRectPartialClip(ctx, pruneScreenRects, dpr, boardColor, () => applyCam(ctx));
        dirtyClipOpen = true;
      } else if (usePartialRedraw) {
        openUnionPartialClip(ctx, dirtyRect, dpr, boardColor, () => applyCam(ctx));
        dirtyClipOpen = true;
      } else {
        openFullRedraw(ctx, canvas.width, canvas.height, boardColor, () => applyCam(ctx));
      }

      // Page decorations (ADR-0144): trim fills, shadows, active ring and
      // labels for every visible page. Drawn inside the dirty clip after the
      // board fill and before content replay, so the trim fill sits under
      // authored content; placement/size-driven dirty regions already cover
      // the decoration band (see computeDocumentDirtyRegion).
      drawPageDecorations(
        ctxNN,
        doc,
        s,
        { width: cssW, height: cssH },
        {
          themeRevision: s.themeRevision,
          activePageId: doc.activePageId ?? null,
        },
      );

      dirtyRectRef.current = null;

      const paintLeafItem = (item: IrItem, targetCtx: CanvasRenderingContext2D): void => {
        if (targetCtx === ctxNN && compositorRef.current) {
          compositorRef.current.drawVectorItems([item]);
        } else {
          replayIr(targetCtx as unknown as ReplayTarget, [item]);
        }
      };

      // Pruned replay: skip nodes outside the set; `replayForceAll` disables
      // the check inside mask/flatten rendering (whole subtrees required).
      let replayForceAll = false;
      function replaySubtreeToCtx(nodeId: string, targetCtx: CanvasRenderingContext2D): void {
        if (replaySet && !replayForceAll && !replaySet.has(nodeId)) return;
        const n = doc.nodes[nodeId];
        if (!n || n.visible === false) return;
        const item = irByNodeId.get(nodeId);

        const mask = 'mask' in n && n.mask && n.mask.visible ? n.mask : null;
        const maskSrcId = mask ? mask.sourceNodeId : null;
        const maskChild = maskSrcId ? doc.nodes[maskSrcId] : null;
        if (mask && (maskSrcId || (mask.vectorMask && mask.vectorMask.points.length > 0))) {
          const baseTransform = targetCtx.getTransform();
          replayForceAll = true;
          const compositeMaskedSurface = (surface: HTMLCanvasElement): void => {
            targetCtx.save();
            try {
              targetCtx.setTransform(1, 0, 0, 1, 0, 0);
              if (n.kind === 'group') {
                const blendMode = n.blendMode ?? 'passThrough';
                targetCtx.globalAlpha = n.opacity ?? 1;
                targetCtx.globalCompositeOperation = mapBlendMode(
                  blendMode === 'passThrough' ? 'normal' : blendMode,
                ) as GlobalCompositeOperation;
              }
              targetCtx.drawImage(surface, 0, 0);
            } finally {
              targetCtx.restore();
            }
          };
          if ((mask.type === 'alpha' || mask.type === 'luminance') && maskSrcId) {
            const result = document.createElement('canvas');
            result.width = targetCtx.canvas.width;
            result.height = targetCtx.canvas.height;
            const resultCtx = result.getContext('2d');
            if (!resultCtx) return;
            renderEnhancedMask(
              resultCtx,
              {
                draw: (maskCtx: CanvasRenderingContext2D) => {
                  maskCtx.setTransform(baseTransform);
                  replaySubtreeToCtx(maskSrcId, maskCtx);
                },
              },
              {
                draw: (contentCtx: CanvasRenderingContext2D) => {
                  contentCtx.setTransform(baseTransform);
                  for (const childId of (n as import('@varve/scene').ContainerNode).children) {
                    if (childId !== maskSrcId) replaySubtreeToCtx(childId, contentCtx);
                  }
                  // Render mask source on top of masked content unless hideMaskSource is true
                  if (!mask.hideMaskSource) {
                    replaySubtreeToCtx(maskSrcId, contentCtx);
                  }
                },
              },
              {
                luminance: mask.type === 'luminance',
                inverted: mask.inverted === true,
                feather: mask.feather,
                density: mask.density,
              },
            );
            compositeMaskedSurface(result);
            return;
          }
          function traceVectorMaskPoints(
            ctx: CanvasRenderingContext2D,
            points: import('@varve/engine').PathPoint[],
            closed: boolean,
          ): void {
            if (points.length === 0) return;
            ctx.beginPath();
            ctx.moveTo(points[0]!.x, points[0]!.y);
            for (let i = 1; i < points.length; i++) {
              const p = points[i]!;
              const prev = points[i - 1]!;
              if (p.handleIn || p.handleOut) {
                ctx.bezierCurveTo(
                  prev.handleOut?.[0] ?? prev.x,
                  prev.handleOut?.[1] ?? prev.y,
                  p.handleIn?.[0] ?? p.x,
                  p.handleIn?.[1] ?? p.y,
                  p.x,
                  p.y,
                );
              } else {
                ctx.lineTo(p.x, p.y);
              }
            }
            if (closed) ctx.closePath();
          }
          const drawClippedChildren = (clipCtx: CanvasRenderingContext2D): void => {
            // For inverted clip masks, we need offscreen compositing because
            // Canvas2D clip() has no native inverse mode.
            // Strategy: render children to offscreen canvas, then draw mask source
            // shape filled fully, then use destination-out to punch the clip region
            // out of the offscreen canvas (keeping content outside the clip region).
            if (mask.inverted) {
              const offscreen = document.createElement('canvas');
              offscreen.width = targetCtx.canvas.width;
              offscreen.height = targetCtx.canvas.height;
              const offCtx = offscreen.getContext('2d');
              if (!offCtx) return;
              offCtx.setTransform(baseTransform);
              // Render all non-mask-source children to offscreen canvas
              for (const childId of (n as import('@varve/scene').ContainerNode).children) {
                if (childId !== maskSrcId) replaySubtreeToCtx(childId, offCtx);
              }
              // Render mask source on top unless hideMaskSource
              if (!mask.hideMaskSource && maskSrcId) {
                replaySubtreeToCtx(maskSrcId, offCtx);
              }
              // Punch out the clip region using destination-out
              // First, render the mask source shape to the offscreen canvas
              // at the correct world-space position
              const maskWorldTransform = maskSrcId
                ? mask.linked !== false
                  ? getCachedWorldTransform(cache, doc, maskSrcId)
                  : (mask.transform ?? getCachedWorldTransform(cache, doc, maskSrcId))
                : (mask.transform ?? ([1, 0, 0, 1, 0, 0] as const));
              offCtx.save();
              offCtx.setTransform(1, 0, 0, 1, 0, 0);
              offCtx.globalCompositeOperation = 'destination-out';
              offCtx.transform(...maskWorldTransform);
              if (mask.vectorMask && mask.vectorMask.points.length > 0) {
                traceVectorMaskPoints(offCtx, mask.vectorMask.points, mask.vectorMask.closed);
                offCtx.fillStyle = 'rgba(255,255,255,1)';
                offCtx.fill(mask.vectorMask.fillRule ?? 'nonzero');
              } else {
                offCtx.beginPath();
                traceSceneNodeOutline(
                  offCtx,
                  maskChild as unknown as Parameters<typeof traceSceneNodeOutline>[1],
                );
                offCtx.closePath();
                offCtx.fillStyle = 'rgba(255,255,255,1)';
                offCtx.fill(mask.fillRule ?? 'nonzero');
              }
              offCtx.restore();
              // Draw the result onto clipCtx
              clipCtx.drawImage(offscreen, 0, 0);
              return;
            }
            clipCtx.save();
            try {
              const maskWorldTransform = maskSrcId
                ? mask.linked !== false
                  ? getCachedWorldTransform(cache, doc, maskSrcId)
                  : (mask.transform ?? getCachedWorldTransform(cache, doc, maskSrcId))
                : (mask.transform ?? ([1, 0, 0, 1, 0, 0] as const));
              clipCtx.transform(...maskWorldTransform);
              if (mask.vectorMask && mask.vectorMask.points.length > 0) {
                traceVectorMaskPoints(clipCtx, mask.vectorMask.points, mask.vectorMask.closed);
                clipCtx.clip(mask.vectorMask.fillRule ?? 'nonzero');
              } else {
                clipCtx.beginPath();
                traceSceneNodeOutline(
                  clipCtx,
                  maskChild as unknown as Parameters<typeof traceSceneNodeOutline>[1],
                );
                clipCtx.closePath();
                clipCtx.clip(mask.fillRule ?? 'nonzero');
              }
              clipCtx.setTransform(baseTransform);
              for (const childId of (n as import('@varve/scene').ContainerNode).children) {
                if (childId !== maskSrcId) replaySubtreeToCtx(childId, clipCtx);
              }
              // Render mask source on top of clipped children unless hideMaskSource
              if (!mask.hideMaskSource && maskSrcId) {
                clipCtx.setTransform(baseTransform);
                replaySubtreeToCtx(maskSrcId, clipCtx);
              }
            } finally {
              clipCtx.restore();
            }
          };
          const blendMode = n.kind === 'group' ? (n.blendMode ?? 'passThrough') : 'normal';
          const needsContainerSurface =
            n.kind === 'group' &&
            (n.isolated === true ||
              (blendMode !== 'normal' && blendMode !== 'passThrough') ||
              (n.opacity ?? 1) < 1);
          if (needsContainerSurface) {
            const result = document.createElement('canvas');
            result.width = targetCtx.canvas.width;
            result.height = targetCtx.canvas.height;
            const resultCtx = result.getContext('2d');
            if (!resultCtx) return;
            resultCtx.setTransform(baseTransform);
            drawClippedChildren(resultCtx);
            compositeMaskedSurface(result);
          } else {
            drawClippedChildren(targetCtx);
          }
          return;
        }

        if (n.kind === 'frame') {
          if (item) paintLeafItem(item, targetCtx);
          const extras = mockupExtras.get(n.id);
          if (extras) {
            for (const extra of extras) paintLeafItem(extra, targetCtx);
          }
          if (n.children.length > 0) {
            const renderChildren = (ctx: CanvasRenderingContext2D) => {
              const adjIds: string[] = [];
              for (const childId of n.children) {
                const child = doc.nodes[childId];
                if (child?.kind === 'adjustment') {
                  adjIds.push(childId);
                } else {
                  replaySubtreeToCtx(childId, ctx);
                }
              }
              for (const adjId of adjIds) {
                replaySubtreeToCtx(adjId, ctx);
              }
            };
            const shouldClip = n.clipContent !== false;
            if (shouldClip) {
              const t = item?.transform ?? ([1, 0, 0, 1, 0, 0] as const);
              const [a, b, c, d, e, f] = t;
              const fw = n.w;
              const fh = n.h;
              targetCtx.save();
              targetCtx.beginPath();
              targetCtx.moveTo(e, f);
              targetCtx.lineTo(a * fw + e, b * fw + f);
              targetCtx.lineTo(a * fw + c * fh + e, b * fw + d * fh + f);
              targetCtx.lineTo(c * fh + e, d * fh + f);
              targetCtx.closePath();
              targetCtx.clip();
              renderChildren(targetCtx);
              targetCtx.restore();
            } else {
              renderChildren(targetCtx);
            }
          }
        } else if (n.kind === 'group') {
          if (s.canvasMode === 'outline') {
            const oAdjIds: string[] = [];
            for (const childId of n.children) {
              const child = doc.nodes[childId];
              if (child?.kind === 'adjustment') {
                oAdjIds.push(childId);
              } else {
                replaySubtreeToCtx(childId, targetCtx);
              }
            }
            for (const adjId of oAdjIds) {
              replaySubtreeToCtx(adjId, targetCtx);
            }
            return;
          }
          const isIsolated = n.isolated === true;
          const visibleGroupEffects = n.effects.filter((effect) => effect.visible);
          // V2.16+: a live warp on the container forces the flatten path so
          // evaluated (nonlinear) geometry, opacity, blend and group effects
          // compose on one surface — exactly like the isolated-group path.
          const warpedContainer = isWarpedContainer(n);
          const needsFlatten =
            isIsolated ||
            warpedContainer ||
            (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'passThrough') ||
            (n.opacity !== undefined && n.opacity < 1) ||
            visibleGroupEffects.length > 0;
          if (needsFlatten && n.children.length > 0) {
            // The flatten surface re-renders the whole subtree — the dirty
            // candidate set does not apply inside it.
            replayForceAll = true;
            let warpItems: ReturnType<typeof evaluateWarpedContainerItems> | null = null;
            if (warpedContainer) {
              warpItems = evaluateWarpedContainerItems(doc, nodeId);
            }
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            if (warpItems && warpItems.items.length > 0) {
              const wb = warpedContainerWorldBounds(warpItems.items);
              if (wb) {
                minX = wb.x;
                minY = wb.y;
                maxX = wb.x + wb.w;
                maxY = wb.y + wb.h;
              }
            } else {
              for (const childId of n.children) {
                parentIndex ??= buildParentIndexMap(doc);
                const b = nodeVisualWorldBounds(doc, childId, resolvedStyles, parentIndex);
                if (b) {
                  minX = Math.min(minX, b.x);
                  minY = Math.min(minY, b.y);
                  maxX = Math.max(maxX, b.x + b.w);
                  maxY = Math.max(maxY, b.y + b.h);
                }
              }
            }
            if (Number.isFinite(minX)) {
              targetCtx.save();
              const effectPadding =
                subtreeEffectPadding(doc, n.children) +
                appearancePaddingWorld(n, getCachedWorldTransform(cache, doc, n.id));
              const groupWidth = Math.max(1, maxX - minX + effectPadding * 2);
              const groupHeight = Math.max(1, maxY - minY + effectPadding * 2);
              const desiredScale = Math.max(1, dpr * s.zoom);
              const fitted = fitRasterDimensions(
                Math.ceil(groupWidth * desiredScale),
                Math.ceil(groupHeight * desiredScale),
              );
              const renderScale = Math.max(
                0.01,
                Math.min(fitted.width / groupWidth, fitted.height / groupHeight),
              );
              const gCanvas = new CompositeCanvas({
                width: groupWidth,
                height: groupHeight,
                devicePixelRatio: renderScale,
                testCanvas: document.createElement('canvas'),
              });
              const gCtx = gCanvas.ctx;
              gCtx.save();
              gCtx.translate(-minX + effectPadding, -minY + effectPadding);
              if (warpItems && warpItems.items.length > 0) {
                // Evaluated warped items already carry world transforms and
                // container-local warped geometry — paint them directly.
                for (const { item: warpItem } of warpItems.items) {
                  paintLeafItem(warpItem, gCtx as unknown as CanvasRenderingContext2D);
                }
              } else {
                const gAdjIds: string[] = [];
                for (const childId of n.children) {
                  const child = doc.nodes[childId];
                  if (child?.kind === 'adjustment') {
                    gAdjIds.push(childId);
                  } else {
                    replaySubtreeToCtx(childId, gCtx as unknown as CanvasRenderingContext2D);
                  }
                }
                for (const adjId of gAdjIds) {
                  replaySubtreeToCtx(adjId, gCtx as unknown as CanvasRenderingContext2D);
                }
              }
              gCtx.restore();

              for (const effect of visibleGroupEffects) {
                if (effect.type === 'outerGlow') {
                  const effectCanvas = document.createElement('canvas');
                  effectCanvas.width = gCanvas.canvas.width;
                  effectCanvas.height = gCanvas.canvas.height;
                  const effectCtx = effectCanvas.getContext('2d');
                  if (!effectCtx) continue;
                  effectCtx.shadowColor = managedColorToCss(effect.color);
                  effectCtx.shadowBlur =
                    (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
                  effectCtx.shadowOffsetX = 0;
                  effectCtx.shadowOffsetY = 0;
                  effectCtx.drawImage(gCanvas.canvas as CanvasImageSource, 0, 0);
                  effectCtx.globalCompositeOperation = 'destination-out';
                  effectCtx.shadowColor = 'transparent';
                  effectCtx.drawImage(gCanvas.canvas as CanvasImageSource, 0, 0);
                  targetCtx.save();
                  targetCtx.globalAlpha = effect.opacity * (n.opacity ?? 1);
                  targetCtx.globalCompositeOperation = mapBlendMode(
                    effect.blendMode,
                  ) as GlobalCompositeOperation;
                  targetCtx.drawImage(
                    effectCanvas,
                    0,
                    0,
                    effectCanvas.width,
                    effectCanvas.height,
                    minX - effectPadding,
                    minY - effectPadding,
                    groupWidth,
                    groupHeight,
                  );
                  targetCtx.restore();
                } else if (effect.type === 'dropShadow') {
                  const effectCanvas = document.createElement('canvas');
                  effectCanvas.width = gCanvas.canvas.width;
                  effectCanvas.height = gCanvas.canvas.height;
                  const effectCtx = effectCanvas.getContext('2d');
                  if (!effectCtx) continue;
                  effectCtx.shadowColor = managedColorToCss(effect.color);
                  effectCtx.shadowBlur =
                    (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
                  effectCtx.shadowOffsetX = effect.x * renderScale;
                  effectCtx.shadowOffsetY = effect.y * renderScale;
                  effectCtx.drawImage(gCanvas.canvas as CanvasImageSource, 0, 0);
                  effectCtx.globalCompositeOperation = 'destination-out';
                  effectCtx.shadowColor = 'transparent';
                  effectCtx.drawImage(gCanvas.canvas as CanvasImageSource, 0, 0);
                  targetCtx.save();
                  targetCtx.globalAlpha = effect.opacity * (n.opacity ?? 1);
                  targetCtx.globalCompositeOperation = mapBlendMode(
                    effect.blendMode,
                  ) as GlobalCompositeOperation;
                  targetCtx.drawImage(
                    effectCanvas,
                    0,
                    0,
                    effectCanvas.width,
                    effectCanvas.height,
                    minX - effectPadding,
                    minY - effectPadding,
                    groupWidth,
                    groupHeight,
                  );
                  targetCtx.restore();
                } else if (effect.type === 'glassMaterial') {
                  // Glass material at group level: capture backdrop behind the group
                  // bounds, apply blur/tint/saturation/brightness/noise, and
                  // composite the processed backdrop clipped to the group area.
                  // This renders BEFORE the group content via the drawImage below.
                  const m = targetCtx.getTransform();
                  const gx = minX - effectPadding;
                  const gy = minY - effectPadding;
                  const screen = computeScreenBounds(m, gx, gy, groupWidth, groupHeight);
                  if (screen.w > 0 && screen.h > 0) {
                    const blurPad = Math.ceil(effect.blur * 3);
                    const padX = Math.ceil(Math.abs(blurPad * m.a));
                    const padY = Math.ceil(Math.abs(blurPad * m.d));
                    const capX = screen.x - padX;
                    const capY = screen.y - padY;
                    const capW = screen.w + padX * 2;
                    const capH = screen.h + padY * 2;
                    const cc = new CompositeCanvas({
                      width: capW,
                      height: capH,
                      devicePixelRatio: 1,
                      testCanvas: document.createElement('canvas'),
                    });
                    cc.captureSource(
                      targetCtx.canvas as HTMLCanvasElement,
                      capX,
                      capY,
                      capW,
                      capH,
                      0,
                      0,
                    );
                    cc.applyBlur(effect.blur);
                    applyGlassMaterialBackdrop(cc, capW, capH, effect);
                    targetCtx.save();
                    targetCtx.globalAlpha =
                      ('opacity' in effect ? (effect as { opacity: number }).opacity : 1) *
                      (n.opacity ?? 1);
                    targetCtx.drawImage(
                      cc.canvas as CanvasImageSource,
                      0,
                      0,
                      capW,
                      capH,
                      gx - blurPad,
                      gy - blurPad,
                      groupWidth + blurPad * 2,
                      groupHeight + blurPad * 2,
                    );
                    targetCtx.restore();
                  }
                } else if (effect.type === 'backgroundBlur') {
                  const m = targetCtx.getTransform();
                  const gx = minX - effectPadding;
                  const gy = minY - effectPadding;
                  const screen = computeScreenBounds(m, gx, gy, groupWidth, groupHeight);
                  if (screen.w > 0 && screen.h > 0) {
                    const blurPad = Math.ceil(effect.radius * 3);
                    const padX = Math.ceil(Math.abs(blurPad * m.a));
                    const padY = Math.ceil(Math.abs(blurPad * m.d));
                    const capX = screen.x - padX;
                    const capY = screen.y - padY;
                    const capW = screen.w + padX * 2;
                    const capH = screen.h + padY * 2;
                    const cc = new CompositeCanvas({
                      width: capW,
                      height: capH,
                      devicePixelRatio: 1,
                      testCanvas: document.createElement('canvas'),
                    });
                    cc.captureSource(
                      targetCtx.canvas as HTMLCanvasElement,
                      capX,
                      capY,
                      capW,
                      capH,
                      0,
                      0,
                    );
                    applyBackgroundBlurBackdrop(cc, capW, capH, effect.radius);
                    targetCtx.save();
                    targetCtx.drawImage(
                      cc.canvas as CanvasImageSource,
                      0,
                      0,
                      capW,
                      capH,
                      gx - blurPad,
                      gy - blurPad,
                      groupWidth + blurPad * 2,
                      groupHeight + blurPad * 2,
                    );
                    targetCtx.restore();
                  }
                } else if (effect.type === 'chromaticAberration') {
                  applyChromaticAberration(gCanvas, groupWidth, groupHeight, effect);
                } else if (effect.type === 'glitch') {
                  applyGlitch(gCanvas, groupWidth, groupHeight, effect);
                } else if (effect.type === 'innerShadow') {
                  renderGroupInsetEffect(effect, gCanvas, renderScale, 'shadow');
                } else if (effect.type === 'innerGlow') {
                  renderGroupInsetEffect(effect, gCanvas, renderScale, 'glow');
                }
              }
              const bm = n.blendMode ?? 'passThrough';
              if (bm !== 'passThrough') {
                targetCtx.globalCompositeOperation = mapBlendMode(bm) as GlobalCompositeOperation;
              } else if (isIsolated) {
                targetCtx.globalCompositeOperation = 'source-over';
              }
              targetCtx.globalAlpha = n.opacity ?? 1;
              const layerBlur = visibleGroupEffects.find((effect) => effect.type === 'layerBlur');
              if (layerBlur?.type === 'layerBlur' && layerBlur.radius > 0) {
                applyLayerBlur(
                  targetCtx,
                  gCanvas,
                  layerBlur.radius,
                  minX - effectPadding,
                  minY - effectPadding,
                  groupWidth,
                  groupHeight,
                );
              } else {
                targetCtx.drawImage(
                  gCanvas.canvas as CanvasImageSource,
                  0,
                  0,
                  gCanvas.canvas.width,
                  gCanvas.canvas.height,
                  minX - effectPadding,
                  minY - effectPadding,
                  groupWidth,
                  groupHeight,
                );
              }
              targetCtx.restore();
            }
          } else {
            const adjIds: string[] = [];
            for (const childId of n.children) {
              const child = doc.nodes[childId];
              if (child?.kind === 'adjustment') {
                adjIds.push(childId);
              } else {
                replaySubtreeToCtx(childId, targetCtx);
              }
            }
            for (const adjId of adjIds) {
              replaySubtreeToCtx(adjId, targetCtx);
            }
          }
        } else if (n.kind === 'adjustment') {
          const adjNode = n as import('@varve/scene').AdjustmentNode;
          const adjList = adjNode.adjustments ?? [];
          const adjFilters = adjustmentsToFilters(adjList);
          if (adjFilters.length === 0) return;

          // Resolve scope: which nodes does this adjustment affect?
          const scope = adjNode.scope;
          let targetIds: ReadonlySet<string>;
          if (scope) {
            const resolved = resolveAdjustmentScope(doc, scope, nodeId);
            targetIds = new Set(resolved);
          } else {
            // Legacy (no scope field): affect all visible nodes — match pre-v2.3 behavior
            targetIds = new Set(Array.from(entries.keys()).filter((id: string) => id !== nodeId));
          }
          if (targetIds.size === 0) return;

          const cw = targetCtx.canvas.width;
          const ch = targetCtx.canvas.height;
          if (cw === 0 || ch === 0) return;

          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          let nodeCount = 0;
          for (const nid of targetIds) {
            const raw = doc.nodes[nid];
            if (!raw || raw.visible === false) continue;
            parentIndex ??= buildParentIndexMap(doc);
            const b = nodeVisualWorldBounds(doc, nid, resolvedStyles, parentIndex);
            if (b) {
              minX = Math.min(minX, b.x);
              minY = Math.min(minY, b.y);
              maxX = Math.max(maxX, b.x + b.w);
              maxY = Math.max(maxY, b.y + b.h);
              nodeCount++;
            }
          }
          if (!Number.isFinite(minX) || nodeCount === 0) return;

          const EFFECT_PAD = 80;
          const bx = minX - EFFECT_PAD;
          const by = minY - EFFECT_PAD;
          const bw = Math.min(cw, maxX - minX + EFFECT_PAD * 2);
          const bh = Math.min(ch, maxY - minY + EFFECT_PAD * 2);

          let backdrop: HTMLCanvasElement;
          try {
            backdrop = document.createElement('canvas');
            backdrop.width = Math.ceil(bw);
            backdrop.height = Math.ceil(bh);
            const bCtx = backdrop.getContext('2d');
            if (!bCtx) return;
            bCtx.translate(-bx, -by);
            bCtx.drawImage(targetCtx.canvas, 0, 0);
          } catch {
            return;
          }

          const bCtx = backdrop.getContext('2d');
          if (!bCtx) return;
          applyFilterWithCompositing(bCtx, adjFilters, backdrop.width, backdrop.height);

          targetCtx.save();
          targetCtx.setTransform(1, 0, 0, 1, 0, 0);
          targetCtx.globalAlpha = adjNode.opacity ?? 1;
          const adjBm = adjNode.blendMode ?? 'normal';
          if (adjBm !== 'normal') {
            targetCtx.globalCompositeOperation = mapBlendMode(adjBm) as GlobalCompositeOperation;
          }
          targetCtx.drawImage(backdrop, 0, 0, backdrop.width, backdrop.height, bx, by, bw, bh);
          targetCtx.restore();
        } else {
          if (item) paintLeafItem(item, targetCtx);
        }
      }

      function replaySubtree(nodeId: string): void {
        // The force flag set by mask/flatten subtrees must not leak into the
        // next root's pruning decision.
        replayForceAll = false;
        replaySubtreeToCtx(nodeId, ctxNN);
      }

      // Worker path when structural compositing is not required and every
      // image fill src is loaded (ImageBitmap Structured Clone transport).
      const workerReady = sceneCanUseWorkerRenderer(doc, (src) => getImageCache().isLoaded(src));

      // Mockup surface decoration: compose mockup frames into the IR list
      // (plate shapes, baked surface rasters, shadows, glows). Runs before
      // any paint or worker post so preview, worker, and export see the same
      // items. The source subtrees are replayed through the structural path
      // with the prune force flag set (sources may be outside the dirty set).
      const mockupExtras = new Map<string, IrItem[]>();
      {
        if (!mockupSurfaceCacheRef.current) {
          mockupSurfaceCacheRef.current = new MockupSurfaceCache();
        }
        const result = decorateMockupIr({
          doc,
          nodeIds,
          items: ir,
          renderSubtree: (ctx, nodeId) => {
            const prevForce = replayForceAll;
            replayForceAll = true;
            try {
              replaySubtreeToCtx(nodeId, ctx);
            } finally {
              replayForceAll = prevForce;
            }
          },
          qualityScale: 1,
          cache: mockupSurfaceCacheRef.current,
        });
        for (const [frameId, extras] of result.extrasByNodeId) {
          mockupExtras.set(frameId, extras);
        }
      }

      replayStartTime = performance.now();
      if (needsStructural) {
        const deferredAdjustments: string[] = [];
        for (const [id, entry] of entries) {
          if (entry.parentId === null) {
            const node = doc.nodes[id];
            if (node?.kind === 'adjustment') {
              deferredAdjustments.push(id);
            } else {
              replaySubtree(id);
            }
          }
        }
        for (const id of deferredAdjustments) {
          replaySubtree(id);
        }
      } else if (
        renderWorkerRef.current &&
        !workerFailedRef.current &&
        workerReady &&
        profileCanUseWorker
      ) {
        const wb = workerBitmapRef.current;
        const cameraMatches =
          wb &&
          wb.camera.zoom === s.zoom &&
          wb.camera.pan.x === s.pan.x &&
          wb.camera.pan.y === s.pan.y &&
          (wb.camera.rotation ?? 0) === (s.cameraRotation ?? 0);
        const docIsCurrent = Boolean(wb && wb.docVersion === docVersion);
        const surfaceMatches = Boolean(
          wb && wb.viewport.width === VP_W && wb.viewport.height === VP_H && wb.dpr === dpr,
        );
        const bitmapIsCurrent = docIsCurrent && cameraMatches && surfaceMatches;
        // Only ask the worker to re-render when the cached bitmap is stale
        // (doc or camera actually changed). Without this guard, the
        // `frameRendered` handler below calls back into `drawContent` on
        // every reply, which — since nothing here invalidated `docVersion`
        // or the camera — would immediately re-post the SAME render request,
        // forever: an unthrottled main-thread-to-worker ping-pong that never
        // settles. It's cheap to miss for tiny vector scenes, but for a
        // scene carrying a large embedded image (pasted image fill, full
        // base64 data URL in `nodes`/`ir`), each loop iteration structured-
        // clones that multi-MB payload across the worker boundary, pinning
        // a CPU core indefinitely and starving the main thread.
        if (!bitmapIsCurrent) {
          void collectImageBitmaps(ir, { maxEntries: budgets.workerImageBitmaps }).then(
            (collected) => {
              if (!collected) return;
              const host = renderWorkerRef.current;
              if (!host) {
                closeImageBitmapMap(collected.images);
                return;
              }
              const posted = host.post(
                {
                  type: 'render',
                  ir,
                  camera: { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation ?? 0 },
                  viewport: { width: VP_W, height: VP_H },
                  docVersion,
                  proof: editor.proofEnabled ? editor.proofConfig : null,
                  dpr,
                  images: collected.images,
                },
                collected.transfer,
              );
              if (!posted && !workerFailedRef.current) {
                workerFailedRef.current = true;
                requestContentDrawRef.current?.('worker-admission', 'backing-store-recovery');
              }
            },
          );
        }
        if (wb && surfaceMatches) {
          // Replay cached bitmap: identity when camera matches exactly,
          // otherwise compensate for the complete camera delta — smooth
          // panning/zoom/rotation at "last rendered quality" while
          // the worker delivers the fresh frame asynchronously.
          ctxNN.save();
          ctxNN.setTransform(1, 0, 0, 1, 0, 0);
          if (cameraMatches && docIsCurrent) {
            compositorRef.current?.compositeRasterLayer(
              'worker-frame',
              wb.bitmap,
              [1, 0, 0, 1, 0, 0],
              'normal',
            );
          } else {
            const delta = workerBitmapDelta(
              wb.camera,
              { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation ?? 0 },
              vp,
              dpr,
            );
            if (delta) {
              compositorRef.current?.compositeRasterLayer(
                'worker-frame',
                wb.bitmap,
                delta,
                'normal',
              );
            } else {
              compositorRef.current?.drawVectorItems(ir);
            }
          }
          ctxNN.restore();
        } else {
          compositorRef.current?.drawVectorItems(ir);
        }
      } else {
        compositorRef.current?.drawVectorItems(ir);
      }

      // Record replay time: from the first replay call to just before cleanup
      replayMs = performance.now() - replayStartTime;

      if (dirtyClipOpen) {
        ctx.restore();
        dirtyClipOpen = false;
      }
      const budget = endFrameTiming(frameStart);
      frameBackend?.endFrame();
      compositorFrameOpen = false;
      // Recompute both limits on every tier so recovery restores the user's
      // configured budget. The preset remains a ceiling even in quality mode.
      const adaptiveCacheLimits = getAdaptiveCacheLimits(budgets, cacheMultiplier);
      subtreeIrCacheRef.current.setSoftBudget(adaptiveCacheLimits.subtreeIrCacheBytes);
      engineNodeMemoRef.current.setMaxEntries(adaptiveCacheLimits.engineNodeMemoEntries);
      // Redraw attribution: why is this frame being drawn at all, and (when a
      // dirty frame fell back to full redraw) why was partial redraw skipped?
      const prevCamera = prevCameraForRedrawRef.current;
      const cameraChanged =
        prevCamera !== null &&
        (prevCamera.zoom !== s.zoom ||
          prevCamera.pan.x !== s.pan.x ||
          prevCamera.pan.y !== s.pan.y ||
          prevCamera.rotation !== (s.cameraRotation ?? 0));
      const redrawReason: RedrawReason = resolveRedrawReason({
        docChanged: lastRenderedDocRef.current !== doc,
        dirtyKind: dirty.kind,
        cameraChanged,
        imageCacheStampChanged: prevImageCacheStampForRedrawRef.current !== imageCacheStamp,
        fontLoadStampChanged: prevFontLoadStampForRedrawRef.current !== fontLoadStamp,
        variableOnlyChange: false,
      });
      const viewportArea = VP_W * VP_H;
      const dirtyAreaRatio =
        dirty.kind === 'none'
          ? 0
          : dirty.kind === 'full'
            ? 1
            : dirtyRect && viewportArea > 0
              ? Math.min(1, (dirtyRect.w * dirtyRect.h) / viewportArea)
              : 1;
      const fullRedrawReason =
        dirty.kind !== 'none' && !usePartialRedraw
          ? (resolveFullRedrawReason({
              rotation: s.cameraRotation ?? 0,
              profileEnablePartialRedraw: profile.enablePartialRedraw,
              dirtyRectArea: dirtyRect ? dirtyRect.w * dirtyRect.h : 0,
              viewportArea,
              hasDirtyRect: dirtyRect !== null,
              surfaceMatch,
            }) ?? undefined)
          : undefined;
      // The surface now shows this camera: a full redraw repainted everything,
      // and a partial redraw repainted the dirty rects over pixels that were
      // already valid for this same camera (surfaceMatch === 'match').
      paintedSurfaceRef.current = currentSurface;
      prevCameraForRedrawRef.current = {
        zoom: s.zoom,
        pan: s.pan,
        rotation: s.cameraRotation ?? 0,
      };
      prevImageCacheStampForRedrawRef.current = imageCacheStamp;
      prevFontLoadStampForRedrawRef.current = fontLoadStamp;
      // Record frame diagnostics (dev-only ring buffer)
      const cacheDiag = subtreeIrCacheRef.current.diagnostics();
      recordFrame({
        frameIndex: docVersionRef.current,
        docVersion,
        redrawCount: s.motion.isPlaying ? -1 : coordinator.getDiagnostics().submittedFrames,
        nodeCount: nodeIds.length,
        culledCount: hiddenByContainer.size,
        cacheHitCount: cacheHitsInFrame,
        buildIrMs,
        hashMs,
        replayMs,
        engineNodeComputes: engineMemo.computes - engineMemoComputesAtStart,
        engineNodeHits: engineMemo.hits - engineMemoHitsAtStart,
        setupMs,
        preLoopMs,
        totalMs: budget.elapsedMs,
        renderPath: needsStructural
          ? 'structural'
          : workerBitmapRef.current
            ? 'worker-cached'
            : 'compositor',
        wasDirty: dirty.kind !== 'none',
        partialRedraw: !!usePartialRedraw,
        cacheBytes: cacheDiag.bytes,
        cacheEntries: cacheDiag.entries,
        profileTier: profile.tier,
        redrawReason,
        invalidationReasons: [...frameDecision.reasons],
        frameSource: frameDecision.explicit[0]?.source,
        unsuppressedCause: frameDecision.unsuppressedCause ?? undefined,
        dirtyAreaRatio,
        dirtyRects: dirty.kind === 'partial' ? dirty.rectCount : 0,
        dirtyRectsAfter: mergedDirty?.afterCount,
        dirtyAmplification: mergedDirty?.amplification,
        dirtyMergeFallback: mergedDirty?.fallback === 'none' ? undefined : mergedDirty?.fallback,
        fullRedrawReason,
        dirtyScreenRect: resolveDirtyScreenRect(!!usePartialRedraw, dirtyRect, dpr),
      });
      pendingPresentRef.current = false;
      coordinator.completeFrame(frameDecision, frameSnapshot, {
        contentDrawn: true,
        fullRedraw: dirty.kind === 'full' || (dirty.kind !== 'none' && !usePartialRedraw),
      });
      const diag = compositorRef.current?.getDiagnostics?.();
      if (diag) setCompositorDiagnostics(diag);
      if (stateRef.current.document === doc) lastRenderedDocRef.current = doc;
    })().finally(() => {
      // Restore in reverse save order even when IR building or replay throws.
      // An unbalanced dirty clip survives setTransform() and can make every
      // later camera-only frame look blank.
      if (dirtyClipOpen) {
        ctx.restore();
        dirtyClipOpen = false;
      }
      if (compositorFrameOpen) {
        frameBackend?.endFrame();
        compositorFrameOpen = false;
      }
      drawInFlightRef.current = false;
      if (drawPendingRef.current) {
        drawPendingRef.current = false;
        // A trigger arrived during the in-flight draw — schedule one more pass
        // (coalesced on the shared content key); the coordinator decides
        // whether it actually needs to render.
        redrawCoordinatorRef.current?.noteRescheduledDuringRender();
        const pendingKey = contentDrawFrameKey.current;
        if (pendingKey) scheduleCanvasFrame(pendingKey, 'canvas', () => drawContent());
      }
    });
  }, [
    rootNodes,
    state.zoom,
    state.pan.x,
    state.pan.y,
    state.cameraRotation,
    state.canvasMode,
    state.themeRevision,
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
    dropTargetFrameId,
    maskDropTargetId,
  });

  // ─── Input pipeline (pointer, wheel, keyboard handlers) ──────────────────
  const input = useCanvasInputs({
    contentCanvasRef,
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
        buildToolCtx={buildToolCtx}
        renameDialog={renameDialog}
        setRenameDialog={setRenameDialog}
        renameDialogRef={renameDialogRef}
        renameInputRef={renameInputRef}
        artboardRect={artboardRect}
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
    </section>
  );
}
