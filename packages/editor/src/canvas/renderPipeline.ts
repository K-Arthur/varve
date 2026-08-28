import type { CompositorBackend, CompositorDiagnostics } from '@varve/compositor';
import {
  acquireMaskSurface,
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
  type Engine,
  type EngineColor,
  type SceneNode as EngineNode,
  fitRasterDimensions,
  gaussianBlurSeparable,
  getImageCache,
  mapBlendMode,
  type ReplayTarget,
  releaseMaskSurface,
  replayIr,
  retainImageResourceHandles,
  totalEffectExpansion,
} from '@varve/engine';
import {
  applyBindingsToNode,
  applySoloToDocument,
  buildAllVariantCaches,
  buildParentIndexMap,
  createVariableStore,
  type Document,
  documentHasSolo,
  getEffectiveNode,
  isAnimatedMediaNode,
  isContainer,
  isWarpedContainer,
  multipageRootNodes,
  type NodeId,
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
  resolveBlendEvaluationSpace,
  worldToScreen,
} from '@varve/shared';
import type { EditorContextValue, EditorState } from '../context';
import { isEditorInteractionActive } from '../performance/editorFrameRuntime';
import { applyPropertyPath } from '../propertyPath';
import {
  getAdaptiveResidencyManager,
  selectRasterRepresentation,
} from '../render/adaptiveResidency';
import {
  closeImageBitmapMap,
  collectImageBitmaps,
  type RenderWorkerHost,
  sceneCanUseWorkerRenderer,
  sceneNeedsStructuralCompositing,
  sceneNodeToEngineNode,
  workerBitmapDelta,
} from '../render/canvasRenderAdapter';
import { admitWorkerImagePayload, workerSourceCapFor } from '../render/collectImageBitmaps';
import { scheduleSettledImageRefinement } from '../render/imageRefinement';
import { decorateMockupIr, MockupSurfaceCache } from '../render/mockup/mockupIr';
import { pathShapeInTextSpace } from '../render/pathTextGeometry';
import {
  decoratePerspectiveImages,
  documentHasPerspectiveImage,
  perspectiveSurfaceCache,
} from '../render/perspectiveImage';
import { alphaBounds } from '../render/surfaceBounds';
import { documentNeedsWorkerFonts } from '../render/workerFonts';
import {
  collectMasterOffsets,
  offsetWorldBounds,
  offsetWorldTransform,
} from '../scene/masterOffsets';
import {
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  type TransformCache,
} from '../scene/transformCache';
import { sampleTimelineAt } from '../timeline/TimelineSampler';
import {
  evaluateWarpedContainerItems,
  warpedContainerWorldBounds,
} from '../warp/warpContainerRender';
import { computeProfile } from './adaptiveProfile';
import {
  applyEditorCameraToCtx,
  toCamera as editorToCamera,
  viewportWorldRect,
} from './cameraState';
import { resizeCanvasBackingStore } from './canvasSurface';
import { canCullDescendantsWithContainerBounds } from './containerCulling';
import { computeDirtyPruneDecision, rectsIntersectAny } from './dirtyQuery';
import {
  type DirtyRegionRecorder,
  type PaintedSurfaceIdentity,
  paintedSurfaceAfterFrame,
  type RedrawReason,
  resolveFullRedrawReason,
  resolveRedrawReason,
  surfaceMatchesBackingStore,
} from './dirtyRegion';
import { computeFrameDirtyRegion } from './dirtyRegionMerge';
import { expandReplayList } from './dirtyReplay';
import type { EngineNodeMemo } from './engineNodeMemo';
import { applyAdjustmentSpatialMask, replayMaskedContainer } from './maskReplay';
import { openFullRedraw, openMultiRectPartialClip, openUnionPartialClip } from './partialPaint';
import {
  beginContentFrame,
  createNodeWorkCounters,
  endFrameTiming,
  getAdaptiveCacheLimits,
  getAverageFrameTime,
  type getMemoryBudgets,
  getOverBudgetCount,
  type RedrawCoordinator,
  type RedrawReason as RedrawCoordinatorReason,
  recordFrame,
  recordMergedDirty,
  recordNodeWork,
  recordPruneScreenRects,
  resolveDirtyScreenRect,
  scheduleCanvasFrame,
  startFrameTiming,
} from './perfRuntime';
import { drawPageDecorations, tryPresentWorkerFrame } from './presentWorkerFrame';
import type { NodeHashMemo, SubtreeIrCache } from './subtreeIrCache';
import { appearancePaddingWorld, expandRect, nodeVisualWorldBounds } from './visualBounds';

