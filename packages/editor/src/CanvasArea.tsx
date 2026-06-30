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
import type { Engine, SceneNode as EngineNode } from '@strata/engine';
import { createEngine, type ReplayTarget, replayIr } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { walkNodes } from '@strata/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SnapGuidesOverlay } from './components/SnapGuidesOverlay';
import { MeasureOverlay } from './components/SpecPanel/MeasureOverlay';
import { nodeWorldBoundsFn, useEditor } from './context';
import { SelectionOverlay } from './SelectionOverlay';
import { nodeWorldTransform } from './scene/world';
import { type ToolContext, ToolManager } from './tools';
import { EllipseTool } from './tools/EllipseTool';
import { FrameTool } from './tools/FrameTool';
import { HandTool } from './tools/HandTool';
import { LineTool } from './tools/LineTool';
import { PenTool } from './tools/PenTool';
import { RectangleTool } from './tools/RectangleTool';
import { ScaleTool } from './tools/ScaleTool';
import { SelectTool } from './tools/SelectTool';
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
  if (n.kind === 'shape') return { ...base, shape: n.shape };
  if (n.kind === 'text')
    return {
      ...base,
      shape: { kind: 'rect', x: 0, y: 0, w: n.fontSize * 3, h: n.fontSize * 1.4 } as const,
    };
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
    toolManager.register('pen', () => new PenTool());
    toolManager.register('text', () => new TextTool());
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
  const [hoveredNode, setHoveredNode] = useState<SceneNode | null>(null);

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
      snapEnabled: false,
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
      reparentNode: (id, newParentId, toIndex) => e.reparentNode(id, newParentId, toIndex),
      setPan: (p) => e.setPan(p),
      setZoom: (z) => e.setZoom(z),
      announce: (msg) => e.announce(msg),
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

      snapPosition: (bounds, targets) => {
        const result = snapPosition(bounds.x, bounds.y, bounds.w, bounds.h, targets);
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
      const s = stateRef.current;
      // DFS flatten: walk all nodes (including children of frames/groups)
      // and compute world transforms per node. This replaces the old
      // `rootNodes().map(toEngineNode)` which skipped nested nodes.
      const doc = s.document;
      const entries = walkNodes(doc);
      const flatNodes: EngineNode[] = [];
      for (const [id] of entries) {
        const n = doc.nodes[id];
        if (!n) continue;
        const world = nodeWorldTransform(doc, id);
        flatNodes.push({ ...toEngineNode(n), transform: world });
      }
      const ir = await eng.buildIr({ nodes: flatNodes });

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.setTransform(dpr * s.zoom, 0, 0, dpr * s.zoom, dpr * s.pan.x, dpr * s.pan.y);
      replayIr(ctx as unknown as ReplayTarget, ir);

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
  }, [rootNodes, draft]);

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

  // ─── Wheel (zoom) ─────────────────────────────────────────────────────────

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    editor.setZoom(Math.max(0.1, Math.min(10, state.zoom * factor)));
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
            eRef.announce(`Selected ${prev.name}`);
          }
        } else {
          const next = nodes[(idx + 1) % nodes.length];
          if (next) {
            eRef.setSelection(next.id);
            eRef.announce(`Selected ${next.name}`);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        eRef.setSelection(null);
        eRef.announce('Selection cleared');
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        const name = prompt('Rename layer', nodes[idx]?.name ?? '');
        if (name) eRef.renameSelected(name);
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
        onWheel={handleWheel}
      />
      <SnapGuidesOverlay guides={snapGuides} zoom={state.zoom} pan={state.pan} />
      <SelectionOverlay />
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
