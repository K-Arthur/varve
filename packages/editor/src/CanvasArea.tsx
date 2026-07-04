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
  createEngine,
  type Engine,
  type SceneNode as EngineNode,
  type ReplayTarget,
  replayIr,
} from '@strata/engine';
import { importFile } from '@strata/import';
import type { NodeId, SceneNode } from '@strata/scene';
import { walkNodes } from '@strata/scene';
import { clampZoom, fitBoundsCamera, screenToWorld, zoomAboutPoint } from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FloatingTextBar } from './components/FloatingTextBar/FloatingTextBar';
import { GuideOverlay } from './components/GuideOverlay/GuideOverlay';
import { NodeEditOverlay } from './components/NodeEditOverlay';
import { Ruler } from './components/Ruler/Ruler';
import { SnapGuidesOverlay } from './components/SnapGuidesOverlay';
import { MeasureOverlay } from './components/SpecPanel/MeasureOverlay';
import { TextEditOverlay } from './components/TextEditOverlay';
import { VariantBox } from './components/VariantBox/VariantBox';
import { nodeWorldBoundsFn, useEditor } from './context';
import { applyDropPosition, collectFilesFromDataTransfer } from './dropUtils';
import { SelectionOverlay } from './SelectionOverlay';
import { nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { sampleTimelineAt } from './timeline/TimelineSampler';
import { type DraftShape, type ToolContext, ToolManager } from './tools';
import { ArrowTool } from './tools/ArrowTool';
import { computeEdgeVelocity } from './tools/autoPan';
import { EllipseTool } from './tools/EllipseTool';
import { EyedropperTool } from './tools/EyedropperTool';
import { FrameTool } from './tools/FrameTool';
import { HandTool } from './tools/HandTool';
import { LineTool } from './tools/LineTool';
import { NodeEditTool } from './tools/NodeEditTool';
import { PencilTool } from './tools/PencilTool';
import { PenTool } from './tools/PenTool';
import { PolygonTool } from './tools/PolygonTool';
import { RectangleTool } from './tools/RectangleTool';
import { ScaleTool } from './tools/ScaleTool';
import { SelectTool } from './tools/SelectTool';
import { SliceTool } from './tools/SliceTool';
import { StarTool } from './tools/StarTool';
import { type SnapGuide, snapPosition } from './tools/snapping';
import { TextTool } from './tools/TextTool';
import { ZoomTool } from './tools/ZoomTool';

type DocNode = SceneNode;

/** Trace the outline of a scene node's shape on a CanvasRenderingContext2D.
 * Used for mask clipping — traces in the node's local space. The caller is
 * responsible for applying the node's world transform before calling. */
function traceShapeOutline(ctx: CanvasRenderingContext2D, n: SceneNode): void {
  if (n.kind === 'shape' && n.shape) {
    const s = n.shape;
    switch (s.kind) {
      case 'rect':
        ctx.rect(s.x, s.y, s.w, s.h);
        break;
      case 'ellipse':
        ctx.ellipse(s.cx, s.cy, s.rx, s.ry, 0, 0, Math.PI * 2);
        break;
      case 'circle':
        ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
        break;
      case 'line':
        ctx.moveTo(s.from[0], s.from[1]);
        ctx.lineTo(s.to[0], s.to[1]);
        break;
      case 'arrow':
        ctx.moveTo(s.from[0], s.from[1]);
        ctx.lineTo(s.to[0], s.to[1]);
        break;
      case 'polygon':
        for (let i = 0; i < s.sides; i++) {
          const a = (2 * Math.PI * i) / s.sides - Math.PI / 2 + s.rotation;
          const px = s.cx + s.radius * Math.cos(a);
          const py = s.cy + s.radius * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      case 'star':
        for (let i = 0; i < s.points * 2; i++) {
          const a = (Math.PI * i) / s.points - Math.PI / 2 + s.rotation;
          const r = i % 2 === 0 ? s.outerRadius : s.innerRadius;
          const px = s.cx + r * Math.cos(a);
          const py = s.cy + r * Math.sin(a);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      case 'path':
        if (s.points.length > 0) {
          ctx.moveTo(s.points[0]?.x ?? 0, s.points[0]?.y ?? 0);
          for (let i = 1; i < s.points.length; i++) {
            const pt = s.points[i];
            const prev = s.points[i - 1];
            if (!pt || !prev) continue;
            if (prev.handleOut || pt.handleIn) {
              const cp1x = prev.handleOut ? prev.x + prev.handleOut[0] : prev.x;
              const cp1y = prev.handleOut ? prev.y + prev.handleOut[1] : prev.y;
              const cp2x = pt.handleIn ? pt.x + pt.handleIn[0] : pt.x;
              const cp2y = pt.handleIn ? pt.y + pt.handleIn[1] : pt.y;
              ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, pt.x, pt.y);
            } else {
              ctx.lineTo(pt.x, pt.y);
            }
          }
          if (s.closed) ctx.closePath();
        }
        break;
    }
  } else if (n.kind === 'frame' || n.kind === 'image') {
    const w = 'w' in n ? (n.w ?? 100) : 100;
    const h = 'h' in n ? (n.h ?? 100) : 100;
    ctx.rect(0, 0, w, h);
  }
}

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
  if (n.kind === 'image')
    return {
      ...base,
      kind: 'image',
      src: n.src,
      w: n.w,
      h: n.h,
    };
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const [draft, setDraft] = useState<DraftShape | null>(null);
  const drawRafRef = useRef<number | null>(null);

  // E1: Auto-pan when dragging near canvas edge.
  const autoPanRaf = useRef<number | null>(null);
  const autoPanVelocity = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [nodeEditTargetId, setNodeEditTargetId] = useState<string | null>(null);
  const [nodeEditSelectedAnchors, setNodeEditSelectedAnchors] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const [textEditTargetId, setTextEditTargetId] = useState<string | null>(null);
  const pendingAutoTextEditRef = useRef(false);
  const [hoveredNode, setHoveredNode] = useState<SceneNode | null>(null);
  const lastCursorUpdate = useRef(0);

  useEffect(() => {
    createEngine('auto').then((eng) => {
      engineRef.current = eng;
    });
  }, []);

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
        const rect = canvasRef.current?.getBoundingClientRect();
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
        const el = canvasRef.current;
        if (el) el.setPointerCapture(pointerId);
      },
      releasePointerCapture: (pointerId) => {
        const el = canvasRef.current;
        if (el) el.releasePointerCapture(pointerId);
      },

      findContainingFrame: (world) => e.findContainingFrame(world),
      nodeWorldBounds: (n) => nodeWorldBounds(s.document, n.id) ?? nodeWorldBoundsFn(n),

      engine: eng,
      canvasElement: canvasRef.current,
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
        const result = snapPosition(bounds.x, bounds.y, bounds.w, bounds.h, targets, s.snapGrid);
        setSnapGuides(result.guides);
        return result;
      },
    };
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio ?? 1;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const eng = engineRef.current;
    if (!eng) return;

    (async () => {
      if (!ctx) return;
      // Capture narrowed ctx into a const so TypeScript propagates the
      // non-null type into nested function closures (replaySubtree).
      const ctxNN = ctx;
      const s = stateRef.current;
      const doc = s.document;

      // Pre-build all IR items in one call (single IPC round-trip for native engine).
      // Nodes are in DFS paint order so the indices align with the IR array.
      const entries = walkNodes(doc);
      const nodeIds: string[] = [];
      const flatNodes: EngineNode[] = [];
      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        // Skip groups — they are transparent pass-through containers, not drawables.
        // replaySubtree handles groups separately (line 343-350).
        if (n.kind === 'group') continue;
        const world = nodeWorldTransform(doc, id);
        nodeIds.push(id);
        flatNodes.push({ ...toEngineNode(n), transform: world });
      }

      // ── Motion / Timeline sampling ──────────────────────────────────────────
      // Apply property overrides from the active timeline to engine nodes
      // before building IR. These overrides are ephemeral — they only affect
      // this frame's rendering and never mutate the document.
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

      // Map NodeId → RenderItem for O(1) lookup during tree-aware replay.
      type IrItem = (typeof ir)[number];
      const irByNodeId = new Map<string, IrItem>();
      for (let i = 0; i < nodeIds.length; i++) {
        const nid = nodeIds[i];
        const item = ir[i];
        if (nid && item) irByNodeId.set(nid, item);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);

      // Tree-aware replay: frames clip their children; groups are transparent containers.
      // The clip polygon is computed in world space (current CTM = camera) by transforming
      // the frame's local rect corners via its world transform.
      function replaySubtree(nodeId: string): void {
        const n = doc.nodes[nodeId];
        if (!n || n.visible === false) return;
        const item = irByNodeId.get(nodeId);

        // Check for mask on the container
        const mask = 'mask' in n && n.mask && n.mask.visible ? n.mask : null;
        const maskSrcId = mask ? mask.sourceNodeId : null;
        const maskChild = maskSrcId ? doc.nodes[maskSrcId] : null;

        if (n.kind === 'frame') {
          // Paint frame background before establishing child clip.
          if (item) replayIr(ctxNN as unknown as ReplayTarget, [item]);
          if (n.children.length > 0) {
            const shouldClip = n.clipContent !== false;

            // When a mask is present, apply it as a clip region for all children
            // (the mask source node is used only as a clip path, not rendered)
            if (mask && maskChild && maskSrcId) {
              ctxNN.save();
              // Trace the mask source node's outline in world space
              const maskWorldTransform = nodeWorldTransform(doc, maskSrcId);
              const [ma, mb, mc, md, me, mf] = maskWorldTransform;
              ctxNN.transform(ma, mb, mc, md, me, mf);
              ctxNN.beginPath();
              traceShapeOutline(ctxNN, maskChild);
              ctxNN.closePath();
              ctxNN.clip();
              // Undo the mask transform so children render at their own world positions
              ctxNN.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
              // Render all children except the mask source itself
              for (const childId of n.children) {
                if (childId !== maskSrcId) {
                  replaySubtree(childId);
                }
              }
              ctxNN.restore();
            } else if (shouldClip && !mask) {
              // Compute frame rect corners in world space from the item's world transform.
              // Affine [a,b,c,d,e,f]: point (x,y) → (a·x + c·y + e, b·x + d·y + f).
              const t = item?.transform ?? ([1, 0, 0, 1, 0, 0] as const);
              const [a, b, c, d, e, f] = t;
              const fw = n.w;
              const fh = n.h;
              ctxNN.save();
              ctxNN.beginPath();
              ctxNN.moveTo(e, f);
              ctxNN.lineTo(a * fw + e, b * fw + f);
              ctxNN.lineTo(a * fw + c * fh + e, b * fw + d * fh + f);
              ctxNN.lineTo(c * fh + e, d * fh + f);
              ctxNN.closePath();
              ctxNN.clip();
              for (const childId of n.children) {
                replaySubtree(childId);
              }
              ctxNN.restore();
            } else {
              for (const childId of n.children) {
                replaySubtree(childId);
              }
            }
          }
        } else if (n.kind === 'group') {
          // Groups are transparent pass-through containers; no background painted.
          // Apply mask if present
          if (mask && maskChild && maskSrcId) {
            ctxNN.save();
            const maskWorldTransform = nodeWorldTransform(doc, maskSrcId);
            const [ma, mb, mc, md, me, mf] = maskWorldTransform;
            ctxNN.transform(ma, mb, mc, md, me, mf);
            ctxNN.beginPath();
            traceShapeOutline(ctxNN, maskChild);
            ctxNN.closePath();
            ctxNN.clip();
            ctxNN.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
            for (const childId of n.children) {
              if (childId !== maskSrcId) {
                replaySubtree(childId);
              }
            }
            ctxNN.restore();
          } else {
            for (const childId of n.children) {
              replaySubtree(childId);
            }
          }
        } else {
          if (item) replayIr(ctxNN as unknown as ReplayTarget, [item]);
        }
      }

      // Render root-level nodes in DFS paint order.
      for (const [id, entry] of entries) {
        if (entry.parentId === null) {
          replaySubtree(id);
        }
      }

      // ── Layout grid overlay for frames with gridTemplate ────────────────
      ctx.strokeStyle = 'rgba(57, 208, 198, 0.25)';
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
        const world = nodeWorldTransform(doc, nid);
        const [a, b, c, d, e, f] = world;
        const fw = frame.w;
        const fh = frame.h;
        // Parse simple column/row templates (e.g., "1fr 200px 1fr").
        const colSizes = parseGridTemplate(ls.gridTemplateColumns ?? '', fw);
        const rowSizes = parseGridTemplate(ls.gridTemplateRows ?? '', fh);
        const gapX = ls.columnGap ?? ls.gap ?? 0;
        const gapY = ls.rowGap ?? ls.gap ?? 0;
        // Compute column boundary lines in local space, transform to world.
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

      if (draft) {
        ctx.strokeStyle = '#3b82f6';
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
              ctx.fillStyle = '#3b82f6';
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
        ctx.fillStyle = '#3b82f6';
        const label =
          draft.label ??
          `${Math.round(sw / s.zoom)} x ${Math.round('h' in draft ? draft.h * s.zoom : (Math.abs(draft.y2 - draft.y1) * s.zoom) / s.zoom)}`;
        ctx.fillText(label, sx + sw + 4, sy + 14);
      }
    })();
  }, [rootNodes, draft, state.zoom, state.pan.x, state.pan.y]);

  useEffect(() => {
    // Cancel any pending draw, schedule one aligned to the next vsync.
    // Prevents concurrent async IIFE interleaving when draw dependencies
    // change faster than the frame budget (e.g. zoom/pan scroll).
    if (drawRafRef.current !== null) {
      cancelAnimationFrame(drawRafRef.current);
    }
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = null;
      draw();
    });
    return () => {
      if (drawRafRef.current !== null) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
    };
  }, [draw]);

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
        const rect = canvasRef.current?.getBoundingClientRect();
        // Pan by centroid movement…
        const panned = {
          x: s.pan.x + (geo.centroid.x - pinch.lastCentroid.x),
          y: s.pan.y + (geo.centroid.y - pinch.lastCentroid.y),
        };
        // …then zoom about the current centroid by the distance ratio.
        const cam = { pan: [panned.x, panned.y] as [number, number], zoom: s.zoom };
        const anchor = screenToWorld(
          cam,
          geo.centroid.x - (rect?.left ?? 0),
          geo.centroid.y - (rect?.top ?? 0),
        );
        const factor = pinch.lastDist > 0 ? geo.dist / pinch.lastDist : 1;
        const newCam = zoomAboutPoint(cam, anchor, clampZoom(s.zoom * factor));
        editorRef.current.setZoom(newCam.zoom);
        editorRef.current.setPan({ x: newCam.pan[0], y: newCam.pan[1] });
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
      const rect = canvasRef.current?.getBoundingClientRect();
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
    const el = canvasRef.current;
    if (!el) return;

    // Normalize deltaMode: Firefox mouse wheels report DOM_DELTA_LINE (1).
    const deltaScale = (e: WheelEvent): number =>
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;

    const zoomAboutClientPoint = (clientX: number, clientY: number, newZoom: number): void => {
      const s = stateRef.current;
      const rect = el.getBoundingClientRect();
      const cam = { pan: [s.pan.x, s.pan.y] as [number, number], zoom: s.zoom };
      const anchor = screenToWorld(cam, clientX - rect.left, clientY - rect.top);
      const newCam = zoomAboutPoint(cam, anchor, clampZoom(newZoom));
      editorRef.current.setZoom(newCam.zoom);
      editorRef.current.setPan({ x: newCam.pan[0], y: newCam.pan[1] });
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const s = stateRef.current;
      const k = deltaScale(e);
      if (e.ctrlKey || e.metaKey) {
        // Exponential in deltaY so a stream of small trackpad pinch deltas
        // zooms smoothly; clamp per-event so a discrete mouse-wheel notch
        // (deltaY ≈ ±120) stays a reasonable step instead of jumping 3×.
        const d = Math.max(-24, Math.min(24, e.deltaY * k));
        zoomAboutClientPoint(e.clientX, e.clientY, s.zoom * Math.exp(-d * 0.01));
      } else if (e.shiftKey && e.deltaX === 0) {
        editorRef.current.setPan({ x: s.pan.x - e.deltaY * k, y: s.pan.y });
      } else {
        editorRef.current.setPan({ x: s.pan.x - e.deltaX * k, y: s.pan.y - e.deltaY * k });
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
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        const name = prompt('Rename layer', nodes[idx]?.name ?? '');
        if (name) eRef.renameSelected(name);
      }

      // ── Helper: zoom about the canvas centre ─────────────────────────
      function zoomAboutCanvasCentre(newZoom: number): void {
        const s = stateRef.current;
        const parent = canvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const cam = { pan: [s.pan.x, s.pan.y] as [number, number], zoom: s.zoom };
        const centreWorld = screenToWorld(cam, vpW / 2, vpH / 2);
        const newCam = zoomAboutPoint(cam, centreWorld, newZoom);
        eRef.setZoom(newCam.zoom);
        eRef.setPan({ x: newCam.pan[0], y: newCam.pan[1] });
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
        const parent = canvasRef.current?.parentElement;
        const vpW = parent?.clientWidth ?? 800;
        const vpH = parent?.clientHeight ?? 600;
        const canvasViewport = { width: vpW, height: vpH };
        const allBounds = rootNodes().reduce<{ x: number; y: number; w: number; h: number } | null>(
          (acc, n) => {
            const b = nodeWorldBounds(state.document, n.id);
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
          eRef.setPan({ x: cam.pan[0], y: cam.pan[1] });
          eRef.announceOperation('Zoom', 'fit all');
        }
      }
      if (e.key === '2' && e.shiftKey) {
        e.preventDefault();
        if (selArr.length > 0) {
          const parent = canvasRef.current?.parentElement;
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
    const rect = canvasRef.current?.getBoundingClientRect();
    const cam = {
      pan: [stateRef.current.pan.x, stateRef.current.pan.y] as [number, number],
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

    for (const [i, file] of files.entries()) {
      const result = importFile(file.name, file.data, {
        center: !dropWorld,
        embedImages: true,
      });
      for (const id of result.nodeIds) {
        const node = result.document.nodes[id];
        if (node) {
          // Apply position if we have a drop world coordinate
          const positionedNode = dropWorld
            ? applyDropPosition(node, {
                x: dropWorld[0] + i * 40,
                y: dropWorld[1] + i * 40,
              })
            : node;
          reader.importNode(positionedNode, result.document);
        }
      }
      reader.announceOperation('Import', `Imported ${file.name}`);
    }
  }, []);

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
        ref={canvasRef}
        tabIndex={0}
        role="img"
        aria-label="Design canvas"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor,
        }}
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
          // Cancel any active drag and release spring-loaded tools on blur
          tm.current?.activeTool.onPointerCancel?.(
            new PointerEvent('pointercancel'),
            buildToolCtx(new PointerEvent('pointercancel')),
          );
          if (tm.current?.springActive) {
            tm.current.releaseSpring(buildToolCtx(new PointerEvent('pointercancel')));
          }
        }}
      />
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
          const worldMat = nodeWorldTransform(state.document, nodeEditTargetId);
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
      <SelectionOverlay canvasRef={canvasRef} />
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
        const worldB = nodeWorldBounds(state.document, singleId);
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
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const canvasLeft = canvasRect?.left ?? 0;
          const canvasTop = canvasRect?.top ?? 0;
          // Compose world transform (includes ancestor frames + own rotation/scale)
          const textWorldMat = nodeWorldTransform(state.document, textEditTargetId);
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
                canvasElement={canvasRef.current}
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
      {state.tool !== 'inspect' && Object.keys(state.document.nodes).length === 0 && (
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
      {state.tool === 'inspect' && (
        <MeasureOverlay
          zoom={state.zoom}
          pan={state.pan}
          selectedNodes={editor.selectedNodes()}
          doc={state.document}
          hoveredNode={hoveredNode}
        />
      )}
      <div className="editor-canvas__announcer" ref={announcer} role="status" aria-live="polite" />
    </section>
  );
}