let _showOriginalBgNodeId: string | null = null;

/**
 * Whether the worker can be trusted with this document's text.
 *
 * The question is per family, not per batch: a document that uses only
 * families the worker has actually loaded keeps the fast path even while some
 * other declared family is still arriving or has failed there. Text in a
 * family the worker cannot draw stays on the main thread.
 */
function workerHasFontsForDocument(
  host: { unavailableFontFamilies: ReadonlySet<string> } | null,
  doc: Document,
): boolean {
  if (!host) return false;
  return !documentNeedsWorkerFonts(doc, host.unavailableFontFamilies);
}

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

export interface RenderContentDeps {
  contentCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  engineRef: React.MutableRefObject<Engine | null>;
  compositorRef: React.MutableRefObject<CompositorBackend | null>;
  renderWorkerRef: React.MutableRefObject<RenderWorkerHost | null>;
  workerBitmapRef: React.MutableRefObject<{
    bitmap: ImageBitmap;
    docVersion: number;
    camera: Camera;
    viewport: { width: number; height: number };
    dpr: number;
  } | null>;
  paintedSurfaceRef: React.MutableRefObject<PaintedSurfaceIdentity | null>;
  dirtyRecorderRef: React.MutableRefObject<DirtyRegionRecorder>;
  subtreeIrCacheRef: React.MutableRefObject<SubtreeIrCache>;
  nodeHashMemoRef: React.MutableRefObject<NodeHashMemo>;
  engineNodeMemoRef: React.MutableRefObject<EngineNodeMemo>;
  drawInFlightRef: React.MutableRefObject<boolean>;
  drawPendingRef: React.MutableRefObject<boolean>;
  lastRenderedDocRef: React.MutableRefObject<Document>;
  docVersionRef: React.MutableRefObject<number>;
  redrawCoordinatorRef: React.MutableRefObject<RedrawCoordinator | null>;
  dirtyRectRef: React.MutableRefObject<{ x: number; y: number; w: number; h: number } | null>;
  pendingPresentRef: React.MutableRefObject<boolean>;
  workerFailedRef: React.MutableRefObject<boolean>;
  sunkenColorRef: React.MutableRefObject<string>;
  transformCacheRef: React.MutableRefObject<TransformCache>;
  mockupSurfaceCacheRef: React.MutableRefObject<MockupSurfaceCache | null>;
  prevCameraForRedrawRef: React.MutableRefObject<{
    zoom: number;
    pan: { x: number; y: number };
    rotation: number;
  } | null>;
  prevImageCacheStampForRedrawRef: React.MutableRefObject<number>;
  prevFontLoadStampForRedrawRef: React.MutableRefObject<number>;
  contentDrawFrameKey: React.MutableRefObject<string | null>;
  requestContentDrawRef: React.MutableRefObject<
    ((source: string, reason: RedrawCoordinatorReason) => void) | null
  >;
  stateRef: React.MutableRefObject<EditorState>;
  displayDpr: number;
  imageCacheStamp: number;
  fontLoadStamp: number;
  precomputedStyles: ReturnType<typeof resolveAllStyles>;
  precomputedVariantCaches: ReturnType<typeof buildAllVariantCaches>;
  budgets: ReturnType<typeof getMemoryBudgets>;
  editor: EditorContextValue;
  setCompositorDiagnostics: (diagnostics: CompositorDiagnostics) => void;
  scheduleDrawContent: () => void;
}

