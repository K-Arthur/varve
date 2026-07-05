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
import {
  applyStyleOverrides,
  CompositeCanvas,
  createEngine,
  type Engine,
  type EngineColor,
  type SceneNode as EngineNode,
  mapBlendMode,
  type ReplayTarget,
  renderAlphaMask,
  replayIr,
  traceSceneNodeOutline,
} from '@strata/engine';
import { importFile } from '@strata/import';
import type { NodeId, SceneNode } from '@strata/scene';
import { buildParentIndexMap, isContainer, resolveAllStyles, walkNodes } from '@strata/scene';
import {
  clampZoom,
  fitBoundsCamera,
  isWorldRectInViewport,
  screenToWorld,
  zoomAboutPoint,
} from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasAccessibilityTree } from './components/CanvasAccessibilityTree';
import { FloatingTextBar } from './components/FloatingTextBar/FloatingTextBar';
import { GuideOverlay } from './components/GuideOverlay/GuideOverlay';
import { NodeEditOverlay } from './components/NodeEditOverlay';
import { Ruler } from './components/Ruler/Ruler';
import { SnapGuidesOverlay } from './components/SnapGuidesOverlay';
import { MeasureOverlay } from './components/SpecPanel/MeasureOverlay';
import { TextEditOverlay } from './components/TextEditOverlay';
import { VariantBox } from './components/VariantBox/VariantBox';
import { ZoomIndicator } from './components/ZoomIndicator';
import { nodeWorldBoundsFn, useEditor } from './context';
import { applyDropPosition, collectFilesFromDataTransfer } from './dropUtils';
import { SelectionOverlay } from './SelectionOverlay';
import {
  createTransformCache,
  getWorldBounds as getCachedWorldBounds,
  getWorldTransform as getCachedWorldTransform,
  invalidateAll as invalidateTransformCache,
  type TransformCache,
} from './scene/transformCache';
import { nodeWorldBounds } from './scene/world';
import { sampleTimelineAt } from './timeline/TimelineSampler';
import { type DraftShape, type ToolContext, ToolManager } from './tools';
import { ArrowTool } from './tools/ArrowTool';
import { computeEdgeVelocity } from './tools/autoPan';
import { CloneStampTool } from './tools/CloneStampTool';
import { EllipseTool } from './tools/EllipseTool';
import { EyedropperTool } from './tools/EyedropperTool';
import { FrameTool } from './tools/FrameTool';
import { HandTool } from './tools/HandTool';
import { HealingBrushTool } from './tools/HealingBrushTool';
import { LineTool } from './tools/LineTool';
import { NodeEditTool } from './tools/NodeEditTool';
import { PatchTool } from './tools/PatchTool';
import { PencilTool } from './tools/PencilTool';
import { PenTool } from './tools/PenTool';
import { PolygonTool } from './tools/PolygonTool';
import { RectangleTool } from './tools/RectangleTool';
import { RefineMaskTool } from './tools/RefineMaskTool';
import { ScaleTool } from './tools/ScaleTool';
import { SelectTool } from './tools/SelectTool';
import { SliceTool } from './tools/SliceTool';
import { SpotHealTool } from './tools/SpotHealTool';
import { StarTool } from './tools/StarTool';
import { filterSnapTargets, type SnapGuide, snapPosition } from './tools/snapping';
import { TextTool } from './tools/TextTool';
import { ZoomTool } from './tools/ZoomTool';

type DocNode = SceneNode;

let _showOriginalBgNodeId: string | null = null;

