import type { Engine, SceneNode as EngineNode } from '@strata/engine';
import { createEngine, type ReplayTarget, replayIr } from '@strata/engine';
import type { FrameNode, ShapeNode, TextNode } from '@strata/scene';
import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from './context';

type DocNode = ShapeNode | TextNode | FrameNode;

function toEngineNode(n: DocNode): EngineNode {
  const base = { id: n.id, name: n.name, fill: n.fill, transform: n.transform };
  if (n.kind === 'shape') return { ...base, shape: n.shape };
  if (n.kind === 'text')
    return {
      ...base,
      shape: { kind: 'rect', x: 0, y: 0, w: n.fontSize * 3, h: n.fontSize * 1.4 } as const,
    };
  return { ...base, shape: { kind: 'rect', x: 0, y: 0, w: 200, h: 160 } as const };
}

export function CanvasArea() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const announcer = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const {
    state,
    rootNodes,
    createShapeAt,
    setSelection,
    setPan,
    setZoom,
    setNodePosition,
    renameSelected,
  } = useEditor();
  const engineRef = useRef<Engine | null>(null);
  const dragRef = useRef<{ start: { x: number; y: number }; pan: { x: number; y: number } } | null>(
    null,
  );

  useEffect(() => {
    createEngine('stub').then((eng) => {
      engineRef.current = eng;
    });
  }, []);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const eng = engineRef.current;
    if (!eng) return;
    (async () => {
      const nodes = rootNodes().map(toEngineNode);
      const ir = await eng.buildIr({ nodes });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(state.pan.x, state.pan.y);
      ctx.scale(state.zoom, state.zoom);
      replayIr(ctx as unknown as ReplayTarget, ir);
      ctx.restore();
    })();
  }

  useEffect(() => {
    draw();
  }, [state.document, state.zoom, state.pan, rootNodes]);

  const announce = useCallback((msg: string) => {
    if (announcer.current) {
      announcer.current.textContent = msg;
    }
  }, []);

  async function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left - state.pan.x) / state.zoom;
    const y = (e.clientY - rect.top - state.pan.y) / state.zoom;
    const eng = engineRef.current;
    if (['select', 'hand', 'zoomIn'].includes(state.tool)) {
      if (!eng) return;
      const nodes = rootNodes().map(toEngineNode);
      const idx = await eng.hitTest({ nodes }, [x, y]);
      if (idx !== null) {
        const hit = nodes[idx];
        if (hit) {
          setSelection(hit.id);
          announce(`Selected ${hit.name}`);
        }
      } else {
        setSelection(null);
        announce('Selection cleared');
      }
    } else {
      createShapeAt({ x, y });
    }
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const nodes = rootNodes();
      const sel = state.selection;
      const idx = sel ? nodes.findIndex((n) => n.id === sel) : -1;

      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        if (!sel || idx < 0) return;
        const step = e.shiftKey ? 10 : e.altKey ? 0.5 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const node = nodes[idx];
        if (!node) return;
        const t = node.transform;
        setNodePosition(sel, t[4] + dx, t[5] + dy);
        announce(e.shiftKey ? `Moved 10 pixels` : e.altKey ? `Moved 0.5 pixels` : `Moved 1 pixel`);
        return;
      }

      if (e.key === 'Tab') {
        if (nodes.length === 0) return;
        e.preventDefault();
        if (e.shiftKey) {
          const prevIdx = idx <= 0 ? nodes.length - 1 : idx - 1;
          const prev = nodes[prevIdx];
          if (prev) {
            setSelection(prev.id);
            announce(`Selected ${prev.name}`);
          }
        } else {
          const nextIdx = idx >= nodes.length - 1 ? 0 : idx + 1;
          const next = nodes[nextIdx];
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

      if (e.key === 'Enter' && sel) {
        const name = prompt('Rename layer', nodes[idx]?.name ?? '');
        if (name) renameSelected(name);
      }
    },
    [state.selection, rootNodes, setNodePosition, setSelection, announce, renameSelected],
  );

  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, state.zoom * factor));
    setZoom(newZoom);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (state.tool === 'hand' || e.button === 1) {
      e.preventDefault();
      dragRef.current = { start: { x: e.clientX, y: e.clientY }, pan: { ...state.pan } };
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.start.x;
    const dy = e.clientY - dragRef.current.start.y;
    setPan({ x: dragRef.current.pan.x + dx, y: dragRef.current.pan.y + dy });
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  return (
    <section
      className="editor-canvas"
      aria-label="Canvas"
      ref={sectionRef}
      onKeyDown={handleKeyDown}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onClick={handleClick}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <div className="editor-canvas__announcer" ref={announcer} role="status" aria-live="polite" />
    </section>
  );
}