export function renderContent(deps: RenderContentDeps): void {
  const {
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
    scheduleDrawContent,
  } = deps;

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
    const doc = documentHasSolo(s.document) ? applySoloToDocument(s.document) : s.document;
    _showOriginalBgNodeId = s.showOriginalBgNodeId ?? null;

    // Render resources are session-derived. Retain only sources owned by the
    // active document before any frame can return through the present-only
    // path, so switching documents cannot leave encoded handles or decoded
    // proxy/full images pinned by global caches.
    retainImageResourceHandles(Object.keys(doc.assets ?? {}));
    const activeImageSources = new Set<string>();
    for (const asset of Object.values(doc.assets ?? {})) activeImageSources.add(asset.dataUrl);
    for (const asset of Object.values(doc.rasterMaskAssets ?? {}))
      activeImageSources.add(asset.dataUrl);
    for (const source of perspectiveSurfaceCache.sources()) activeImageSources.add(source);
    for (const source of mockupSurfaceCacheRef.current?.sources() ?? []) {
      activeImageSources.add(source);
    }
    if (doc.assets !== undefined || doc.rasterMaskAssets !== undefined) {
      getImageCache().retainSources(activeImageSources);
    }

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
        // The presented bitmap is an authoritative render of the current
        // document (docVersion must match for the present to succeed), so the
        // dirty-diff baseline advances to it like any other completed frame.
        lastRenderedDocRef.current = doc;
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
    const resolvedStyles = doc === s.document ? precomputedStyles : resolveAllStyles(doc);
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
      doc === s.document ? precomputedVariantCaches : buildAllVariantCaches(doc);
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
      !documentHasPerspectiveImage(doc) &&
      sceneCanUseWorkerRenderer(doc, (src) => getImageCache().isLoaded(src)) &&
      !sceneNeedsStructuralCompositing(doc) &&
      // The worker realm has its own FontFaceSet and does not inherit the
      // document's @font-face rules. Until it has adopted them, text in a
      // declared family would be drawn there in a substituted face — the same
      // wrong typography this whole area is about, arriving by a different
      // route. Decided synchronously, before the frame picks its branch.
      workerHasFontsForDocument(renderWorkerRef.current, doc);
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
            let pathWorld = getCachedWorldTransform(cache, doc, pathNodeId);
            const pathMasterOffset = masterOffsets.get(pathNodeId);
            if (pathMasterOffset) pathWorld = offsetWorldTransform(pathWorld, pathMasterOffset);
            (built.shape as Record<string, unknown>).pathShape = pathShapeInTextSpace(
              pathNode.shape as import('@varve/engine').Shape,
              pathWorld,
              world,
            );
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

    // Animated-media nodes rebuild their (small) per-node IR each frame —
    // the media frame index rides in the fill, so subtree IR caching
    // would serve stale frames.
    for (const node of Object.values(doc.nodes)) {
      if (node && isAnimatedMediaNode(node, doc)) animatedNodeIds.add(node.id);
    }

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
      const irSlots: Array<Awaited<ReturnType<Engine['buildIr']>>[number] | undefined> = new Array(
        nodeIds.length,
      );
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
    const cameraMoving = isEditorInteractionActive();
    const imageIntent = cameraMoving ? 'interactive' : 'settled-preview';
    const imageRepresentation = selectRasterRepresentation({
      viewportWidth: VP_W,
      viewportHeight: VP_H,
      devicePixelRatio: dpr,
      zoom: s.zoom,
      cameraMoving,
      intent: imageIntent,
    });
    const replayImagePolicy = {
      intent: imageIntent,
      resolveMaxSourceDim: ({
        projectedLongEdge,
        sourceWidth,
        sourceHeight,
      }: {
        projectedLongEdge: number;
        sourceWidth?: number;
        sourceHeight?: number;
      }) =>
        selectRasterRepresentation({
          viewportWidth: VP_W,
          viewportHeight: VP_H,
          devicePixelRatio: dpr,
          zoom: s.zoom,
          projectedLongEdge,
          sourceWidth,
          sourceHeight,
          maxDecodedBytes: budgets.imageCacheBytes,
          cameraMoving,
          intent: imageIntent,
        }).maxSourceDim,
    };
    const replayColorOptions = {
      blendEvaluationSpace: resolveBlendEvaluationSpace(doc.colorConfig ?? {}),
    };
    const residency = getAdaptiveResidencyManager();
    residency.beginFrame();
    const averageFrameTime = getAverageFrameTime();
    residency.setPressure(
      averageFrameTime > 50
        ? 'critical'
        : averageFrameTime > 32
          ? 'high'
          : averageFrameTime > 20
            ? 'elevated'
            : 'normal',
    );
    residency.setBudgets({
      cpuBytes: budgets.imageCacheBytes,
      gpuBytes: budgets.workerBitmapBytes,
    });
    const observedImageSources = new Set<string>();
    for (const item of ir) {
      for (const fill of item.fills ?? []) {
        if (fill.type !== 'image' || fill.visible === false || observedImageSources.has(fill.src)) {
          continue;
        }
        observedImageSources.add(fill.src);
        const sourceWidth = Math.max(1, fill.imageWidth ?? 1);
        const sourceHeight = Math.max(1, fill.imageHeight ?? 1);
        const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
        const residentLongEdge = Math.min(sourceLongEdge, imageRepresentation.maxSourceDim);
        const scale = residentLongEdge / sourceLongEdge;
        residency.observe({
          resourceId: `${doc.id}:${fill.src}`,
          resourceType: 'image-source',
          documentId: doc.id,
          cpuBytes: Math.ceil(sourceWidth * scale) * Math.ceil(sourceHeight * scale) * 4,
          visibility: 'visible',
          priority: 'visible',
          fidelity: scale < 1 ? 'interactive-medium' : 'interactive-high',
          representation: scale < 1 ? 'proxy' : 'full',
          recreationCost: sourceLongEdge / 1024,
          reuseProbability: 0.5,
        });
      }
    }

    if (cameraMoving && observedImageSources.size > 0) {
      scheduleSettledImageRefinement(canvas, isEditorInteractionActive, () => {
        requestContentDrawRef.current?.('image-settled-refinement', 'asset-ready');
      });
    }

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

    // Whether this frame's pixels are an authoritative render of
    // `currentSurface`. Cleared by any path that paints an approximation
    // (today: a reprojected worker bitmap), so the painted-surface identity
    // is only recorded when retained pixels are genuinely reusable.
    let surfaceIsAuthoritative = true;
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
      // Structural replay has an active Canvas2D save/clip stack. A compositor
      // backend may render a leaf into another surface and blit it back, which
      // cannot inherit that clip. The compositor forwards image policy to its
      // Canvas2D fallback, keeping proxy selection footprint-aware on both
      // structural and flat scenes.
      if (targetCtx === ctxNN && compositorRef.current && !needsStructural) {
        compositorRef.current.drawVectorItems([item], replayColorOptions, replayImagePolicy);
      } else {
        replayIr(
          targetCtx as unknown as ReplayTarget,
          [item],
          undefined,
          undefined,
          replayImagePolicy,
          replayColorOptions,
        );
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
      // Container masks (clip/alpha/luminance on frames and groups) replay
      // through the shared maskReplay module. Shape-level raster masks
      // (background removal) must NOT take this branch: `replayMaskedContainer`
      // renders the node's *children*, which shapes do not have — routing a
      // masked shape here throws `n.children is not iterable` and aborts the
      // frame mid-paint, leaving a half-cleared backing store (the reported
      // "images disappear while selection bounds remain" failure). Shapes
      // composite their alpha mask through the flat IR leaf path
      // (FillIR.alphaMask in the engine replay), which is always correct.
      if (
        n.kind !== 'adjustment' &&
        isContainer(n) &&
        mask &&
        (maskSrcId ||
          (mask.vectorMask && mask.vectorMask.points.length > 0) ||
          mask.rasterMask !== undefined)
      ) {
        replayForceAll = true;
        const handled = replayMaskedContainer(targetCtx, {
          node: n as import('@varve/scene').SceneNode,
          mask,
          maskSrcId: maskSrcId ?? null,
          maskChild: maskChild ?? null,
          itemTransform: item?.transform,
          doc,
          cache,
          baseTransform: targetCtx.getTransform(),
          replayNode: (nodeId, ctx) => replaySubtreeToCtx(nodeId, ctx),
          getWorldTransform: (nodeId) => getCachedWorldTransform(cache, doc, nodeId),
        });
        if (handled) return;
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
                effectCtx.shadowBlur = (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
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
                effectCtx.shadowBlur = (effect.blur + Math.max(0, effect.spread) / 2) * renderScale;
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
          // Resolve legacy sibling-below behavior through the same central
          // scope resolver so parent/child targets are not replayed twice.
          targetIds = new Set(resolveAdjustmentScope(doc, undefined, nodeId));
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

        // Effects that generate pixels outside the source bounds (bloom,
        // RGB displacement, flares, streaks) need a padded backdrop so they
        // are not clipped at the region rectangle. The pad derives from the
        // registry-driven effect expansion (doc px, scaled by the camera)
        // with a bounded maximum for live-preview memory safety. The export
        // path applies the full, uncapped expansion.
        //
        // The region is computed in device pixels via the current
        // transform (doc → device), and the coordSpace carries that same
        // mapping so doc-anchored effect parameters (dither cells, split
        // offsets, bloom radii) stay invariant under pan/zoom.
        let effectPad = 80;
        let coordSpace:
          | { scale: number; originX: number; originY: number; regionX: number; regionY: number }
          | undefined;
        try {
          const cam = targetCtx.getTransform();
          const camScale = Math.abs(cam.a) || 1;
          const [expL, expT, expR, expB] = totalEffectExpansion(adjFilters);
          effectPad = Math.min(
            512,
            Math.max(80, Math.ceil(Math.max(expL, expT, expR, expB) * camScale)),
          );
          coordSpace = {
            scale: camScale,
            originX: cam.e,
            originY: cam.f,
            regionX: 0,
            regionY: 0,
          };
        } catch {
          effectPad = 80;
        }
        const camScale = coordSpace?.scale ?? 1;
        const camOriginX = coordSpace?.originX ?? 0;
        const camOriginY = coordSpace?.originY ?? 0;
        const devMinX = minX * camScale + camOriginX;
        const devMinY = minY * camScale + camOriginY;
        const devW = (maxX - minX) * camScale;
        const devH = (maxY - minY) * camScale;
        let bx = devMinX - effectPad;
        let by = devMinY - effectPad;
        let bw = devW + effectPad * 2;
        let bh = devH + effectPad * 2;
        if (coordSpace) {
          coordSpace.regionX = bx;
          coordSpace.regionY = by;
        }

        let backdrop: HTMLCanvasElement;
        try {
          // Render the resolved target set into the adjustment surface instead
          // of copying the entire canvas. Copying the canvas only bounded the
          // filter geographically; it still processed unrelated pixels inside
          // that rectangle, which made explicit A+C targets affect B whenever
          // their bounds overlapped.
          const camera = targetCtx.getTransform();
          const targetSurface = acquireMaskSurface(cw, ch);
          try {
            const targetSurfaceCtx = targetSurface.getContext('2d');
            if (!targetSurfaceCtx) return;
            targetSurfaceCtx.setTransform(
              camera.a,
              camera.b,
              camera.c,
              camera.d,
              camera.e,
              camera.f,
            );
            replayForceAll = true;
            for (const targetId of targetIds) {
              replaySubtreeToCtx(targetId, targetSurfaceCtx);
            }
            const actual = alphaBounds(targetSurfaceCtx, targetSurface.width, targetSurface.height);
            if (actual) {
              bx = actual.x - effectPad;
              by = actual.y - effectPad;
              bw = actual.w + effectPad * 2;
              bh = actual.h + effectPad * 2;
              if (coordSpace) {
                coordSpace.regionX = bx;
                coordSpace.regionY = by;
              }
            }
            backdrop = document.createElement('canvas');
            backdrop.width = Math.ceil(bw);
            backdrop.height = Math.ceil(bh);
            const bCtx = backdrop.getContext('2d');
            if (!bCtx) return;
            bCtx.setTransform(1, 0, 0, 1, 0, 0);
            bCtx.translate(-bx, -by);
            bCtx.drawImage(targetSurface, 0, 0);
          } finally {
            releaseMaskSurface(targetSurface);
          }
        } catch {
          return;
        }

        const bCtx = backdrop.getContext('2d');
        if (!bCtx) return;
        applyFilterWithCompositing(bCtx, adjFilters, backdrop.width, backdrop.height, {
          coordSpace,
        });

        // Spatial mask: the adjustment's own mask limits WHERE the filtered
        // result is visible (its scope limits WHAT content is processed) —
        // see maskReplay.applyAdjustmentSpatialMask for the semantics.
        const adjMask = adjNode.mask && adjNode.mask.visible !== false ? adjNode.mask : null;
        if (adjMask) {
          replayForceAll = true;
          const cam = targetCtx.getTransform();
          applyAdjustmentSpatialMask({
            backdropCtx: bCtx,
            mask: adjMask,
            doc,
            camera: cam,
            regionX: bx,
            regionY: by,
            replayNode: (nodeId, ctx) => replaySubtreeToCtx(nodeId, ctx),
            getWorldTransform: (nodeId) => getCachedWorldTransform(cache, doc, nodeId),
          });
        }

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
    //
    // The image payload is admitted synchronously as part of this gate. It
    // used to be decided only inside `collectImageBitmaps`, whose refusal
    // arrives in an async continuation — by then this frame had already
    // composited the previously cached worker bitmap, and since no fresh
    // frame was ever posted the surface stayed pinned to that stale bitmap,
    // reprojected on every camera move. A document carrying more distinct
    // image sources than the transfer budget therefore rendered the images
    // that existed when the last accepted worker frame was produced and
    // nothing after: fit-all showed one image out of thirteen, and panning
    // smeared the old frame instead of repainting. Deciding here keeps the
    // rule "never composite a stale bitmap unless a fresh one is coming".
    const workerImageRefusal = admitWorkerImagePayload(ir, {
      maxEntries: budgets.workerImageBitmaps,
      residentSources: renderWorkerRef.current?.knownImageSources,
    });
    const workerReady =
      workerImageRefusal === null &&
      !documentHasPerspectiveImage(doc) &&
      sceneCanUseWorkerRenderer(doc, (src) => getImageCache().isLoaded(src));

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

    // Perspective (four-corner) image decoration: replace image items whose
    // fill carries a `perspective` quad with a `warpedImage` primitive. Runs
    // after mockup decoration (which only appends extras to the tail of `ir`,
    // so `ir[i]` still corresponds to `nodeIds[i]`). The source subtrees are
    // replayed through the structural path with the prune force flag set.
    decoratePerspectiveImages({
      doc,
      nodeIds,
      items: ir,
      qualityScale: 1,
    });

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
        const hostAtCollection = renderWorkerRef.current;
        // Viewport-sufficient source cap for the worker transport: a 48 MP
        // photo decodes to a ~2-4K transferable bitmap that fits the worker
        // admission budget instead of a full-RGBA transfer that would be
        // refused. Power-of-two steps give zoom hysteresis (no representation
        // thrash around the cap boundary); zooming deeper raises the cap and
        // the at-size cache entry change re-renders the frame sharper.
        const maxSourceDim = workerSourceCapFor(Math.max(VP_W, VP_H), dpr, s.zoom);
        void collectImageBitmaps(ir, {
          maxEntries: budgets.workerImageBitmaps,
          residentSources: hostAtCollection?.knownImageSources,
          ...(maxSourceDim > 0 ? { maxSourceDim } : {}),
        }).then((collected) => {
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
              blendEvaluationSpace: replayColorOptions.blendEvaluationSpace,
              dpr,
              images: collected.images,
              imageSources: collected.sources,
            },
            collected.transfer,
          );
          if (!posted && !workerFailedRef.current) {
            workerFailedRef.current = true;
            requestContentDrawRef.current?.('worker-admission', 'backing-store-recovery');
          }
        });
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
            compositorRef.current?.compositeRasterLayer('worker-frame', wb.bitmap, delta, 'normal');
            // This surface now shows a RESAMPLED older frame, not an
            // authoritative render of the current camera: regions the camera
            // just exposed contain stretched edge content, not scene content.
            // Recording it as a matching painted surface would let the next
            // frame take the partial path and composite fresh dirty rects
            // over non-authoritative pixels — the stale-pixel failure mode
            // 9d47771b fixed for the main-thread path, on the worker path.
            surfaceIsAuthoritative = false;
          } else {
            compositorRef.current?.drawVectorItems(ir, replayColorOptions, replayImagePolicy);
          }
        }
        ctxNN.restore();
      } else {
        compositorRef.current?.drawVectorItems(ir, replayColorOptions, replayImagePolicy);
      }
    } else {
      compositorRef.current?.drawVectorItems(ir, replayColorOptions, replayImagePolicy);
    }

    // Record replay time: from the first replay call to just before cleanup
    replayMs = performance.now() - replayStartTime;

    if (dirtyClipOpen) {
      ctx.restore();
      dirtyClipOpen = false;
    }
    const budget = endFrameTiming(
      frameStart,
      undefined,
      cameraMoving ? 'interaction' : 'authoritative',
    );
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
    //
    // Unless this frame only approximated it. A reprojected worker bitmap is
    // a resampled older frame; claiming it as painted-at-this-camera would
    // authorise a partial redraw over pixels that were never rendered for
    // this camera. Leaving the identity null costs one full redraw and keeps
    // the incremental-equals-full invariant intact.
    paintedSurfaceRef.current = paintedSurfaceAfterFrame(currentSurface, surfaceIsAuthoritative);
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
      frameWorkClass: budget.workClass,
      frameWorkBudgetMs: budget.budgetMs,
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
      frameDecision: frameDecision.kind,
    });
    pendingPresentRef.current = false;
    coordinator.completeFrame(frameDecision, frameSnapshot, {
      contentDrawn: true,
      fullRedraw: dirty.kind === 'full' || (dirty.kind !== 'none' && !usePartialRedraw),
    });
    const diag = compositorRef.current?.getDiagnostics?.();
    if (diag) setCompositorDiagnostics(diag);
    // The dirty-diff baseline must advance to the document this frame PAINTED,
    // not merely the one that is still current. When a frame is overtaken
    // mid-flight (a document change lands during the async IR build — real on
    // desktop, where buildIr is a Tauri IPC await), the frame still paints its
    // captured document, and the surface then shows THAT document's pixels.
    // Guarding the advancement on `stateRef.current.document === doc` stalls
    // the baseline at an older document: the next partial frame diffs against
    // it, misses every pixel the overtaken frame painted (an intermediate
    // drag position, or a node's last painted location before a delete during
    // an interaction), and those pixels survive as stale ghosts.
    //
    // The advancement is safe because the partial diff's own completeness
    // invariant guarantees the surface is equivalent to a clean full render of
    // the painted document: everything outside the damage region was retained
    // unchanged, and the region of change is exactly where the two documents
    // differ. Diffing the next frame against the painted document therefore
    // covers precisely the pixels that differ between the surface and the new
    // document.
    lastRenderedDocRef.current = doc;
  })()
    .catch((error: unknown) => {
      // A frame that threw mid-paint left the surface partially repainted —
      // not a faithful render of any document. Never let the next frame reuse
      // those pixels: drop the painted-surface identity (the next frame must
      // be an authoritative full redraw — `surfaceMatchesBackingStore` reports
      // 'never-painted' for a null identity) and keep the dirty baseline at
      // the previously completed document (this painted doc was never
      // committed). One reschedule is requested so a failed frame is followed
      // by a full redraw even when nothing else invalidates.
      paintedSurfaceRef.current = null;
      requestContentDrawRef.current?.('frame-error', 'backing-store-recovery');
      if (typeof console !== 'undefined') {
        console.error('[varve-canvas] frame render failed; forcing a full redraw', error);
      }
    })
    .finally(() => {
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
        if (pendingKey) scheduleCanvasFrame(pendingKey, 'canvas', scheduleDrawContent);
      }
    });
}