function toEngineNode(n: DocNode): EngineNode {
  const base = {
    id: n.id,
    name: n.name,
    fill: n.fill,
    fills: n.fills,
    transform: n.transform,
    opacity: n.opacity ?? 1,
    blendMode: n.blendMode ?? ('normal' as const),
    rotation: n.rotation ?? 0,
    strokes: 'strokes' in n ? (n.strokes ?? []) : [],
    effects: 'effects' in n ? (n.effects ?? []) : [],
  };
  if (n.kind === 'shape') return { ...base, shape: n.shape, cornerRadius: n.cornerRadius };
  if (n.kind === 'text')
    return {
      ...base,
      kind: 'text',
      text: n.text,
      fontSize: n.fontSize,
      fontFamily: n.fontFamily,
      fontWeight: n.fontWeight,
      fontStyle: n.fontStyle,
      textAlign: n.textAlign,
      textAlignVertical: n.textAlignVertical,
      letterSpacing: n.letterSpacing,
      lineHeight: n.lineHeight,
      paragraphSpacing: n.paragraphSpacing,
      textCase: n.textCase,
      textDecoration: n.textDecoration,
      textOverflow: n.textOverflow,
      listStyle: n.listStyle,
    };
  if (n.kind === 'frame')
    return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: n.w, h: n.h } as const };
  if (n.kind === 'image') {
    const imageNode = n as import('@strata/scene').ImageNode;
    const skipAlphaMask = _showOriginalBgNodeId === n.id;
    return {
      ...base,
      kind: 'image',
      src: imageNode.src,
      w: imageNode.w,
      h: imageNode.h,
      alphaMask: skipAlphaMask ? undefined : imageNode.backgroundRemoval?.maskDataUrl,
    };
  }
  return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 } as const };
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
    segments.push(match[1]!);
    const bracketGroups = match[2]!.matchAll(/\[([^\]]+)\]/g);
    for (const m of bracketGroups) {
      segments.push(m[1]!);
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

export function CanvasArea({
  canvasContainerRef,
}: {
  canvasContainerRef?: React.RefObject<HTMLDivElement | null>;
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
  const stateRef = useRef(state);
  stateRef.current = state;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const transformCacheRef = useRef<TransformCache>(createTransformCache());
  const prevDrawDocRef = useRef(state.document);
  if (state.document !== prevDrawDocRef.current) {
    invalidateTransformCache(transformCacheRef.current);
    prevDrawDocRef.current = state.document;
  }

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const contentDrawRafRef = useRef<number | null>(null);
  const overlayDrawRafRef = useRef<number | null>(null);

  /** Size a canvas element to match its CSS dimensions at the given DPR. */
  function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, dpr: number): void {
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
  }

  // E1: Auto-pan when dragging near canvas edge.
  const autoPanRaf = useRef<number | null>(null);
  const autoPanVelocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // B-04: Dirty-rect tracking for partial redraw. Populated by draw()
  // diffing old vs current node world bounds.
  const dirtyRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [nodeEditTargetId, setNodeEditTargetId] = useState<string | null>(null);
  const [nodeEditSelectedAnchors, setNodeEditSelectedAnchors] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [textEditTargetId, setTextEditTargetId] = useState<string | null>(null);
  const pendingAutoTextEditRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<SceneNode | null>(null);
  const lastCursorUpdate = useRef(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
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

  useEffect(() => {
    createEngine('auto').then((eng) => {
      engineRef.current = eng;
    });
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
      snapEnabled: s.snapEnabled,
      snapGrid: 8,

      createShapeAt: (world, size, parentId) => e.createShapeAt(world, size, parentId),
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
        return {
          x: (cx - (rect?.left ?? 0) - s.pan.x) / s.zoom,
          y: (cy - (rect?.top ?? 0) - s.pan.y) / s.zoom,
        };
      },
      worldToCanvas: (wx, wy) => {
        return { x: wx * s.zoom + s.pan.x, y: wy * s.zoom + s.pan.y };
      },
      canvasDeltaToWorld: (dx, dy) => {
        return { dx: dx / s.zoom, dy: dy / s.zoom };
      },

      setPointerCapture: (pointerId) => {
        const el = contentCanvasRef.current;
        if (el) el.setPointerCapture(pointerId);
      },
      releasePointerCapture: (pointerId) => {
        const el = contentCanvasRef.current;
        if (el) el.releasePointerCapture(pointerId);
      },

      findContainingFrame: (world) => e.findContainingFrame(world),
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

      snapPosition: (bounds, targets) => {
        if (!s.snapEnabled) return { x: bounds.x, y: bounds.y, guides: [] };

        // D-02: Spatial + hierarchical filtering of snap targets
        const doc = stateRef.current.document;
        const allBoundsWithIds: Array<{
          nodeId: string;
          bounds: { x: number; y: number; w: number; h: number };
        }> = [];
        for (const n of Object.values(doc.nodes)) {
          const b = nodeWorldBoundsFn(n);
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

        // D-04: Add page bounds and containing frame bounds as snap targets
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
        // Find containing frame via findContainingFrame (uses cursor position from ev)
        // Since we don't have the cursor here, we try the first selected node's parent
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

        const allTargets = [...filtered, ...pageBoundsTargets];
        const result = snapPosition(bounds.x, bounds.y, bounds.w, bounds.h, allTargets, s.snapGrid);
        setSnapGuides(result.guides);
        return result;
      },
      isSnapExcluded: (id: string) => {
        const n = stateRef.current.document.nodes[id];
        return n?.snapExcluded === true;
      },
    };
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────

  // ── Content canvas draw: board background, IR replay, outline mode ──────

  const drawContent = useCallback(() => {
    const canvas = contentCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio ?? 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    sizeCanvas(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const eng = engineRef.current;
    if (!eng) return;

    (async () => {
      if (!ctx) return;
      const ctxNN = ctx;
      const s = stateRef.current;
      const doc = s.document;
      _showOriginalBgNodeId = s.showOriginalBgNodeId ?? null;

      const boardColor = (() => {
        const bg = doc.canvasBackground;
        if (bg?.space === 'rgb') {
          return `rgba(${bg.r}, ${bg.g}, ${bg.b}, ${(bg.a / 255).toFixed(3)})`;
        }
        return getComputedStyle(document.documentElement)
          .getPropertyValue('--color-surface-sunken')
          .trim();
      })();

      const entries = walkNodes(doc);
      const cache = transformCacheRef.current;
      const viewport = canvas.getBoundingClientRect();
      const vp = { width: viewport.width, height: viewport.height };
      const VP_W = vp.width;
      const VP_H = vp.height;
      const cam = { pan: s.pan, zoom: s.zoom };
      const hiddenByContainer = new Set<string>();

      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        if (isContainer(n) && 'children' in n && n.children.length > 0) {
          const containerBounds = getCachedWorldBounds(cache, doc, id);
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

      const prevDoc = prevDrawDocRef.current;
      if (prevDoc && prevDoc !== doc) {
        const prevNodeIds = new Set(Object.keys(prevDoc.nodes));
        const currNodeIds = new Set(Object.keys(doc.nodes));
        let dirtyWorld: { x: number; y: number; w: number; h: number } | null = null;
        for (const id of currNodeIds) {
          if (!prevNodeIds.has(id)) {
            const b = getCachedWorldBounds(cache, doc, id);
            if (!b) continue;
            if (!dirtyWorld) dirtyWorld = { ...b };
            else {
              const mx = Math.min(dirtyWorld.x, b.x);
              const my = Math.min(dirtyWorld.y, b.y);
              const mx2 = Math.max(dirtyWorld.x + dirtyWorld.w, b.x + b.w);
              const my2 = Math.max(dirtyWorld.y + dirtyWorld.h, b.y + b.h);
              dirtyWorld = { x: mx, y: my, w: mx2 - mx, h: my2 - my };
            }
          }
        }
        if (dirtyWorld) {
          const sx = dirtyWorld.x * s.zoom + s.pan.x - 40;
          const sy = dirtyWorld.y * s.zoom + s.pan.y - 40;
          const sw = dirtyWorld.w * s.zoom + 80;
          const sh = dirtyWorld.h * s.zoom + 80;
          dirtyRectRef.current = {
            x: Math.max(0, sx),
            y: Math.max(0, sy),
            w: Math.min(VP_W, sw),
            h: Math.min(VP_H, sh),
          };
        }
      }

      const nodeIds: string[] = [];
      const flatNodes: EngineNode[] = [];
      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        if (n.kind === 'group') continue;
        if (hiddenByContainer.has(id)) continue;
        const world = getCachedWorldTransform(cache, doc, id);
        const worldBounds = getCachedWorldBounds(cache, doc, id);
        if (worldBounds && !isWorldRectInViewport(cam, vp, worldBounds)) continue;
        nodeIds.push(id);
        flatNodes.push({ ...toEngineNode(n), transform: world });
      }

      const resolvedStyles = resolveAllStyles(doc);
      if (resolvedStyles.size > 0) {
        for (let i = 0; i < flatNodes.length; i++) {
          const nodeId = nodeIds[i];
          if (!nodeId) continue;
          const overrides = resolvedStyles.get(nodeId);
          if (!overrides) continue;
          const fn = flatNodes[i];
          if (!fn) continue;
          flatNodes[i] = applyStyleOverrides(fn, overrides);
        }
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
      const ir = await eng.buildIr({ nodes: flatNodes });

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

      const dirtyRect = dirtyRectRef.current;
      const usePartialRedraw =
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
        ctx.beginPath();
        ctx.rect(dx, dy, dw, dh);
        ctx.clip();
        ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
      } else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = boardColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
      }

      dirtyRectRef.current = null;

      function replaySubtreeToCtx(nodeId: string, ctx: CanvasRenderingContext2D): void {
        const n = doc.nodes[nodeId];
        if (!n || n.visible === false) return;
        const item = irByNodeId.get(nodeId);

        const mask = 'mask' in n && n.mask && n.mask.visible ? n.mask : null;
        const maskSrcId = mask ? mask.sourceNodeId : null;
        const maskChild = maskSrcId ? doc.nodes[maskSrcId] : null;
        if (mask && maskChild && maskSrcId) {
          if (mask.type === 'alpha') {
            const cameraTransform = () => {
              ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
            };
            renderAlphaMask(
              ctx,
              {
                draw: (maskCtx: CanvasRenderingContext2D) => {
                  maskCtx.setTransform(
                    dpr * s.zoom,
                    0,
                    0,
                    dpr * s.zoom,
                    dpr * s.pan.x,
                    dpr * s.pan.y,
                  );
                  replaySubtreeToCtx(maskSrcId, maskCtx);
                },
              },
              {
                draw: (contentCtx: CanvasRenderingContext2D) => {
                  contentCtx.setTransform(
                    dpr * s.zoom,
                    0,
                    0,
                    dpr * s.zoom,
                    dpr * s.pan.x,
                    dpr * s.pan.y,
                  );
                  for (const childId of (n as import('@strata/scene').ContainerNode).children) {
                    if (childId !== maskSrcId) replaySubtreeToCtx(childId, contentCtx);
                  }
                },
              },
            );
            return;
          }
          ctx.save();
          const maskWorldTransform = getCachedWorldTransform(cache, doc, maskSrcId);
          const [ma, mb, mc, md, me, mf] = maskWorldTransform;
          ctx.transform(ma, mb, mc, md, me, mf);
          ctx.beginPath();
          traceSceneNodeOutline(ctx, maskChild);
          ctx.closePath();
          ctx.clip();
          ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
          for (const childId of (n as import('@strata/scene').ContainerNode).children) {
            if (childId !== maskSrcId) replaySubtreeToCtx(childId, ctx);
          }
          ctx.restore();
          return;
        }

        if (n.kind === 'frame') {
          if (item) replayIr(ctx as unknown as ReplayTarget, [item]);
          if (n.children.length > 0) {
            const shouldClip = n.clipContent !== false;
            if (shouldClip) {
              const t = item?.transform ?? ([1, 0, 0, 1, 0, 0] as const);
              const [a, b, c, d, e, f] = t;
              const fw = n.w;
              const fh = n.h;
              ctx.save();
              ctx.beginPath();
              ctx.moveTo(e, f);
              ctx.lineTo(a * fw + e, b * fw + f);
              ctx.lineTo(a * fw + c * fh + e, b * fw + d * fh + f);
              ctx.lineTo(c * fh + e, d * fh + f);
              ctx.closePath();
              ctx.clip();
              for (const childId of n.children) {
                replaySubtreeToCtx(childId, ctx);
              }
              ctx.restore();
            } else {
              for (const childId of n.children) {
                replaySubtreeToCtx(childId, ctx);
              }
            }
          }
        } else if (n.kind === 'group') {
          const isIsolated = n.isolated === true;
          const needsFlatten =
            isIsolated ||
            (n.blendMode && n.blendMode !== 'normal' && n.blendMode !== 'passThrough') ||
            (n.opacity !== undefined && n.opacity < 1);
          if (needsFlatten && n.children.length > 0) {
            let minX = Infinity,
              minY = Infinity,
              maxX = -Infinity,
              maxY = -Infinity;
            for (const childId of n.children) {
              const b = getCachedWorldBounds(cache, doc, childId);
              if (b) {
                minX = Math.min(minX, b.x);
                minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.w);
                maxY = Math.max(maxY, b.y + b.h);
              }
            }
            if (isFinite(minX)) {
              ctx.save();
              const gw = Math.ceil(maxX - minX) + 4;
              const gh = Math.ceil(maxY - minY) + 4;
              const gCanvas = new CompositeCanvas({
                width: gw,
                height: gh,
                testCanvas: document.createElement('canvas'),
              });
              const gCtx = gCanvas.ctx;
              gCtx.save();
              gCtx.translate(-Math.floor(minX) + 2, -Math.floor(minY) + 2);
              for (const childId of n.children) {
                replaySubtreeToCtx(childId, gCtx as unknown as CanvasRenderingContext2D);
              }
              gCtx.restore();
              const bm = n.blendMode ?? 'passThrough';
              if (bm !== 'passThrough') {
                ctx.globalCompositeOperation = mapBlendMode(bm) as GlobalCompositeOperation;
              } else if (isIsolated) {
                ctx.globalCompositeOperation = 'source-over';
              }
              ctx.globalAlpha = n.opacity ?? 1;
              ctx.drawImage(
                gCanvas.canvas as CanvasImageSource,
                Math.floor(minX) - 2,
                Math.floor(minY) - 2,
              );
              ctx.restore();
            }
          } else {
            for (const childId of n.children) {
              replaySubtreeToCtx(childId, ctx);
            }
          }
        } else {
          if (item) replayIr(ctx as unknown as ReplayTarget, [item]);
        }
      }

      function replaySubtree(nodeId: string): void {
        replaySubtreeToCtx(nodeId, ctxNN);
      }

      for (const [id, entry] of entries) {
        if (entry.parentId === null) {
          replaySubtree(id);
        }
      }
    })();
  }, [rootNodes, state.zoom, state.pan.x, state.pan.y, state.canvasMode]);

  // ── Overlay canvas draw: layout grid overlay, draft shapes ──────────────

  const drawOverlay = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio ?? 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    sizeCanvas(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const s = stateRef.current;
    const doc = s.document;
    const cache = transformCacheRef.current;
    const entries = walkNodes(doc);

    const accentColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-accent-primary')
      .trim();

    // Clear overlay canvas (it's transparent otherwise)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);

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
      }

      ctx.setLineDash([]);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sx =
        draft.kind === 'line' || draft.kind === 'arrow'
          ? Math.min(draft.x1, draft.x2) * s.zoom + s.pan.x
          : draft.x * s.zoom + s.pan.x;
      const sy =
        draft.kind === 'line' || draft.kind === 'arrow'
          ? Math.min(draft.y1, draft.y2) * s.zoom + s.pan.y
          : draft.y * s.zoom + s.pan.y;
      const sw = 'w' in draft ? draft.w * s.zoom : Math.abs(draft.x2 - draft.x1) * s.zoom;
      ctx.font = '11px system-ui';
      ctx.fillStyle = accentColor;
      const label =
        draft.label ??
        `${Math.round(sw / s.zoom)} x ${Math.round('h' in draft ? draft.h * s.zoom : (Math.abs(draft.y2 - draft.y1) * s.zoom) / s.zoom)}`;
      ctx.fillText(label, sx + sw + 4, sy + 14);
    }
  }, [draft, state.zoom, state.pan.x, state.pan.y]);

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

    const ctx = buildToolCtx(ne);
    tmInst.handlePointerDown(ne, ctx);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
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
        const cam = { pan: panned, zoom: s.zoom };
        const anchor = screenToWorld(
          cam,
          geo.centroid.x - (rect?.left ?? 0),
          geo.centroid.y - (rect?.top ?? 0),
        );
        const factor = pinch.lastDist > 0 ? geo.dist / pinch.lastDist : 1;
        const newCam = zoomAboutPoint(cam, anchor, clampZoom(s.zoom * factor));
        editorRef.current.setZoom(newCam.zoom);
        editorRef.current.setPan(newCam.pan);
        pinchRef.current = { lastDist: geo.dist, lastCentroid: geo.centroid };
        return;
      }
    }

    // Track cursor position (throttled to ~30fps)
    const now = performance.now();
    if (now - lastCursorUpdate.current > 32) {
      lastCursorUpdate.current = now;
      const world = editor.canvasToWorld(e.clientX, e.clientY);
      editor.setCursorPos(world);
    }

    const ne = e.nativeEvent as PointerEvent;
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
      const cam = { pan: s.pan, zoom: s.zoom };
      const anchor = screenToWorld(cam, clientX - rect.left, clientY - rect.top);
      const newCam = zoomAboutPoint(cam, anchor, clampZoom(newZoom));
      editorRef.current.setZoom(newCam.zoom);
      editorRef.current.setPan(newCam.pan);
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
      const nodes = rootNodes();
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
        const cam = { pan: s.pan, zoom: s.zoom };
        const centreWorld = screenToWorld(cam, vpW / 2, vpH / 2);
        const newCam = zoomAboutPoint(cam, centreWorld, newZoom);
        eRef.setZoom(newCam.zoom);
        eRef.setPan(newCam.pan);
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
          eRef.setZoom(cam.zoom);
          eRef.setPan(cam.pan);
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

  const cursor = tm.current?.cursor ?? 'default';

  // ─── Render ───────────────────────────────────────────────────────────────

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      e.dataTransfer.types.some(
        (t) => t === 'Files' || t.startsWith('image/') || t === 'text/svg+xml',
      )
    ) {
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    // Get drop position in world coordinates
    const rect = contentCanvasRef.current?.getBoundingClientRect();
    const cam = {
      pan: stateRef.current.pan,
      zoom: stateRef.current.zoom,
    };
    const dropWorld = rect ? screenToWorld(cam, e.clientX - rect.left, e.clientY - rect.top) : null;

    const reader = editorRef.current;

    // First check for dnd-kit native files (strata file type)
    const strataFiles = e.dataTransfer.types?.includes('application/x-strata-file');
    if (strataFiles) {
      // Handled by dnd-kit's onDragEnd instead
      return;
    }

    // Collect all OS files (including folders via FileSystemEntry API)
    const files = await collectFilesFromDataTransfer(e.dataTransfer);
    if (files.length === 0) return;

    // Parse all files FIRST (expensive SVG parsing) before any setState
    const parsedItems: {
      node: SceneNode;
      sourceDoc: Document;
      position?: { x: number; y: number };
    }[] = [];
    for (const [i, file] of files.entries()) {
      const result = importFile(file.name, file.data, {
        center: !dropWorld,
        embedImages: true,
      });
      for (const id of result.nodeIds) {
        const node = result.document.nodes[id];
        if (node) {
          const positionedNode = dropWorld
            ? applyDropPosition(node, {
                x: dropWorld[0] + i * 40,
                y: dropWorld[1] + i * 40,
              })
            : node;
          parsedItems.push({ node: positionedNode, sourceDoc: result.document });
        }
      }
    }

    // Single batched setState for all imported nodes
    if (parsedItems.length > 0) {
      reader.batchImportNodes(parsedItems);
    }
  }, []);

  const gridSize = Math.max(4, 24 * state.zoom);
  const showOverlays = state.canvasMode !== 'preview';

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

  return (
    <section
      ref={setCombinedRef}
      className={`editor-canvas${isDragOver ? ' editor-canvas--drag-over' : ''}${canvasDropClass}`}
      aria-label="Canvas"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
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
        role="application"
        aria-roledescription="Design canvas"
        aria-label="Design canvas"
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
      <canvas ref={overlayCanvasRef} className="editor-canvas__overlay-layer" role="presentation" />
      <Ruler
        zoom={state.zoom}
        pan={state.pan}
        unitType={state.unitType}
        onAddGuide={(axis, position) => editor.addGuide(axis, position)}
      />
      <GuideOverlay
        guides={editor.guides}
        zoom={state.zoom}
        pan={state.pan}
        onMoveGuide={(id, position) => editor.moveGuide(id, position)}
        onRemoveGuide={(id) => editor.removeGuide(id)}
        onToggleLock={(id) => editor.toggleGuideLock(id)}
      />
      <SnapGuidesOverlay guides={snapGuides} zoom={state.zoom} pan={state.pan} />
      {state.tool === 'nodeEdit' &&
        nodeEditTargetId &&
        (() => {
          const n = state.document.nodes[nodeEditTargetId];
          if (n?.kind !== 'shape' || n.shape.kind !== 'path') return null;
          const worldMat = editor.getWorldTransform(nodeEditTargetId);
          return (
            <NodeEditOverlay
              node={n}
              selectedAnchors={nodeEditSelectedAnchors}
              zoom={state.zoom}
              pan={state.pan}
              worldTransform={worldMat}
            />
          );
        })()}
      <SelectionOverlay canvasRef={contentCanvasRef} />
      {(() => {
        const sel = state.selection;
        if (sel.length !== 1) return null;
        const singleId = sel[0] as NodeId;
        const singleNode = state.document.nodes[singleId];
        if (singleNode?.kind !== 'frame') return null;
        const frame = singleNode;
        if (!frame.componentId) return null;
        const component = state.document.components[frame.componentId];
        const hasVariants = component?.variants && component.variants.length > 0;
        if (!hasVariants) return null;
        const worldB = editor.getWorldBounds(singleId);
        if (!worldB) return null;
        const screenX = worldB.x * state.zoom + state.pan.x;
        const screenY = worldB.y * state.zoom + state.pan.y;
        const screenW = worldB.w * state.zoom;
        const screenH = worldB.h * state.zoom;
        return (
          <VariantBox
            nodeId={singleId}
            document={state.document}
            onSetVariant={editor.setVariantForInstance}
            screenBounds={{ x: screenX, y: screenY, w: screenW, h: screenH }}
            onClose={() => {
              editor.announce('Closed variant panel');
            }}
          />
        );
      })()}
      {textEditTargetId &&
        (() => {
          const n = state.document.nodes[textEditTargetId];
          if (n?.kind !== 'text') return null;
          const canvasRect = contentCanvasRef.current?.getBoundingClientRect();
          const canvasLeft = canvasRect?.left ?? 0;
          const canvasTop = canvasRect?.top ?? 0;
          // Compose world transform (includes ancestor frames + own rotation/scale)
          const textWorldMat = editor.getWorldTransform(textEditTargetId);
          const worldX = textWorldMat[4];
          const worldY = textWorldMat[5];
          const textScreenX = worldX * state.zoom + state.pan.x + canvasLeft;
          const textScreenY = worldY * state.zoom + state.pan.y + canvasTop;
          const textScreenW =
            (n.text.length > 0
              ? n.text.length * (n.fontSize ?? 16) * 0.6
              : (n.fontSize ?? 16) * 3) * state.zoom;
          const textScreenH = (n.fontSize ?? 16) * 1.4 * state.zoom;
          const textScreenRect = {
            x: textScreenX,
            y: textScreenY,
            w: Math.max(textScreenW, 20),
            h: Math.max(textScreenH, 20),
          };
          return (
            <>
              <TextEditOverlay
                node={n}
                zoom={state.zoom}
                pan={state.pan}
                canvasElement={contentCanvasRef.current}
                worldX={worldX}
                worldY={worldY}
                worldTransform={textWorldMat}
                onCommit={() => setTextEditTargetId(null)}
                onUpdateText={(text) => {
                  editor.updateNode(textEditTargetId, (node) =>
                    node.kind === 'text' ? { ...node, text } : node,
                  );
                }}
              />
              <FloatingTextBar
                node={n}
                textScreenRect={textScreenRect}
                onUpdate={(id, changes) => {
                  editor.updateNode(id, (node) =>
                    node.kind === 'text' ? { ...node, ...changes } : node,
                  );
                }}
                onClose={() => setTextEditTargetId(null)}
              />
            </>
          );
        })()}
      {state.tool !== 'inspect' &&
        Object.keys(state.document.nodes).filter((id) => {
          const n = state.document.nodes[id];
          return n && n.kind !== 'group';
        }).length === 0 && (
          <div className="editor-canvas__empty">
            <EmptyState
              illustration={
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 64 64"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <title>Empty canvas</title>
                  <path
                    d="M24 20 L24 16 C24 14.9 24.9 14 26 14 L44 14 C45.1 14 46 14.9 46 16 L46 40 C46 41.1 45.1 42 44 42 L40 42"
                    opacity="0.4"
                  />
                  <path
                    d="M18 24 L26 24 C27.1 24 28 24.9 28 26 L28 48 C28 49.1 27.1 50 26 50 L18 50 C16.9 50 16 49.1 16 48 L16 26 C16 24.9 16.9 24 18 24Z"
                    opacity="0.3"
                  />
                  <line x1="22" y1="30" x2="30" y2="30" opacity="0.2" />
                  <line x1="22" y1="34" x2="30" y2="34" opacity="0.2" />
                  <line x1="22" y1="38" x2="28" y2="38" opacity="0.2" />
                  <path
                    d="M38 26 L42 22 M42 22 L46 26 M42 22 L42 34"
                    opacity="0.5"
                    strokeLinecap="round"
                  />
                </svg>
              }
              headline="Empty canvas"
              description="Click a tool and drag on the canvas to create your first shape"
            />
          </div>
        )}
      {showOverlays && state.tool === 'inspect' && (
        <MeasureOverlay
          zoom={state.zoom}
          pan={state.pan}
          selectedNodes={editor.selectedNodes()}
          doc={state.document}
          hoveredNode={hoveredNode}
        />
      )}
      <ZoomIndicator zoom={state.zoom} />
      <div
        className="editor-canvas__announcer"
        ref={announcer}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      />
      <CanvasAccessibilityTree
        doc={state.document}
        camera={{ zoom: state.zoom, pan: state.pan }}
        viewport={canvasSize}
        walkNodes={walkNodes}
        nodeWorldBounds={nodeWorldBounds}
        isWorldRectInViewport={isWorldRectInViewport}
      />
      {/* Accessible rename dialog — replaces blocking prompt() call */}
      <dialog
        ref={renameDialogRef}
        className="strata-dialog strata-dialog--sm"
        aria-labelledby="rename-dialog-title"
        onClose={() => setRenameDialog(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setRenameDialog(null);
        }}
      >
        <h2 id="rename-dialog-title" className="strata-dialog__title">
          Rename layer
        </h2>
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            const name = renameInputRef.current?.value.trim();
            if (name) editor.renameSelected(name);
            setRenameDialog(null);
          }}
        >
          <input
            ref={renameInputRef}
            className="canvas-rename__input"
            type="text"
            defaultValue={renameDialog?.defaultValue ?? ''}
            aria-label="Layer name"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="strata-dialog__actions">
            <button
              type="button"
              className="strata-btn strata-btn--ghost"
              onClick={() => setRenameDialog(null)}
            >
              Cancel
            </button>
            <button type="submit" className="strata-btn strata-btn--primary">
              Rename
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
