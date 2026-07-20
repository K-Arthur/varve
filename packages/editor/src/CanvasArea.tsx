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
import { type CompositorBackend, createCompositorBackend } from '@strata/compositor';
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
  getFontRegistry,
  getImageCache,
  mapBlendMode,
  prewarmWasmEngine,
  type ReplayTarget,
  renderEnhancedMask,
  replayIr,
  traceSceneNodeOutline,
} from '@strata/engine';
import { type ImportFileInput, ImportService } from '@strata/import';
import type { Document, NodeId, SceneNode } from '@strata/scene';
import {
  activePageNodes,
  addNode,
  applyBindingsToNode,
  buildAllVariantCaches,
  buildParentIndexMap,
  buildVariableDependencyMap,
  canBeClipMaskSource,
  createVariableStore,
  getChangedVariableIds,
  getEffectiveNode,
  getGuidesForPage,
  isContainer,
  isImageShape,
  makeRasterLayerNode,
  nextNodeId,
  resolveAdjustmentScope,
  resolveAllStyles,
  walkNodes,
} from '@strata/scene';
import {
  type Camera,
  clampZoom,
  computeFloatingOrigin,
  fitBoundsCamera,
  isWorldRectInViewport,
  managedColorToCss,
  screenToWorld,
  worldToScreen,
  zoomAboutPoint,
} from '@strata/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyEditorCameraToCtx, toCamera as editorToCamera } from './canvas/cameraState';
import {
  resizeCanvasBackingStore,
  subscribeToCanvasContextLifecycle,
  subscribeToDevicePixelRatio,
} from './canvas/canvasSurface';
import { canCullDescendantsWithContainerBounds } from './canvas/containerCulling';
import { computeDocumentDirtyRegion } from './canvas/dirtyRegion';
import { computeInvalidationPlan } from './canvas/invalidationPlan';
import { cacheContentParts, SubtreeIrCache } from './canvas/subtreeIrCache';
import { appearancePaddingWorld, expandRect, nodeVisualWorldBounds } from './canvas/visualBounds';
import { CanvasOverlays } from './components/CanvasOverlays';
import { nodeWorldBoundsFn, useEditor } from './context';
import { collectFilesFromDataTransfer } from './dropUtils';
import { useCollabPresence } from './hooks/useCollabPresence';
import { commitImageCrop } from './imageCrop';
import { closeImageBitmapMap, collectImageBitmaps } from './render/collectImageBitmaps';
import { setCompositorDiagnostics } from './render/compositorDiagnosticsStore';
import {
  sceneCanUseWorkerRenderer,
  sceneNeedsStructuralCompositing,
} from './render/sceneCompositing';
import { sceneNodeToEngineNode } from './render/sceneToEngine';
import { workerBitmapDelta } from './render/workerCamera';
import {
  createRenderWorkerHost,
  isStaleResponse,
  type RenderWorkerHost,
} from './render/workerHost';
import { type FrameSpatialIndex, getOrCreateFrameSpatialIndex } from './scene/spatialIndex';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateNodes,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import { nodeWorldBounds } from './scene/world';
import { loadSettings } from './settings';
import { sampleTimelineAt } from './timeline/TimelineSampler';
import { type DraftShape, type ToolContext, ToolManager } from './tools';

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

import { ArrowTool } from './tools/ArrowTool';
import { computeEdgeVelocity } from './tools/autoPan';
import { CloneStampTool } from './tools/CloneStampTool';
import { CropTool } from './tools/CropTool';
import { EllipseTool } from './tools/EllipseTool';
import { EyedropperTool } from './tools/EyedropperTool';
import { FrameTool } from './tools/FrameTool';
import { HandTool } from './tools/HandTool';
import { HealingBrushTool } from './tools/HealingBrushTool';
import { collectSourceEvents } from './tools/inputNormalizer';
import { LineTool } from './tools/LineTool';
import { NodeEditTool } from './tools/NodeEditTool';
import { PaintTool } from './tools/PaintTool';
import { PatchTool } from './tools/PatchTool';
import { PencilTool } from './tools/PencilTool';
import { PenTool } from './tools/PenTool';
import { PolygonTool } from './tools/PolygonTool';
import { RectangleTool } from './tools/RectangleTool';
import { RefineMaskTool } from './tools/RefineMaskTool';
import { ScaleTool } from './tools/ScaleTool';
import { SelectTool } from './tools/SelectTool';
import { SliceTool } from './tools/SliceTool';
import { SmudgeTool } from './tools/SmudgeTool';
import { SpotHealTool } from './tools/SpotHealTool';
import { StarTool } from './tools/StarTool';
import {
  createSnapSession,
  filterSnapTargets,
  type SnapGuide,
  type SnapSession,
  snapPosition,
} from './tools/snapping';
import { TextTool } from './tools/TextTool';
import { TrimapEditTool } from './tools/TrimapEditTool';
import { ZoomTool } from './tools/ZoomTool';

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
    color: import('@strata/engine').EngineColor;
    opacity: number;
    blendMode: import('@strata/scene').BlendMode;
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
      const { gaussianBlurSeparable } = require('@strata/engine');
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
      const { gaussianBlurSeparable } = require('@strata/engine');
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

/**
 * Parse a property path into segments. Supports dot notation and bracket
 * array indices, e.g. `opacity`, `transform[4]`, `fills[0].color`.
 */
function parsePropertyPath(path: string): string[] {
  const segments: string[] = [];
  const parts = path.split('.');
  for (const part of parts) {
    const match = /^([^[]+)((?:\[[^\]]+\])*)$/.exec(part);
    if (!match) {
      segments.push(part);
      continue;
    }
    const [, first, second] = match;
    if (first) segments.push(first);
    const bracketGroups = second ? second.matchAll(/\[([^\]]+)\]/g) : [];
    for (const m of bracketGroups) {
      const [, inner] = m;
      if (inner) segments.push(inner);
    }
  }
  return segments;
}

/**
 * Set a value at a nested property path without mutating original objects.
 * Clones arrays and records along the path.
 */
function setAtPath(value: unknown, segments: string[], newValue: unknown): unknown {
  if (segments.length === 0) return newValue;
  const [head, ...tail] = segments;
  if (Array.isArray(value)) {
    const idx = Number(head);
    if (Number.isNaN(idx)) return value;
    const next = value[idx] ?? (tail.length > 0 && /^\d+$/.test(tail[0]!) ? [] : {});
    const copy = [...value];
    copy[idx] = setAtPath(next, tail, newValue);
    return copy;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const next = record[head!] ?? (tail.length > 0 && /^\d+$/.test(tail[0]!) ? [] : {});
    return { ...record, [head!]: setAtPath(next, tail, newValue) };
  }
  return value;
}

/** Apply a property override to a target object using a dot/bracket path. */
export function applyPropertyPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const segments = parsePropertyPath(path);
  const head = segments[0]!;
  const tail = segments.slice(1);
  target[head] = setAtPath(target[head], tail, value);
}

/** Global ToolManager singleton for the editor lifetime. */
let toolManager: ToolManager | null = null;
function getToolManager(): ToolManager {
  if (!toolManager) {
    toolManager = new ToolManager('select');
    toolManager.register('select', () => new SelectTool());
    toolManager.register('inspect', () => new SelectTool());
    toolManager.register('hand', () => new HandTool());
    toolManager.register('zoom', () => new ZoomTool());
    toolManager.register('scale', () => new ScaleTool());
    toolManager.register('frame', () => new FrameTool());
    toolManager.register('rect', () => new RectangleTool());
    toolManager.register('ellipse', () => new EllipseTool());
    toolManager.register('line', () => new LineTool());
    toolManager.register('arrow', () => new ArrowTool());
    toolManager.register('polygon', () => new PolygonTool());
    toolManager.register('star', () => new StarTool());
    toolManager.register('pen', () => new PenTool());
    toolManager.register('pencil', () => new PencilTool());
    toolManager.register('text', () => new TextTool());
    toolManager.register('slice', () => new SliceTool());
    toolManager.register('eyedropper', () => new EyedropperTool());
    toolManager.register('nodeEdit', () => new NodeEditTool());
    toolManager.register('cloneStamp', () => new CloneStampTool());
    toolManager.register('healBrush', () => new HealingBrushTool());
    toolManager.register('spotHeal', () => new SpotHealTool());
    toolManager.register('patch', () => new PatchTool());
    toolManager.register('refineMask', () => new RefineMaskTool());
    toolManager.register('trimapEdit', () => new TrimapEditTool());
    toolManager.register('crop', () => new CropTool());
    toolManager.register('paint', () => new PaintTool(false));
    toolManager.register('eraser', () => new PaintTool(true));
    toolManager.register('smudge', () => new SmudgeTool());
  }
  toolManager.setTool('select');
  return toolManager;
}

