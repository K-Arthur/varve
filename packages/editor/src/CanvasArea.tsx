/**
 * Canvas area — the main drawing surface.
 *
 * A2/F3: Canvas backing store = cssSize × devicePixelRatio for crisp HiDPI rendering.
 *        Pointer coordinate math stays in CSS logical pixels (no DPR factor needed there).
 * A5:    SelectionOverlay SVG rendered on top of the canvas showing bbox + handles.
 * A6:    Full Pointer Events gesture state machine: drawing (drag-to-size), panning,
 *        marquee selecting, node moving. Pointer capture for correct tracking.
 * A9:    Drag-to-move selected nodes via body-drag on the select tool.
 * Research basis: MDN Pointer Events, MDN Canvas DPR scaling,
 *                 https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas
 */
import type { Engine, SceneNode as EngineNode } from '@strata/engine';
import { createEngine, type ReplayTarget, replayIr } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEditor } from './context';
import { MeasureOverlay } from './components/SpecPanel/MeasureOverlay';
import { SelectionOverlay } from './SelectionOverlay';

type DocNode = SceneNode;

function toEngineNode(n: DocNode): EngineNode {
  const base = {
    id: n.id,
    name: n.name,
    fill: n.fill,
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

type GestureKind = 'idle' | 'drawing' | 'panning' | 'moving' | 'marquee';

interface GestureState {
  kind: GestureKind;
  pointerId: number;
  /** CSS-px canvas coords at gesture start */
  startCanvas: { x: number; y: number };
  /** World coords at gesture start */
  startWorld: { x: number; y: number };
  /** Current CSS-px canvas coords */
  currentCanvas: { x: number; y: number };
  /** Pan at gesture start (for panning gesture) */
  startPan: { x: number; y: number };
  /** Node being moved (for move gesture) */
  movingId: string | null;
  /** Node's world position at start of move */
  movingOrigin: { x: number; y: number } | null;
}

function canvasToWorld(
  cx: number,
  cy: number,
  pan: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  return { x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom };
}

export function CanvasArea() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useRef<HTMLDivElement>(null);
  const {
    state,
    rootNodes,
    createShapeAt,
    isSelected,
    setSelection,
    toggleSelection,
    setPan,
    setNodePosition,
    setZoom,
    renameSelected,
    announce: contextAnnounce,
  } = useEditor();

  const [hoveredNode, setHoveredNode] = useState<DocNode | null>(null);
  const engineRef = useRef<Engine | null>(null);

  const gesture = useRef<GestureState>({
    kind: 'idle',
    pointerId: -1,
    startCanvas: { x: 0, y: 0 },
    startWorld: { x: 0, y: 0 },
    currentCanvas: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    movingId: null,
    movingOrigin: null,
  });

  // Draft shape while drawing gesture in progress
  const [draft, setDraft] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  useEffect(() => {
    // Use 'auto' to pick native engine on Tauri, stub in browser/tests
    createEngine('auto').then((eng) => {
      engineRef.current = eng;
    });
  }, []);

  // ─── Drawing ──────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // A2: back the canvas at physical resolution for crisp HiDPI rendering
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
      const nodes = rootNodes().map(toEngineNode);
      const ir = await eng.buildIr({ nodes });

      // Clear (in backing-store pixels)
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // World → backing-store transform: scale by dpr*zoom, translate by dpr*pan
      ctx.setTransform(
        dpr * state.zoom,
        0,
        0,
        dpr * state.zoom,
        dpr * state.pan.x,
        dpr * state.pan.y,
      );
      replayIr(ctx as unknown as ReplayTarget, ir);

      // Draw draft while a drawing gesture is in progress
      if (draft) {
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1 / state.zoom;
        ctx.setLineDash([4 / state.zoom, 4 / state.zoom]);
        ctx.strokeRect(draft.x, draft.y, draft.w, draft.h);
        ctx.setLineDash([]);

        // Dimension readout
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const sx = draft.x * state.zoom + state.pan.x;
        const sy = draft.y * state.zoom + state.pan.y;
        const sw = draft.w * state.zoom;
        ctx.font = '11px system-ui';
        ctx.fillStyle = '#3b82f6';
        ctx.fillText(`${Math.round(draft.w)} × ${Math.round(draft.h)}`, sx + sw + 4, sy + 14);
      }
    })();
  }, [state.document, state.zoom, state.pan, rootNodes, draft]);

  useEffect(() => {
    draw();
  }, [draw]);

  // ─── Announce helper ──────────────────────────────────────────────────────

  const announce = useCallback((msg: string) => {
    if (announcer.current) announcer.current.textContent = msg;
  }, []);

  // ─── Coordinate helpers ───────────────────────────────────────────────────

  function eventToCanvas(e: React.PointerEvent | PointerEvent): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // ─── Pointer Events gesture machine ───────────────────────────────────────

  async function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (gesture.current.kind !== 'idle') return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const cv = eventToCanvas(e);
    const world = canvasToWorld(cv.x, cv.y, state.pan, state.zoom);
    const isPan = state.tool === 'hand' || e.button === 1;

    if (isPan) {
      gesture.current = {
        kind: 'panning',
        pointerId: e.pointerId,
        startCanvas: cv,
        startWorld: world,
        currentCanvas: cv,
        startPan: { ...state.pan },
        movingId: null,
        movingOrigin: null,
      };
      return;
    }

    const isDrawTool = [
      'rect',
      'ellipse',
      'polygon',
      'star',
      'line',
      'frame',
      'text',
      'pen',
    ].includes(state.tool);

    if (state.tool === 'select' || state.tool === 'zoomIn' || state.tool === 'inspect') {
      const eng = engineRef.current;
      if (!eng) return;
      const nodes = rootNodes().map(toEngineNode);
      const idx = await eng.hitTest({ nodes }, [world.x, world.y]);

      if (state.tool === 'zoomIn') {
        const factor = e.shiftKey ? 0.9 : 1.1;
        setZoom(Math.max(0.1, Math.min(10, state.zoom * factor)));
        return;
      }

      if (state.tool === 'inspect') {
        if (idx !== null) {
          const hit = nodes[idx];
          if (hit) {
            const docNode = state.document.nodes[hit.id];
            if (docNode?.locked) return;
            if (e.shiftKey) {
              toggleSelection(hit.id, true);
            } else if (!isSelected(hit.id)) {
              setSelection(hit.id);
            }
            announce(`Selected ${hit.name}`);
          }
        } else {
          if (!e.shiftKey) setSelection(null);
        }
        gesture.current = {
          ...gesture.current,
          kind: 'idle',
          pointerId: -1,
          movingId: null,
          movingOrigin: null,
        };
        return;
      }

      if (idx !== null) {
        const hit = nodes[idx];
        if (hit) {
          // Check if locked
          const docNode = state.document.nodes[hit.id];
          if (docNode?.locked) return;

          // Select (additive with shift)
          if (e.shiftKey) {
            toggleSelection(hit.id, true);
          } else if (!isSelected(hit.id)) {
            setSelection(hit.id);
          }
          announce(`Selected ${hit.name}`);

          // Start move gesture
          gesture.current = {
            kind: 'moving',
            pointerId: e.pointerId,
            startCanvas: cv,
            startWorld: world,
            currentCanvas: cv,
            startPan: { ...state.pan },
            movingId: hit.id,
            movingOrigin: { x: docNode?.transform[4] ?? 0, y: docNode?.transform[5] ?? 0 },
          };
        }
      } else {
        // Click on empty space — clear selection, start marquee
        if (!e.shiftKey) setSelection(null);
        gesture.current = {
          kind: 'marquee',
          pointerId: e.pointerId,
          startCanvas: cv,
          startWorld: world,
          currentCanvas: cv,
          startPan: { ...state.pan },
          movingId: null,
          movingOrigin: null,
        };
      }
      return;
    }

    if (isDrawTool) {
      gesture.current = {
        kind: 'drawing',
        pointerId: e.pointerId,
        startCanvas: cv,
        startWorld: world,
        currentCanvas: cv,
        startPan: { ...state.pan },
        movingId: null,
        movingOrigin: null,
      };
    }
  }

  async function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;

    if (g.kind === 'idle') {
      if (state.tool === 'inspect') {
        const cv = eventToCanvas(e);
        const world = canvasToWorld(cv.x, cv.y, state.pan, state.zoom);
        const eng = engineRef.current;
        if (eng) {
          const nodes = rootNodes().map(toEngineNode);
          const idx = await eng.hitTest({ nodes }, [world.x, world.y]);
          const hitId = idx !== null ? nodes[idx]?.id : null;
          if (hitId && hitId !== (state.selection[0] ?? null)) {
            const docNode = state.document.nodes[hitId];
            setHoveredNode(docNode ?? null);
          } else {
            setHoveredNode(null);
          }
        }
      }
      return;
    }
    if (g.pointerId !== e.pointerId) return;

    const cv = eventToCanvas(e);
    g.currentCanvas = cv;

    if (g.kind === 'panning') {
      const dx = cv.x - g.startCanvas.x;
      const dy = cv.y - g.startCanvas.y;
      setPan({ x: g.startPan.x + dx, y: g.startPan.y + dy });
      return;
    }

    if (g.kind === 'drawing') {
      const current = canvasToWorld(cv.x, cv.y, state.pan, state.zoom);
      const x = Math.min(g.startWorld.x, current.x);
      const y = Math.min(g.startWorld.y, current.y);
      const w = Math.abs(current.x - g.startWorld.x);
      const h = Math.abs(current.y - g.startWorld.y);
      setDraft({ x, y, w, h });
      return;
    }

    if (g.kind === 'marquee') {
      const current = canvasToWorld(cv.x, cv.y, state.pan, state.zoom);
      const x = Math.min(g.startWorld.x, current.x);
      const y = Math.min(g.startWorld.y, current.y);
      const w = Math.abs(current.x - g.startWorld.x);
      const h = Math.abs(current.y - g.startWorld.y);
      setDraft({ x, y, w, h });
      return;
    }

    if (g.kind === 'moving' && g.movingId && g.movingOrigin) {
      const dx = (cv.x - g.startCanvas.x) / state.zoom;
      const dy = (cv.y - g.startCanvas.y) / state.zoom;
      setNodePosition(g.movingId, g.movingOrigin.x + dx, g.movingOrigin.y + dy);
    }
  }

  function rectsIntersect(
    x1: number,
    y1: number,
    w1: number,
    h1: number,
    x2: number,
    y2: number,
    w2: number,
    h2: number,
  ): boolean {
    return x1 < x2 + w2 && x1 + w1 > x2 && y1 < y2 + h2 && y1 + h1 > y2;
  }

  function nodeWorldBounds(n: DocNode): { x: number; y: number; w: number; h: number } | null {
    const tx = n.transform[4] ?? 0;
    const ty = n.transform[5] ?? 0;
    if (n.kind === 'shape') {
      const s = n.shape;
      if (s.kind === 'rect') return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      if (s.kind === 'ellipse')
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      if (s.kind === 'circle')
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      if (s.kind === 'line') {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 4,
          h: Math.abs(s.to[1] - s.from[1]) || 4,
        };
      }
      if (s.kind === 'polygon')
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      if (s.kind === 'star')
        return {
          x: tx + s.cx - s.outerRadius,
          y: ty + s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
    }
    if (n.kind === 'text')
      return { x: tx, y: ty, w: (n.fontSize ?? 16) * 3, h: (n.fontSize ?? 16) * 1.4 };
    if (n.kind === 'frame') return { x: tx, y: ty, w: 200, h: 160 };
    return null;
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = gesture.current;
    if (g.kind === 'idle') return;
    e.currentTarget.releasePointerCapture(e.pointerId);

    if (g.kind === 'drawing') {
      const current = canvasToWorld(g.currentCanvas.x, g.currentCanvas.y, state.pan, state.zoom);
      const dx = Math.abs(current.x - g.startWorld.x);
      const dy = Math.abs(current.y - g.startWorld.y);
      const MIN_DRAG = 3 / state.zoom; // 3 CSS-px threshold

      setDraft(null);

      if (dx > MIN_DRAG || dy > MIN_DRAG) {
        const x = Math.min(g.startWorld.x, current.x);
        const y = Math.min(g.startWorld.y, current.y);
        createShapeAt({ x, y }, { w: Math.max(dx, 4), h: Math.max(dy, 4) });
      } else {
        createShapeAt(g.startWorld);
      }
    }

    if (g.kind === 'marquee') {
      const current = canvasToWorld(g.currentCanvas.x, g.currentCanvas.y, state.pan, state.zoom);
      const mx = Math.min(g.startWorld.x, current.x);
      const my = Math.min(g.startWorld.y, current.y);
      const mw = Math.abs(current.x - g.startWorld.x);
      const mh = Math.abs(current.y - g.startWorld.y);
      setDraft(null);

      const nodes = rootNodes();
      const selectedIds: string[] = [];
      for (const n of nodes) {
        const bbox = nodeWorldBounds(n);
        if (bbox && rectsIntersect(mx, my, mw, mh, bbox.x, bbox.y, bbox.w, bbox.h)) {
          selectedIds.push(n.id);
        }
      }

      const first = selectedIds[0];
      if (first) {
        setSelection(first);
        for (let i = 1; i < selectedIds.length; i++) {
          const sid = selectedIds[i];
          if (sid) toggleSelection(sid, true);
        }
        announce(`Selected ${selectedIds.length} layers`);
      }
      return;
    }

    gesture.current = {
      ...gesture.current,
      kind: 'idle',
      pointerId: -1,
      movingId: null,
      movingOrigin: null,
    };
  }

  // ─── Wheel (zoom) ─────────────────────────────────────────────────────────

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(Math.max(0.1, Math.min(10, state.zoom * factor)));
  }

  // ─── Keyboard ─────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const nodes = rootNodes();
      const selArr = state.selection;
      const firstSel = selArr[0] ?? null;
      const idx = firstSel ? nodes.findIndex((n) => n.id === firstSel) : -1;

      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (!firstSel || idx < 0) return;
        const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const node = nodes[idx];
        if (!node) return;
        const t = node.transform;
        setNodePosition(firstSel, t[4] + dx, t[5] + dy);
        announce(e.shiftKey ? 'Moved 10px' : e.altKey ? 'Moved 0.5px' : 'Moved 1px');
        return;
      }

      if (e.key === 'Tab') {
        if (nodes.length === 0) return;
        e.preventDefault();
        if (e.shiftKey) {
          const prev = nodes[(idx <= 0 ? nodes.length : idx) - 1];
          if (prev) {
            setSelection(prev.id);
            announce(`Selected ${prev.name}`);
          }
        } else {
          const next = nodes[(idx + 1) % nodes.length];
          if (next) {
            setSelection(next.id);
            announce(`Selected ${next.name}`);
          }
        }
        return;
      }

      if (e.key === 'Escape') {
        setSelection(null);
        announce('Selection cleared');
        return;
      }

      if ((e.key === 'Enter' || e.key === 'F2') && firstSel) {
        const name = prompt('Rename layer', nodes[idx]?.name ?? '');
        if (name) renameSelected(name);
      }
    },
    [state.selection, rootNodes, setNodePosition, setSelection, announce, renameSelected],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const isDrawTool = [
    'rect',
    'ellipse',
    'polygon',
    'star',
    'line',
    'frame',
    'text',
    'pen',
  ].includes(state.tool);

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
          cursor: isDrawTool
            ? 'crosshair'
            : state.tool === 'hand'
              ? 'grab'
              : state.tool === 'inspect'
                ? 'crosshair'
                : 'default',
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      />
      {state.tool !== 'inspect' && <SelectionOverlay />}
      {state.tool === 'inspect' && (
        <MeasureOverlay
          zoom={state.zoom}
          pan={state.pan}
          selectedNodes={rootNodes().filter((n) => state.selection.includes(n.id))}
          doc={state.document}
          hoveredNode={hoveredNode}
        />
      )}
      <div className="editor-canvas__announcer" ref={announcer} role="status" aria-live="polite" />
    </section>
  );
}
