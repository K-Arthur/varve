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
import {
  createEngine,
  type Engine,
  type SceneNode as EngineNode,
  type ReplayTarget,
  replayIr,
} from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { walkNodes } from '@strata/scene';
import { clampZoom, fitBoundsCamera, screenToWorld, zoomAboutPoint } from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeEditOverlay } from './components/NodeEditOverlay';
import { SnapGuidesOverlay } from './components/SnapGuidesOverlay';
import { MeasureOverlay } from './components/SpecPanel/MeasureOverlay';
import { nodeWorldBoundsFn, useEditor } from './context';
import { SelectionOverlay } from './SelectionOverlay';
import { nodeWorldBounds, nodeWorldTransform } from './scene/world';
import { type ToolContext, ToolManager } from './tools';
import { ArrowTool } from './tools/ArrowTool';
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
    };
  if (n.kind === 'frame')
    return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: n.w, h: n.h } as const };
  return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 } as const };
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

export function CanvasArea() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useRef<HTMLDivElement>(null);
  const editor = useEditor();
  const { state, rootNodes } = editor;

  const engineRef = useRef<Engine | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    label?: string;
  } | null>(null);

  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const [nodeEditTargetId, setNodeEditTargetId] = useState<string | null>(null);
  const [nodeEditSelectedAnchors, setNodeEditSelectedAnchors] = useState<ReadonlySet<number>>(
    new Set(),
  );
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
      createTextNodeAt: (world, size, parentId, text) =>
        e.createTextNodeAt(world, size, parentId, text),
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
      nodeWorldBounds: (n) => nodeWorldBoundsFn(n),

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
        const world = nodeWorldTransform(doc, id);
        nodeIds.push(id);
        flatNodes.push({ ...toEngineNode(n), transform: world });
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

        if (n.kind === 'frame') {
          // Paint frame background before establishing child clip.
          if (item) replayIr(ctxNN as unknown as ReplayTarget, [item]);
          if (n.children.length > 0) {
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
          }
        } else if (n.kind === 'group') {
          // Groups are transparent pass-through containers; no background painted.
          for (const childId of n.children) {
            replaySubtree(childId);
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

      if (draft) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / s.zoom;
        ctx.setLineDash([4 / s.zoom, 4 / s.zoom]);
        ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
        ctx.setLineDash([]);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sx = draft.x * s.zoom + s.pan.x;
        const sy = draft.y * s.zoom + s.pan.y;
        const sw = draft.w * s.zoom;
        ctx.font = '11px system-ui';
        ctx.fillStyle = '#3b82f6';
        const label = draft.label ?? `${Math.round(draft.w)} x ${Math.round(draft.h)}`;
        ctx.fillText(label, sx + sw + 4, sy + 14);
      }
    })();
  }, [rootNodes, draft, state.zoom, state.pan.x, state.pan.y]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ─── Middle-button pan (bypasses ToolManager) ──────────────────────────

  const midPanRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  } | null>(null);

  // ─── Pointer Events ──────────────────────────────────────────────────────

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const ne = e.nativeEvent as PointerEvent;
    const tmInst = tm.current;
    if (!tmInst) return;

    // Middle-button → temporary pan (bypass ToolManager to avoid tool switch)
    if (e.button === 1) {
      e.currentTarget.setPointerCapture(e.pointerId);
      midPanRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: state.pan.x,
        panY: state.pan.y,
      };
      return;
    }

    const ctx = buildToolCtx(ne);
    tmInst.handlePointerDown(ne, ctx);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const mid = midPanRef.current;
    if (mid) {
      editor.setPan({
        x: mid.panX + e.clientX - mid.startX,
        y: mid.panY + e.clientY - mid.startY,
      });
      return;
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
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    setSnapGuides([]);
    if (midPanRef.current) {
      midPanRef.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }

    const ne = e.nativeEvent as PointerEvent;
    const tmInst = tm.current;
    if (!tmInst) return;

    tmInst.handlePointerUp(ne, buildToolCtx(ne));
  }

  function handlePointerCancel(e: React.PointerEvent<HTMLCanvasElement>) {
    midPanRef.current = null;
    const ne = e.nativeEvent as PointerEvent;
    tm.current?.handlePointerCancel(ne, buildToolCtx(ne));
    setSnapGuides([]);
  }

  // ─── Wheel ─────────────────────────────────────────────────────────────
  // Wheel + ctrlKey = pinch / precision-zoom (macOS/Wayland trackpad gesture).
  // Plain wheel (no ctrlKey) = two-finger scroll → pan the camera.
  // Both paths call e.preventDefault() to suppress page scroll.

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const s = stateRef.current;

    if (e.ctrlKey) {
      // ── Pinch / cursor-anchored zoom ────────────────────────────────
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const cam = { pan: [s.pan.x, s.pan.y] as [number, number], zoom: s.zoom };
      const worldAnchor = screenToWorld(cam, cx, cy);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = clampZoom(s.zoom * factor);
      const newCam = zoomAboutPoint(cam, worldAnchor, newZoom);
      editor.setZoom(newCam.zoom);
      editor.setPan({ x: newCam.pan[0], y: newCam.pan[1] });
    } else {
      // ── Two-finger scroll → pan ──────────────────────────────────────
      // deltaX/deltaY arrive in pixel units (deltaMode=DOM_DELTA_PIXEL) on
      // Wayland trackpads. Subtract: scrolling "down" (deltaY>0) moves the
      // world origin upward, shrinking pan.y.
      editor.setPan({ x: s.pan.x - e.deltaX, y: s.pan.y - e.deltaY });
    }
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const ne = e.nativeEvent as KeyboardEvent;
      const tmInst = tm.current;

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

  // ─── Cursor ───────────────────────────────────────────────────────────────

  const cursor = tm.current?.cursor ?? 'default';

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <section className="editor-canvas" aria-label="Canvas">
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
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => editor.setCursorPos(null)}
        onBlur={() => {
          // Cancel any active drag on window blur
          tm.current?.activeTool.onPointerCancel?.(
            new PointerEvent('pointercancel'),
            buildToolCtx(new PointerEvent('pointercancel')),
          );
        }}
        onWheel={handleWheel}
      />
      <SnapGuidesOverlay guides={snapGuides} zoom={state.zoom} pan={state.pan} />
      {state.tool === 'nodeEdit' &&
        nodeEditTargetId &&
        (() => {
          const n = state.document.nodes[nodeEditTargetId];
          if (!n || n.kind !== 'shape' || n.shape.kind !== 'path') return null;
          return (
            <NodeEditOverlay
              node={n}
              selectedAnchors={nodeEditSelectedAnchors}
              zoom={state.zoom}
              pan={state.pan}
            />
          );
        })()}
      <SelectionOverlay />
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