/** Parse a simple grid-template string like "1fr 200px 1fr" into pixel sizes.
 *  Only handles px and fr units. fr units divide remaining space equally. */
function parseGridTemplate(template: string, totalSize: number): number[] {
  const parts = template.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  // First pass: compute total fr and used px space.
  let frCount = 0;
  let pxUsed = 0;
  const sizes: (number | 'fr')[] = [];
  for (const p of parts) {
    if (p.endsWith('fr')) {
      const n = Number.parseFloat(p);
      frCount += n;
      sizes.push('fr');
      pxUsed += 0;
    } else if (p.endsWith('px')) {
      const n = Number.parseFloat(p);
      pxUsed += n;
      sizes.push(n);
    } else {
      // Treat as px
      const n = Number.parseFloat(p);
      if (!Number.isNaN(n)) {
        pxUsed += n;
        sizes.push(n);
      }
    }
  }
  const frPx = frCount > 0 ? Math.max(0, (totalSize - pxUsed) / frCount) : 0;
  return sizes.map((s) => (s === 'fr' ? frPx : s));
}

/** Build a flat list of all selectable nodes in DFS paint order. */
function getAllSelectableNodes(doc: Document): SceneNode[] {
  const result: SceneNode[] = [];
  function walk(ids: NodeId[]) {
    for (const id of ids) {
      const n = doc.nodes[id];
      if (!n) continue;
      result.push(n);
      if (isContainer(n) && n.children.length > 0) {
        walk(n.children);
      }
    }
  }
  walk(doc.rootChildren);
  return result;
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
  const requestContentDrawRef = useRef<(() => void) | null>(null);
  const docVersionRef = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const transformCacheRef = useRef<TransformCache>(createTransformCache());
  const subtreeIrCacheRef = useRef(new SubtreeIrCache());
  // Frame/group spatial index, cached by fingerprint for fast drag containment.
  const frameIndexRef = useRef<FrameSpatialIndex | null>(null);
  const prevDrawDocRef = useRef(state.document);
  const lastRenderedDocRef = useRef(state.document);
  if (state.document !== prevDrawDocRef.current) {
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
        frameIndexRef.current = getOrCreateFrameSpatialIndex(state.document, frameIndexRef.current);
      } else {
        invalidateNodes(transformCacheRef.current, plan.changedIds);
        for (const id of plan.changedIds) {
          subtreeIrCacheRef.current.invalidate(id);
        }
        // Frame spatial index is unchanged — container bounds haven't changed.
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
  const contentDrawRafRef = useRef<number | null>(null);
  const overlayDrawRafRef = useRef<number | null>(null);
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

  // E1: Auto-pan when dragging near canvas edge.
  const autoPanRaf = useRef<number | null>(null);
  const autoPanVelocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // B-04: Dirty-rect tracking for partial redraw. Populated by draw()
  // diffing old vs current node world bounds.
  const dirtyRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const snapSessionRef = useRef<SnapSession>(createSnapSession());

  const collab = useCollabPresence(state.activeId, state.cursorPos, state.pan);
  const [nodeEditTargetId, setNodeEditTargetId] = useState<string | null>(null);
  const [nodeEditSelectedAnchors, setNodeEditSelectedAnchors] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [textEditTargetId, setTextEditTargetId] = useState<string | null>(null);
  const pendingAutoTextEditRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<SceneNode | null>(null);
  const [warpMesh, setWarpMesh] = useState<import('@strata/engine').MeshWarp | null>(null);
  const lastCursorUpdate = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [displayDpr, setDisplayDpr] = useState(() =>
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
  );
  const [renameDialog, setRenameDialog] = useState<{ defaultValue: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameDialogRef = useRef<HTMLDialogElement>(null);

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
        workerBitmapRef.current?.bitmap.close();
        workerBitmapRef.current = null;
        editorRef.current.announce('Canvas rendering context lost. Waiting to restore rendering.');
      },
      onRestored: () => {
        editorRef.current.announce('Canvas rendering restored.');
        requestContentDrawRef.current?.();
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
      requestContentDrawRef.current?.();
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
      requestContentDrawRef.current?.();
    });
    return () => {
      backend?.destroy();
      compositorRef.current = null;
    };
  }, []);

  const workerFailedRef = useRef(false);

  useEffect(() => {
    renderWorkerRef.current = createRenderWorkerHost(
      (msg) => {
        if (msg.type === 'frameRendered') {
          if (isStaleResponse(docVersionRef.current, msg.docVersion)) {
            msg.bitmap?.close();
            return;
          }
          if (msg.bitmap) {
            workerBitmapRef.current?.bitmap.close();
            workerBitmapRef.current = {
              bitmap: msg.bitmap,
              docVersion: msg.docVersion,
              camera: msg.camera,
              viewport: msg.viewport,
              dpr: msg.dpr,
            };
            requestContentDrawRef.current?.();
          }
        } else if (msg.type === 'error' && !workerFailedRef.current) {
          workerFailedRef.current = true;
          console.warn('[Strata] Render worker failed, falling back to main-thread:', msg.message);
          requestContentDrawRef.current?.();
        }
      },
      () => {
        if (!workerFailedRef.current) {
          workerFailedRef.current = true;
          console.warn('[Strata] Render worker stopped permanently; using main-thread Canvas 2D.');
          requestContentDrawRef.current?.();
        }
      },
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
    crop.setCommitHandler((rect) => {
      const id = crop.getNodeId();
      if (!id) return;
      editor.updateDoc((doc) => commitImageCrop(doc, id, rect));
      editor.announce('Crop applied');
    });
    return () => crop.setCommitHandler(null);
  }, [editor, state.tool]);

  // Re-render the canvas whenever an async image finishes loading.
  useEffect(() => {
    const unsub = getImageCache().subscribeGlobal(() => {
      setImageCacheStamp((n) => n + 1);
      requestRedrawRef.current?.();
    });
    return unsub;
  }, []);

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

  function buildToolCtx(ev: PointerEvent): ToolContext {
    const s = stateRef.current;
    const e = editorRef.current;
    const eng = engineRef.current;
    const sourceEvents = collectSourceEvents(ev, true);
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
      nodeWorldBounds: (n) => nodeWorldBounds(s.document, n.id) ?? nodeWorldBoundsFn(n),

      engine: eng,
      canvasElement: contentCanvasRef.current,
      hitTest: (world) => e.hitTestNode(world),

      beginTransaction: () => e.beginTransaction(),
      commitTransaction: () => e.commitTransaction(),
      abortTransaction: () => e.abortTransaction(),

      setTool: (id) => e.setTool(id),
      nodeEditTargetId,
      setNodeEditTargetId,
      setNodeEditSelectedAnchors,
      setTextEditTargetId,

      snapPosition: (bounds, _targets) => {
        if (!s.snapEnabled) {
          snapSessionRef.current = createSnapSession();
          return { x: bounds.x, y: bounds.y, guides: [] };
        }

        // D-02: Spatial + hierarchical filtering of snap targets
        const doc = stateRef.current.document;
        const allBoundsWithIds: Array<{
          nodeId: string;
          bounds: { x: number; y: number; w: number; h: number };
        }> = [];
        for (const n of Object.values(doc.nodes)) {
          const b = nodeWorldBounds(doc, n.id) ?? nodeWorldBoundsFn(n);
          if (b) allBoundsWithIds.push({ nodeId: n.id, bounds: b });
        }
        const parentIdx = buildParentIndexMap(doc);
        const draggedId = stateRef.current.selection[0] ?? '';
        const filtered = filterSnapTargets(
          bounds,
          { zoom: s.zoom },
          allBoundsWithIds,
          parentIdx,
          draggedId,
        );

        const pageBoundsTargets: Array<{ x: number; y: number; w: number; h: number }> = [];
        const activePageId = doc.activePageId;
        const pages = doc.pages;
        if (activePageId && pages) {
          const activePage = pages.find((p) => p.id === activePageId);
          if (activePage) {
            pageBoundsTargets.push({
              x: 0,
              y: 0,
              w: activePage.width,
              h: activePage.height,
            });
          }
        }
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
        const result = snapPosition(
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          allTargets,
          s.snapGrid,
          undefined,
          {
            zoom: s.zoom,
            session: snapSessionRef.current,
            guideTargets,
            layoutGridStep,
          },
        );
        snapSessionRef.current = result.session;
        setSnapGuides(result.guides);
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
    let frameBackend: CompositorBackend | null = null;
    let compositorFrameOpen = false;
    let dirtyClipOpen = false;

    (async () => {
      if (!ctx) return;
      const ctxNN = ctx;
      const s = stateRef.current;
      const doc = s.document;
      _showOriginalBgNodeId = s.showOriginalBgNodeId ?? null;

      const boardColor = (() => {
        const bg = doc.canvasBackground;
        if (bg) {
          if (bg.space === 'rgb') {
            return `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${(bg.a / 255).toFixed(3)})`;
          }
          try {
            return managedColorToCss(bg);
          } catch {
            // fallback on conversion failure
          }
        }
        return getComputedStyle(document.documentElement)
          .getPropertyValue('--color-surface-sunken')
          .trim();
      })();

      const entries = walkNodes(doc, activePageNodes(doc));
      const cache = transformCacheRef.current;
      const viewport = canvas.getBoundingClientRect();
      const vp = { width: viewport.width, height: viewport.height };
      const VP_W = vp.width;
      const VP_H = vp.height;
      const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };
      const cam = editorToCamera(camState);
      const applyCam = (targetCtx: CanvasRenderingContext2D) =>
        applyEditorCameraToCtx(targetCtx, camState, dpr, vp);
      const hiddenByContainer = new Set<string>();
      const resolvedStyles = resolveAllStyles(doc);

      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        if (
          isContainer(n) &&
          canCullDescendantsWithContainerBounds(n) &&
          'children' in n &&
          n.children.length > 0
        ) {
          const containerBounds = nodeVisualWorldBounds(doc, id, resolvedStyles);
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

      const dirty = computeDocumentDirtyRegion(lastRenderedDocRef.current, doc);
      if (dirty.kind === 'full') {
        dirtyRectRef.current = null;
      } else if (dirty.kind === 'partial') {
        const dirtyWorld = dirty.bounds;
        // Use the canonical camera transform so rotated views produce the
        // same dirty bounds as the pixels painted by the compositor.
        const origin = computeFloatingOrigin(cam, vp);
        const corners: Array<[number, number]> = [
          [dirtyWorld.x, dirtyWorld.y],
          [dirtyWorld.x + dirtyWorld.w, dirtyWorld.y],
          [dirtyWorld.x, dirtyWorld.y + dirtyWorld.h],
          [dirtyWorld.x + dirtyWorld.w, dirtyWorld.y + dirtyWorld.h],
        ];
        let minSx = Infinity;
        let minSy = Infinity;
        let maxSx = -Infinity;
        let maxSy = -Infinity;
        for (const [wx, wy] of corners) {
          const [px, py] = worldToScreen(cam, wx, wy, vp, origin);
          minSx = Math.min(minSx, px);
          minSy = Math.min(minSy, py);
          maxSx = Math.max(maxSx, px);
          maxSy = Math.max(maxSy, py);
        }
        dirtyRectRef.current = {
          x: Math.max(0, minSx - 40),
          y: Math.max(0, minSy - 40),
          w: Math.min(VP_W, maxSx - minSx + 80),
          h: Math.min(VP_H, maxSy - minSy + 80),
        };
      }

      const variantCaches = buildAllVariantCaches(doc);
      const variableStore = doc.variableStore ?? createVariableStore();

      const nodeIds: string[] = [];
      const flatNodes: EngineNode[] = [];
      for (const [id] of entries) {
        const raw = doc.nodes[id];
        if (!raw) continue;
        let n = getEffectiveNode(doc, id, variantCaches) ?? raw;
        if (!n.visible) continue;
        if (n.kind === 'group') continue;
        if (hiddenByContainer.has(id)) continue;
        n = applyBindingsToNode(n, variableStore);
        const world = getCachedWorldTransform(cache, doc, id);
        const worldBounds = getCachedWorldBounds(cache, doc, id);
        let engineNode = toEngineNode(n, doc);
        const styleOverrides = resolvedStyles.get(id);
        if (styleOverrides) engineNode = applyStyleOverrides(engineNode, styleOverrides);
        const visualBounds = worldBounds
          ? expandRect(worldBounds, appearancePaddingWorld(engineNode, world))
          : null;
        if (visualBounds && !isWorldRectInViewport(cam, vp, visualBounds)) continue;
        nodeIds.push(id);
        // Resolve path shape for text-on-path rendering
        if (
          engineNode.pathTextSettings?.pathNodeId &&
          (engineNode as { shape?: { kind: string } }).shape?.kind === 'text'
        ) {
          const pathNode = doc.nodes[engineNode.pathTextSettings.pathNodeId] as
            | import('@strata/scene').ShapeNode
            | undefined;
          if (pathNode?.shape) {
            (engineNode.shape as Record<string, unknown>).pathShape = pathNode.shape;
          }
        }
        flatNodes.push({ ...engineNode, transform: world });
      }

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

      if (canUsePerNodeIrCache && nodeIds.length > 0) {
        const irSlots: Array<Awaited<ReturnType<Engine['buildIr']>>[number] | undefined> =
          new Array(nodeIds.length);
        const nodesToBuild: EngineNode[] = [];
        const buildSlotIndices: number[] = [];

        for (let i = 0; i < nodeIds.length; i++) {
          const nodeId = nodeIds[i]!;
          const fn = flatNodes[i];
          if (!fn) continue;
          const isAnimated = animatedNodeIds.has(nodeId);
          if (!isAnimated) {
            const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
            const hash = SubtreeIrCache.nodeHash(
              nodeId,
              fn.transform,
              styleKey,
              cacheContentParts(fn).parts,
            );
            const cached = subtreeIrCacheRef.current.get(nodeId, hash);
            if (cached) {
              irSlots[i] = cached;
              continue;
            }
          }
          nodesToBuild.push(fn);
          buildSlotIndices.push(i);
        }

        if (buildSlotIndices.length === 0) {
          ir = irSlots as Awaited<ReturnType<Engine['buildIr']>>;
        } else if (buildSlotIndices.length === nodeIds.length) {
          ir = await eng.buildIr({ nodes: flatNodes });
          for (let i = 0; i < nodeIds.length; i++) {
            const nodeId = nodeIds[i];
            const fn = flatNodes[i];
            const item = ir[i];
            if (!nodeId || !fn || !item) continue;
            if (!animatedNodeIds.has(nodeId)) {
              const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
              const hash = SubtreeIrCache.nodeHash(
                nodeId,
                fn.transform,
                styleKey,
                cacheContentParts(fn).parts,
              );
              subtreeIrCacheRef.current.set(nodeId, hash, item);
            }
          }
        } else {
          const built = await eng.buildIr({ nodes: nodesToBuild });
          let builtIdx = 0;
          for (const slot of buildSlotIndices) {
            const nodeId = nodeIds[slot];
            const fn = flatNodes[slot];
            const item = built[builtIdx++];
            if (item) irSlots[slot] = item;
            if (nodeId && fn && item && !animatedNodeIds.has(nodeId)) {
              const styleKey = (doc.nodes[nodeId] as { styleId?: string }).styleId ?? '';
              const hash = SubtreeIrCache.nodeHash(
                nodeId,
                fn.transform,
                styleKey,
                cacheContentParts(fn).parts,
              );
              subtreeIrCacheRef.current.set(nodeId, hash, item);
            }
          }
          ir = irSlots as Awaited<ReturnType<Engine['buildIr']>>;
        }
      } else {
        ir = await eng.buildIr({ nodes: flatNodes });
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
        (s.cameraRotation ?? 0) === 0 &&
        dirtyRect &&
        dirtyRect.w > 0 &&
        dirtyRect.h > 0 &&
        dirtyRect.w * dirtyRect.h < VP_W * VP_H * 0.6;

      if (usePartialRedraw) {
        const dx = dirtyRect.x * dpr;
        const dy = dirtyRect.y * dpr;
        const dw = dirtyRect.w * dpr;
        const dh = dirtyRect.h * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(dx - 1, dy - 1, dw + 2, dh + 2);
        ctx.fillStyle = boardColor;
        ctx.fillRect(dx - 1, dy - 1, dw + 2, dh + 2);
        ctx.save();
        dirtyClipOpen = true;
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        applyCam(ctx);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = boardColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        applyCam(ctx);
      }

      dirtyRectRef.current = null;

      const paintLeafItem = (item: IrItem, targetCtx: CanvasRenderingContext2D): void => {
        if (targetCtx === ctxNN && compositorRef.current) {
          compositorRef.current.drawVectorItems([item]);
        } else {
          replayIr(targetCtx as unknown as ReplayTarget, [item]);
        }
      };

      function replaySubtreeToCtx(nodeId: string, targetCtx: CanvasRenderingContext2D): void {
        const n = doc.nodes[nodeId];
        if (!n || n.visible === false) return;
        const item = irByNodeId.get(nodeId);

        const mask = 'mask' in n && n.mask && n.mask.visible ? n.mask : null;
        const maskSrcId = mask ? mask.sourceNodeId : null;
        const maskChild = maskSrcId ? doc.nodes[maskSrcId] : null;
        if (mask && (maskSrcId || (mask.vectorMask && mask.vectorMask.points.length > 0))) {
          const baseTransform = targetCtx.getTransform();
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
                  for (const childId of (n as import('@strata/scene').ContainerNode).children) {
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
            points: import('@strata/engine').PathPoint[],
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
              for (const childId of (n as import('@strata/scene').ContainerNode).children) {
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
              for (const childId of (n as import('@strata/scene').ContainerNode).children) {
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
          const needsFlatten =
            isIsolated ||
            (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'passThrough') ||
            (n.opacity !== undefined && n.opacity < 1) ||
            visibleGroupEffects.length > 0;
          if (needsFlatten && n.children.length > 0) {
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const childId of n.children) {
              const b = nodeVisualWorldBounds(doc, childId, resolvedStyles);
              if (b) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
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
                    targetCtx.globalAlpha = effect.opacity * (n.opacity ?? 1);
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
          const adjNode = n as import('@strata/scene').AdjustmentNode;
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
            const b = nodeVisualWorldBounds(doc, nid, resolvedStyles);
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
        replaySubtreeToCtx(nodeId, ctxNN);
      }

      // Worker path when structural compositing is not required and every
      // image fill src is loaded (ImageBitmap Structured Clone transport).
      const workerReady = sceneCanUseWorkerRenderer(doc, (src) => getImageCache().isLoaded(src));

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
      } else if (renderWorkerRef.current && !workerFailedRef.current && workerReady) {
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
          void collectImageBitmaps(ir).then((collected) => {
            if (!collected) return;
            const host = renderWorkerRef.current;
            if (!host) {
              closeImageBitmapMap(collected.images);
              return;
            }
            const posted = host.post(
              {
                type: 'render',
                nodes: flatNodes,
                ir,
                camera: { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation ?? 0 },
                viewport: { width: VP_W, height: VP_H },
                docVersion,
                dpr,
                images: collected.images,
              },
              collected.transfer,
            );
            if (!posted && !workerFailedRef.current) {
              workerFailedRef.current = true;
              requestContentDrawRef.current?.();
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

      if (dirtyClipOpen) {
        ctx.restore();
        dirtyClipOpen = false;
      }
      frameBackend?.endFrame();
      compositorFrameOpen = false;
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
        // A trigger arrived while this draw was in flight — run once more
        // (on the next frame) to reflect the latest state, instead of
        // starting an overlapping build immediately.
        requestAnimationFrame(() => drawContent());
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
  ]);

  // ── requestRedraw: defence-in-depth redraw trigger ────────────────────
  // In addition to the drawContent-dependency-based RAF scheduling (which
  // works when state changes cause a React re-render that changes one of the
  // deps), provide a direct callback that bumps redrawCount to guarantee a
  // drawContent identity change. This covers edge cases such as:
  //   - engine/compositor init resolving outside the React commit phase
  //   - worker responses arriving during a React batch
  //   - lifecycle events (visibility change, context restored)
  //   - any other path where a direct drawContent call occurs
  const requestRedraw = useCallback(() => {
    setRedrawCount((n) => n + 1);
  }, []);
  const requestRedrawRef = useRef<() => void>(requestRedraw);
  requestRedrawRef.current = requestRedraw;

  useEffect(() => {
    requestContentDrawRef.current = () => {
      drawContent();
      // Also bump the redraw counter so the next React render gets a new
      // drawContent identity, making the RAF-scheduling effect re-fire.
      requestRedrawRef.current();
    };
  }, [drawContent, requestRedraw]);

  // ── Overlay canvas draw: layout grid overlay, draft shapes ──────────────

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = displayDpr;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    resizeCanvasBackingStore(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const doc = s.document;
    const cache = transformCacheRef.current;
    const entries = walkNodes(doc, activePageNodes(doc));
    const vp = { width: cssW, height: cssH };
    const camState = { zoom: s.zoom, pan: s.pan, cameraRotation: s.cameraRotation };

    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent-primary')
      .trim();

    // Clear overlay canvas (it's transparent otherwise)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyEditorCameraToCtx(ctx, camState, dpr, vp);

    // ── Mask preview overlay ──────────────────────────────────────────────
    const previewMode: import('./context/types').MaskPreviewMode = s.maskPreviewMode;
    const previewNodeId = s.selection[0];
    const previewNode = previewNodeId ? doc.nodes[previewNodeId] : undefined;
    const maskEditing = s.tool === 'refineMask' || s.tool === 'trimapEdit';
    if (
      previewMode !== 'none' &&
      maskEditing &&
      previewNode?.kind === 'shape' &&
      previewNode.mask?.rasterMask
    ) {
      const worldBounds = getCachedWorldBounds(cache, doc, previewNodeId);
      if (worldBounds) {
        ctx.save();
        const worldMat = getCachedWorldTransform(cache, doc, previewNodeId);
        const [a, b, c2, d2, e2, f2] = worldMat;
        ctx.transform(a, b, c2, d2, e2, f2);
        const w = worldBounds.w;
        const h = worldBounds.h;
        if (previewMode === 'checkerboard') {
          const sz = 8 / s.zoom;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w, h);
          ctx.clip();
          for (let py = 0; py < h; py += sz) {
            for (let px = 0; px < w; px += sz) {
              ctx.fillStyle =
                (Math.floor(px / sz) + Math.floor(py / sz)) % 2 === 0
                  ? 'rgba(0,0,0,0.15)'
                  : 'rgba(255,255,255,0.15)';
              ctx.fillRect(px, py, sz, sz);
            }
          }
          ctx.restore();
        } else if (previewMode === 'overlay') {
          ctx.fillStyle = 'rgba(0,120,255,0.2)';
          ctx.fillRect(0, 0, w, h);
          ctx.strokeStyle = 'rgba(0,120,255,0.5)';
          ctx.lineWidth = 2 / s.zoom;
          ctx.strokeRect(0, 0, w, h);
        } else if (previewMode === 'black') {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'white') {
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'mask-only') {
          ctx.fillStyle = 'rgba(128,128,128,0.4)';
          ctx.fillRect(0, 0, w, h);
        } else if (previewMode === 'edge') {
          ctx.strokeStyle = 'rgba(255,50,50,0.8)';
          ctx.lineWidth = 2 / s.zoom;
          ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);
          ctx.strokeRect(0, 0, w, h);
          ctx.setLineDash([]);
        }
        ctx.restore();
      }
    }

    // ── Drop target container highlight for drag operations ───────────────
    if (dropTargetFrameId) {
      const containerNode = doc.nodes[dropTargetFrameId];
      if (containerNode && (containerNode.kind === 'frame' || containerNode.kind === 'group')) {
        const containerWorld = getCachedWorldTransform(cache, doc, dropTargetFrameId);
        const cw = containerNode.kind === 'frame' ? containerNode.w : 0;
        const ch = containerNode.kind === 'frame' ? containerNode.h : 0;
        if (containerWorld && containerNode.kind === 'frame') {
          const [a, b, c, d, e2, f2] = containerWorld;
          ctx.save();
          ctx.strokeStyle = accentColor;
          ctx.lineWidth = 2 / s.zoom;
          ctx.setLineDash([6 / s.zoom, 4 / s.zoom]);
          ctx.beginPath();
          const corners = [
            [0, 0],
            [cw, 0],
            [cw, ch],
            [0, ch],
          ] as const;
          for (let i = 0; i < corners.length; i++) {
            const [lx, ly] = corners[i]!;
            const wx = a * lx + c * ly + e2;
            const wy = b * lx + d * ly + f2;
            if (i === 0) ctx.moveTo(wx, wy);
            else ctx.lineTo(wx, wy);
          }
          ctx.closePath();
          ctx.stroke();
          ctx.restore();
        } else if (containerNode.kind === 'group') {
          // Groups don't have explicit w/h; draw a dashed outline around
          // the union of their children's world bounds.
          const groupBounds = getCachedWorldBounds(cache, doc, dropTargetFrameId);
          if (groupBounds) {
            const { x, y, w, h } = groupBounds;
            ctx.save();
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2 / s.zoom;
            ctx.setLineDash([6 / s.zoom, 4 / s.zoom]);
            ctx.strokeRect(x, y, w, h);
            ctx.restore();
          }
        }
      }
    }

    // File drops onto a compatible closed vector use an explicit solid
    // outline, distinct from the dashed frame-reparent affordance above.
    if (maskDropTargetId) {
      const target = doc.nodes[maskDropTargetId];
      if (target && canBeClipMaskSource(target)) {
        const world = getCachedWorldTransform(cache, doc, maskDropTargetId);
        ctx.save();
        ctx.transform(...world);
        ctx.beginPath();
        traceSceneNodeOutline(
          ctx,
          target as unknown as Parameters<typeof traceSceneNodeOutline>[1],
        );
        ctx.closePath();
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 3 / s.zoom;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ── Layout grid overlay for frames with gridTemplate ────────────────
    ctx.strokeStyle = accentColor.replace(')', ' / 0.25)');
    ctx.lineWidth = 1 / s.zoom;
    ctx.setLineDash([0]);
    for (const [nid] of entries) {
      const n = doc.nodes[nid];
      if (n?.kind !== 'frame' || !n.layoutStyle) continue;
      const frame = n as import('@strata/scene').FrameNode & {
        layoutStyle: NonNullable<import('@strata/scene').FrameNode['layoutStyle']>;
      };
      const ls = frame.layoutStyle;
      if (!ls.gridTemplateColumns && !ls.gridTemplateRows) continue;
      const world = getCachedWorldTransform(cache, doc, nid);
      const [a, b, c, d, e, f] = world;
      const fw = frame.w;
      const fh = frame.h;
      const colSizes = parseGridTemplate(ls.gridTemplateColumns ?? '', fw);
      const rowSizes = parseGridTemplate(ls.gridTemplateRows ?? '', fh);
      const gapX = ls.columnGap ?? ls.gap ?? 0;
      const gapY = ls.rowGap ?? ls.gap ?? 0;
      let xPos = 0;
      for (const cs of colSizes) {
        xPos += cs;
        const wx = a * xPos + c * 0 + e;
        const wy = b * xPos + d * 0 + f;
        const wx2 = a * xPos + c * fh + e;
        const wy2 = b * xPos + d * fh + f;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx2, wy2);
        ctx.stroke();
        xPos += gapX;
      }
      let yPos = 0;
      for (const rs of rowSizes) {
        yPos += rs;
        const wx = a * 0 + c * yPos + e;
        const wy = b * 0 + d * yPos + f;
        const wx2 = a * fw + c * yPos + e;
        const wy2 = b * fw + d * yPos + f;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.lineTo(wx2, wy2);
        ctx.stroke();
        yPos += gapY;
      }
    }

    // ── Frame drag-over highlight ──────────────────────────────────────
    // Highlight the frame under the draft shape's center during drag.
    if (draft) {
      const cx =
        'x1' in draft ? (draft.x1 + draft.x2) / 2 : 'x' in draft ? draft.x + (draft.w ?? 0) / 2 : 0;
      const cy =
        'y1' in draft ? (draft.y1 + draft.y2) / 2 : 'y' in draft ? draft.y + (draft.h ?? 0) / 2 : 0;
      const highlightFrameId = editorRef.current.findContainingFrame({ x: cx, y: cy });
      if (highlightFrameId) {
        const frameNode = doc.nodes[highlightFrameId];
        if (frameNode && frameNode.kind === 'frame') {
          const frameWorld = getCachedWorldTransform(cache, doc, highlightFrameId);
          const fw = frameNode.w;
          const fh = frameNode.h;
          if (frameWorld) {
            const [a, b, c, d, e2, f2] = frameWorld;
            ctx.save();
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 2 / s.zoom;
            ctx.setLineDash([6 / s.zoom, 4 / s.zoom]);
            ctx.beginPath();
            const corners = [
              [0, 0],
              [fw, 0],
              [fw, fh],
              [0, fh],
            ] as const;
            for (let i = 0; i < corners.length; i++) {
              const [lx, ly] = corners[i]!;
              const wx = a * lx + c * ly + e2;
              const wy = b * lx + d * ly + f2;
              if (i === 0) ctx.moveTo(wx, wy);
              else ctx.lineTo(wx, wy);
            }
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
          }
        }
      }
    }

    // ── Draft shape preview ─────────────────────────────────────────────
    if (draft) {
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 1 / s.zoom;
      ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);

      switch (draft.kind) {
        case 'rect':
        case 'frame':
          ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
          break;
        case 'ellipse': {
          const ecx = draft.x + draft.w / 2;
          const ecy = draft.y + draft.h / 2;
          ctx.beginPath();
          ctx.ellipse(ecx, ecy, draft.w / 2, draft.h / 2, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'polygon': {
          const pcx = draft.x + draft.w / 2;
          const pcy = draft.y + draft.h / 2;
          const pr = Math.min(draft.w, draft.h) / 2;
          ctx.beginPath();
          for (let i = 0; i < draft.sides; i++) {
            const a = (2 * Math.PI * i) / draft.sides - Math.PI / 2;
            const px = pcx + pr * Math.cos(a);
            const py = pcy + pr * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'star': {
          const scx = draft.x + draft.w / 2;
          const scy = draft.y + draft.h / 2;
          const outerR = Math.min(draft.w, draft.h) / 2;
          const innerR = outerR * 0.4;
          ctx.beginPath();
          for (let i = 0; i < draft.points * 2; i++) {
            const a = (Math.PI * i) / draft.points - Math.PI / 2;
            const r = i % 2 === 0 ? outerR : innerR;
            const px = scx + r * Math.cos(a);
            const py = scy + r * Math.sin(a);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
          break;
        }
        case 'line':
          ctx.beginPath();
          ctx.moveTo(draft.x1, draft.y1);
          ctx.lineTo(draft.x2, draft.y2);
          ctx.stroke();
          break;
        case 'arrow':
          ctx.beginPath();
          ctx.moveTo(draft.x1, draft.y1);
          ctx.lineTo(draft.x2, draft.y2);
          ctx.stroke();
          {
            const angle = Math.atan2(draft.y2 - draft.y1, draft.x2 - draft.x1);
            const spread = Math.PI / 7;
            const headLen = 10 / s.zoom;
            ctx.fillStyle = accentColor;
            ctx.beginPath();
            ctx.moveTo(draft.x2, draft.y2);
            ctx.lineTo(
              draft.x2 - headLen * Math.cos(angle - spread),
              draft.y2 - headLen * Math.sin(angle - spread),
            );
            ctx.lineTo(
              draft.x2 - headLen * Math.cos(angle + spread),
              draft.y2 - headLen * Math.sin(angle + spread),
            );
            ctx.closePath();
            ctx.fill();
          }
          break;
        case 'freehand':
          if (draft.points.length >= 2) {
            ctx.beginPath();
            ctx.moveTo(draft.points[0]!.x, draft.points[0]!.y);
            for (let i = 1; i < draft.points.length; i++) {
              ctx.lineTo(draft.points[i]!.x, draft.points[i]!.y);
            }
            ctx.stroke();
          }
          break;
      }

      ctx.setLineDash([]);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The label is drawn after resetting to a plain DPR transform, so use
      // the canonical camera affine (including view rotation) explicitly.
      const draftCamera = { zoom: s.zoom, pan: s.pan, rotation: s.cameraRotation };
      if (draft.kind === 'freehand') {
        const pt = draft.points[0];
        if (pt) {
          const [sx, sy] = worldToScreen(draftCamera, pt.x, pt.y, vp);
          ctx.font = '11px system-ui';
          ctx.fillStyle = accentColor;
          ctx.fillText(draft.label ?? `${draft.points.length} pts`, sx + 4, sy + 14);
        }
      } else {
        const worldX =
          draft.kind === 'line' || draft.kind === 'arrow' ? Math.min(draft.x1, draft.x2) : draft.x;
        const worldY =
          draft.kind === 'line' || draft.kind === 'arrow' ? Math.min(draft.y1, draft.y2) : draft.y;
        const [sx, sy] = worldToScreen(draftCamera, worldX, worldY, vp);
        const sw = 'w' in draft ? draft.w * s.zoom : Math.abs(draft.x2 - draft.x1) * s.zoom;
        ctx.font = '11px system-ui';
        ctx.fillStyle = accentColor;
        const label =
          draft.label ??
          `${Math.round(sw / s.zoom)} x ${Math.round('h' in draft ? draft.h * s.zoom : (Math.abs(draft.y2 - draft.y1) * s.zoom) / s.zoom)}`;
        ctx.fillText(label, sx + sw + 4, sy + 14);
      }
    }
  }, [
    draft,
    dropTargetFrameId,
    maskDropTargetId,
    state.zoom,
    state.pan.x,
    state.pan.y,
    state.cameraRotation,
    state.maskPreviewMode,
    displayDpr,
  ]);

  // ── Theme-change redraw guard ────────────────────────────────────────────
  // Theme changes (data-theme on <html>) do not change any EditorState field,
  // so drawContent's identity stays the same and the RAF-scheduling effect
  // below never re-fires.  A MutationObserver on the attribute guarantees that
  // the canvas background, ruler, minimap, and overlay colours update
  // immediately without requiring pointer movement or zoom interaction.
  useEffect(() => {
    const el = document.documentElement;
    const cb: MutationCallback = () => {
      requestRedrawRef.current?.();
    };
    const obs = new MutationObserver(cb);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  // ── RAF scheduling ──────────────────────────────────────────────────────

  useEffect(() => {
    if (contentDrawRafRef.current !== null) {
      cancelAnimationFrame(contentDrawRafRef.current);
    }
    contentDrawRafRef.current = requestAnimationFrame(() => {
      contentDrawRafRef.current = null;
      drawContent();
    });
    return () => {
      if (contentDrawRafRef.current !== null) {
        cancelAnimationFrame(contentDrawRafRef.current);
        contentDrawRafRef.current = null;
      }
    };
  }, [drawContent]);

  useEffect(() => {
    if (overlayDrawRafRef.current !== null) {
      cancelAnimationFrame(overlayDrawRafRef.current);
    }
    overlayDrawRafRef.current = requestAnimationFrame(() => {
      overlayDrawRafRef.current = null;
      drawOverlay();
    });
    return () => {
      if (overlayDrawRafRef.current !== null) {
        cancelAnimationFrame(overlayDrawRafRef.current);
        overlayDrawRafRef.current = null;
      }
    };
  }, [drawOverlay]);

  // ─── Touch pinch (two-pointer zoom/pan, bypasses ToolManager) ───────────

  const touchPointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ lastDist: number; lastCentroid: { x: number; y: number } } | null>(
    null,
  );

  function pinchGeometry(): { dist: number; centroid: { x: number; y: number } } | null {
    const pts = [...touchPointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return {
      dist: Math.hypot(b.x - a.x, b.y - a.y),
      centroid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  // ─── Auto-pan (edge scroll during drag) ────────────────────────────────

  function stopAutoPan() {
    if (autoPanRaf.current !== null) {
      cancelAnimationFrame(autoPanRaf.current);
      autoPanRaf.current = null;
    }
    autoPanVelocity.current = { x: 0, y: 0 };
  }

  // ─── Pointer Events ──────────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ne = e.nativeEvent as PointerEvent;
    const tmInst = tm.current;
    if (!tmInst) return;

    // Canvas-scoped shortcuts (zoom presets, tool hotkeys, delete/nudge,
    // Space-pan) are handled by this element's own onKeyDown, so they only
    // fire while it holds DOM focus. Nothing else re-focuses it after focus
    // moves away (a panel input, a dialog, the properties panel) — relying
    // on the browser's default click-to-focus for a tabIndex element is
    // fragile, so grab focus explicitly on every pointer interaction.
    e.currentTarget.focus({ preventScroll: true });

    // Two-finger touch → pinch zoom/pan. Cancel any in-progress tool gesture
    // from the first finger so it doesn't draw/move while pinching.
    if (e.pointerType === 'touch') {
      touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPointers.current.size === 2) {
        tmInst.handlePointerCancel(ne, buildToolCtx(ne));
        const geo = pinchGeometry();
        if (geo) pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
        return;
      }
      if (touchPointers.current.size > 2) return;
    }

    // Prevent browser default middle-click auto-scroll; route to active tool
    if (e.button === 1) {
      e.preventDefault();
    }

    snapSessionRef.current = createSnapSession();
    const ctx = buildToolCtx(ne);
    tmInst.handlePointerDown(ne, ctx);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const ne = e.nativeEvent as PointerEvent;
    // Active pinch: update this finger, re-derive distance + centroid.
    if (e.pointerType === 'touch' && touchPointers.current.has(e.pointerId)) {
      touchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pinch = pinchRef.current;
      const geo = pinchGeometry();
      if (pinch && geo) {
        const s = stateRef.current;
        const rect = contentCanvasRef.current?.getBoundingClientRect();
        // Pan by centroid movement…
        const panned = {
          x: s.pan.x + (geo.centroid.x - pinch.lastCentroid.x),
          y: s.pan.y + (geo.centroid.y - pinch.lastCentroid.y),
        };
        // …then zoom about the current centroid by the distance ratio.
        const cam = { pan: panned, zoom: s.zoom, rotation: s.cameraRotation };
        const viewport = {
          width: rect?.width ?? contentCanvasRef.current?.clientWidth ?? 1920,
          height: rect?.height ?? contentCanvasRef.current?.clientHeight ?? 1080,
        };
        const origin = computeFloatingOrigin(cam, viewport);
        const anchor = screenToWorld(
          cam,
          geo.centroid.x - (rect?.left ?? 0),
          geo.centroid.y - (rect?.top ?? 0),
          viewport,
          origin,
        );
        const factor = pinch.lastDist > 0 ? geo.dist / pinch.lastDist : 1;
        const newCam = zoomAboutPoint(cam, anchor, clampZoom(s.zoom * factor), viewport);
        commitCamera(newCam);
        pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
        return;
      }
    }

    // Track cursor position (throttled to ~30fps)
    const now = performance.now();
    if (now - lastCursorUpdate.current > 32) {
      lastCursorUpdate.current = now;
      const world = buildToolCtx(ne).canvasToWorld(e.clientX, e.clientY);
      editor.setCursorPos(world);
    }

    const tmInst = tm.current;
    if (!tmInst) return;

    if (state.tool === 'inspect') {
      const ctx = buildToolCtx(ne);
      // canvasToWorld now includes rect subtraction; pass raw clientX/Y.
      const world = ctx.canvasToWorld(ne.clientX, ne.clientY);
      const hit = editor.hitTestNode(world);
      setHoveredNode(hit?.node ?? null);
    }

    tmInst.handlePointerMove(ne, buildToolCtx(ne));

    // E1: Auto-pan when dragging near canvas edge.
    if (e.buttons !== 0) {
      const rect = contentCanvasRef.current?.getBoundingClientRect();
      if (rect) {
        const vx = computeEdgeVelocity(e.clientX, rect.left, rect.right);
        const vy = computeEdgeVelocity(e.clientY, rect.top, rect.bottom);
        autoPanVelocity.current = { x: vx, y: vy };
        if (vx !== 0 || vy !== 0) {
          if (autoPanRaf.current === null) {
            const tick = () => {
              const v = autoPanVelocity.current;
              if (v.x === 0 && v.y === 0) {
                stopAutoPan();
                return;
              }
              const s = stateRef.current;
              editor.setPan({ x: s.pan.x + v.x, y: s.pan.y + v.y });
              autoPanRaf.current = requestAnimationFrame(tick);
            };
            autoPanRaf.current = requestAnimationFrame(tick);
          }
        } else {
          stopAutoPan();
        }
      }
    } else {
      stopAutoPan();
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    stopAutoPan();
    setSnapGuides([]);
    if (e.pointerType === 'touch') {
      const wasPinching = pinchRef.current !== null;
      touchPointers.current.delete(e.pointerId);
      if (touchPointers.current.size < 2) pinchRef.current = null;
      // A finger lifted from a pinch shouldn't fire the tool's pointer-up.
      if (wasPinching) return;
    }
    const ne = e.nativeEvent as PointerEvent;
    const tmInst = tm.current;
    if (!tmInst) return;

    tmInst.handlePointerUp(ne, buildToolCtx(ne));
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    stopAutoPan();
    if (e.pointerType === 'touch') {
      touchPointers.current.delete(e.pointerId);
      if (touchPointers.current.size < 2) pinchRef.current = null;
    }
    const ne = e.nativeEvent as PointerEvent;
    tm.current?.handlePointerCancel(ne, buildToolCtx(ne));
    setSnapGuides([]);
  }

  // ─── Wheel & pinch (native, non-passive) ─────────────────────────────────
  // React attaches `onWheel` passively (React 17+), so preventDefault() is
  // silently ignored there — trackpad pinch (delivered as ctrl+wheel) would
  // trigger browser page-zoom instead of canvas zoom. Attach natively with
  // { passive: false } instead.
  //   wheel + ctrl/cmd → pinch / precision-zoom, anchored at cursor
  //   wheel + shift    → horizontal pan (mouse-wheel convention)
  //   plain wheel      → two-finger scroll pan
  // WebKit (WKWebView / WebKitGTK — the Tauri runtimes) can deliver trackpad
  // pinch as proprietary gesturestart/change/end events carrying a `scale`;
  // those are handled below and no-op on engines that never fire them.
  useEffect(() => {
    const el = contentCanvasRef.current;
    if (!el) return;

    // Normalize deltaMode: Firefox mouse wheels report DOM_DELTA_LINE (1).
    const deltaScale = (e: WheelEvent): number =>
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;

    const zoomAboutClientPoint = (clientX: number, clientY: number, newZoom: number): void => {
      const s = stateRef.current;
      const rect = el.getBoundingClientRect();
      const viewport = { width: rect.width, height: rect.height };
      const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
      const origin = computeFloatingOrigin(cam, viewport);
      const anchor = screenToWorld(cam, clientX - rect.left, clientY - rect.top, viewport, origin);
      const newCam = zoomAboutPoint(cam, anchor, clampZoom(newZoom), viewport);
      commitCamera(newCam);
    };

    // ── Inertial scroll state (A-06) ──────────────────────────────────
    const inertiaRef = { current: { vx: 0, vy: 0, rafId: 0, active: false } };
    const INERTIA_FRICTION = 0.9;
    const INERTIA_THRESHOLD = 0.5;

    function startInertia(): void {
      if (inertiaRef.current.active) return;
      inertiaRef.current.active = true;
      const tick = (): void => {
        const s = stateRef.current;
        const v = inertiaRef.current;
        if (Math.abs(v.vx) < INERTIA_THRESHOLD && Math.abs(v.vy) < INERTIA_THRESHOLD) {
          v.active = false;
          v.vx = 0;
          v.vy = 0;
          return;
        }
        editorRef.current.setPan({ x: s.pan.x + v.vx, y: s.pan.y + v.vy });
        v.vx *= INERTIA_FRICTION;
        v.vy *= INERTIA_FRICTION;
        v.rafId = requestAnimationFrame(tick);
      };
      inertiaRef.current.rafId = requestAnimationFrame(tick);
    }

    function cancelInertia(): void {
      if (inertiaRef.current.rafId) cancelAnimationFrame(inertiaRef.current.rafId);
      inertiaRef.current.active = false;
      inertiaRef.current.vx = 0;
      inertiaRef.current.vy = 0;
    }

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const s = stateRef.current;
      const k = deltaScale(e);
      if (e.ctrlKey || e.metaKey) {
        const d = Math.max(-24, Math.min(24, e.deltaY * k));
        zoomAboutClientPoint(e.clientX, e.clientY, s.zoom * Math.exp(-d * 0.01));
        cancelInertia();
      } else if (e.shiftKey && e.deltaX === 0) {
        editorRef.current.setPan({ x: s.pan.x - e.deltaY * k, y: s.pan.y });
        cancelInertia();
      } else {
        const dx = -e.deltaX * k;
        const dy = -e.deltaY * k;
        editorRef.current.setPan({ x: s.pan.x + dx, y: s.pan.y + dy });
        // Accumulate velocity for inertia; weight recent deltas higher
        inertiaRef.current.vx = inertiaRef.current.vx * 0.4 + dx * 0.6;
        inertiaRef.current.vy = inertiaRef.current.vy * 0.4 + dy * 0.6;
        // Cap velocity to prevent runaway
        const maxV = 80;
        inertiaRef.current.vx = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vx));
        inertiaRef.current.vy = Math.max(-maxV, Math.min(maxV, inertiaRef.current.vy));
        // Start/restart inertia deceleration
        cancelInertia();
        startInertia();
      }
    };

    // Safari-family pinch: GestureEvent is WebKit-proprietary (scale is the
    // cumulative pinch ratio since gesturestart).
    interface WebKitGestureEvent extends Event {
      scale: number;
      clientX: number;
      clientY: number;
    }
    let gestureBaseZoom = 1;
    const onGestureStart = (e: Event): void => {
      e.preventDefault();
      gestureBaseZoom = stateRef.current.zoom;
    };
    const onGestureChange = (e: Event): void => {
      e.preventDefault();
      const ge = e as WebKitGestureEvent;
      zoomAboutClientPoint(ge.clientX, ge.clientY, gestureBaseZoom * ge.scale);
    };
    const onGestureEnd = (e: Event): void => e.preventDefault();

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    el.addEventListener('gestureend', onGestureEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
      el.removeEventListener('gestureend', onGestureEnd);
    };
  }, []);

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ne = e.nativeEvent as KeyboardEvent;
      const tmInst = tm.current;

      // Space (held) → spring-loaded Hand tool (Figma convention); reverts
      // to the previous tool on keyup.
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && tmInst) {
          tmInst.springLoadTool(
            'hand',
            ne,
            buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent),
          );
        }
        return;
      }

      // Let the active tool try to consume the key first
      if (tmInst) {
        const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
        if (tmInst.handleKeyDown(ne, ctx)) {
          e.preventDefault();
          return;
        }
      }

      // Global keyboard handlers that are NOT tool-specific
      const s = stateRef.current;
      const eRef = editorRef.current;
      const nodes = getAllSelectableNodes(s.document);
      const selArr = s.selection;
      const firstSel = selArr[0] ?? null;
      const idx = firstSel ? nodes.findIndex((n) => n.id === firstSel) : -1;

      if (e.key === 'Tab') {
        if (nodes.length === 0) return;
        e.preventDefault();
        if (e.shiftKey) {
          const prev = nodes[(idx <= 0 ? nodes.length : idx) - 1];
          if (prev) {
            eRef.setSelection(prev.id);
            eRef.announceSelection([prev]);
          }
        } else {
          const next = nodes[(idx + 1) % nodes.length];
          if (next) {
            eRef.setSelection(next.id);
            eRef.announceSelection([next]);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        eRef.setSelection(null);
        eRef.announceSelection([]);
        // If in a non-full canvas mode, return to full render mode.
        if (s.canvasMode !== 'full') {
          eRef.setCanvasMode('full');
        }
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        setRenameDialog({ defaultValue: nodes[idx]?.name ?? '' });
      }

      // ── Helper: zoom about the canvas centre ─────────────────────────
      function zoomAboutCanvasCentre(newZoom: number): void {
        const s = stateRef.current;
        const parent = contentCanvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const viewport = { width: vpW, height: vpH };
        const cam = { pan: s.pan, zoom: s.zoom, rotation: s.cameraRotation };
        const origin = computeFloatingOrigin(cam, viewport);
        const centreWorld = screenToWorld(cam, vpW / 2, vpH / 2, viewport, origin);
        const newCam = zoomAboutPoint(cam, centreWorld, newZoom, viewport);
        commitCamera(newCam);
      }

      // ── Zoom presets (unmodified 1-6) ────────────────────────────────
      const ZOOM_PRESETS: Record<string, number> = {
        '1': 0.5,
        '2': 0.75,
        '3': 1,
        '4': 1.5,
        '5': 2,
        '6': 4,
      };
      const zoomLevel = ZOOM_PRESETS[e.key];
      if (zoomLevel !== undefined && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(zoomLevel);
        eRef.announceOperation('Zoom', `${Math.round(zoomLevel * 100)}%`);
        return;
      }

      // ── Ctrl/Cmd + 0 → 100% ───────────────────────────────────────────
      if (e.key === '0' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(1);
        eRef.announceOperation('Zoom', '100%');
        return;
      }

      // ── + / = → zoom in (1.25×); - → zoom out (0.8×) ─────────────────
      if ((e.key === '=' || e.key === '+') && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 1.25));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }
      if (e.key === '-' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        zoomAboutCanvasCentre(clampZoom(stateRef.current.zoom * 0.8));
        eRef.announceOperation('Zoom', `${Math.round(stateRef.current.zoom * 100)}%`);
        return;
      }

      // ── Reveal shortcuts ──────────────────────────────────────────────
      if (e.key === '1' && e.shiftKey) {
        e.preventDefault();
        // Shift+1: fit all nodes — use actual canvas element bounds
        const parent = contentCanvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const canvasViewport = { width: vpW, height: vpH };
        const allBounds = rootNodes().reduce<{ x: number; y: number; w: number; h: number } | null>(
          (acc, n) => {
            const b = editor.getWorldBounds(n.id);
            if (!b) return acc;
            if (!acc) return b;
            const minX = Math.min(acc.x, b.x);
            const minY = Math.min(acc.y, b.y);
            const maxX = Math.max(acc.x + acc.w, b.x + b.w);
            const maxY = Math.max(acc.y + acc.h, b.y + b.h);
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          },
          null,
        );
        if (allBounds) {
          const cam = fitBoundsCamera(allBounds, canvasViewport, 40);
          commitCamera(cam);
          eRef.announceOperation('Zoom', 'fit all');
        }
      }
      if (e.key === '2' && e.shiftKey) {
        e.preventDefault();
        if (selArr.length > 0) {
          const parent = contentCanvasRef.current?.parentElement;
          const viewport = parent
            ? { width: parent.clientWidth, height: parent.clientHeight }
            : undefined;
          eRef.revealSelection({ fit: true, viewport });
          eRef.announceOperation('Zoom', 'to selection');
        }
      }
    },
    [rootNodes],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    const ne = e.nativeEvent as KeyboardEvent;
    const tmInst = tm.current;
    if (!tmInst) return;
    const ctx = buildToolCtx({ pointerType: 'mouse', pressure: 0 } as PointerEvent);
    // Release spring-loaded Hand tool when Space is let go.
    if (e.key === ' ' && tmInst.springKey === ' ') {
      e.preventDefault();
      tmInst.releaseSpring(ctx);
      return;
    }
    tmInst.handleKeyUp(ne, ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const tmInst = tm.current;
    if (!tmInst) return;
    // Tools' onDoubleClick only reads clientX/Y + modifiers, all present on
    // MouseEvent; buildToolCtx defaults pointerType/pressure when absent.
    const ne = e.nativeEvent as unknown as PointerEvent;
    tmInst.handleDoubleClick(ne, buildToolCtx(ne));
  }

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
          (t) => t === 'Files' || t.startsWith('image/') || t === 'text/svg+xml',
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
        sourceDoc: import('@strata/scene').Document;
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

      // First check for dnd-kit native files (strata file type)
      const strataFiles = e.dataTransfer.types?.includes('application/x-strata-file');
      if (strataFiles) {
        // Handled by dnd-kit's onDragEnd instead
        return;
      }

      const dropWorld = computeDropWorld(e.clientX, e.clientY);
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
      {state.pixelGridEnabled && (
        <div
          className="editor-canvas__pixel-grid"
          style={{
            backgroundImage: [
              'linear-gradient(var(--color-border-subtle) 1px, transparent 1px)',
              'linear-gradient(90deg, var(--color-border-subtle) 1px, transparent 1px)',
            ].join(', '),
            backgroundSize: `${state.zoom}px ${state.zoom}px`,
          }}
        />
      )}
      <canvas
        ref={contentCanvasRef}
        tabIndex={0}
        aria-roledescription="Design canvas"
        aria-label="Design canvas"
        data-testid="editor-canvas"
        className="editor-canvas__content-layer"
        style={{ cursor }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          editor.setCursorPos(null);
          stopAutoPan();
        }}
        onBlur={() => {
          stopAutoPan();
          tm.current?.activeTool.onPointerCancel?.(
            new PointerEvent('pointercancel'),
            buildToolCtx(new PointerEvent('pointercancel')),
          );
          if (tm.current?.springActive) {
            tm.current.releaseSpring(buildToolCtx(new PointerEvent('pointercancel')));
          }
        }}
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
    </section>
  );
}
