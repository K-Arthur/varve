/**
 * Canvas area — the central drawing surface (Strata plan §5.4).
 */

import type { SceneNode as EngineNode } from '@strata/engine';
import { createEngine, type ReplayTarget, replayIr } from '@strata/engine';
import type { FrameNode, ShapeNode, TextNode } from '@strata/scene';
import { useEffect, useMemo, useRef } from 'react';
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
  const { state, rootNodes, createShapeAt, setSelection } = useEditor();
  const engine = useMemo(() => createEngine('stub'), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    (async () => {
      const nodes = rootNodes().map(toEngineNode);
      const ir = await (await engine).buildIr({ nodes });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.translate(state.pan.x, state.pan.y);
      ctx.scale(state.zoom, state.zoom);
      replayIr(ctx as unknown as ReplayTarget, ir);
      ctx.restore();
    })();
  }, [state.document, state.zoom, state.pan, engine, rootNodes]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (['select', 'hand', 'zoomIn'].includes(state.tool)) {
      // Hit-test the canvas to find a node under the pointer.
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - state.pan.x) / state.zoom;
      const y = (e.clientY - rect.top - state.pan.y) / state.zoom;
      const nodes = rootNodes().map(toEngineNode);
      // For select: set the first overlapping node as selection.
      // For now, find by iterating (full hit-test from geometry in later pass).
      const hit = nodes.findLast((n) => {
        // crude: rect bounds check (full shape hit-test is in geometry.ts)
        if (n.shape.kind !== 'rect') return false;
        return (
          x >= n.shape.x &&
          x <= n.shape.x + n.shape.w &&
          y >= n.shape.y &&
          y <= n.shape.y + n.shape.h
        );
      });
      if (hit) {
        setSelection(hit.id);
      } else {
        setSelection(null);
      }
    } else {
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - state.pan.x) / state.zoom;
      const y = (e.clientY - rect.top - state.pan.y) / state.zoom;
      createShapeAt({ x, y });
    }
  }

  return (
    <section className="editor-canvas" tabIndex={-1} aria-label="Canvas">
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
        onClick={handleClick}
      />
      <div className="editor-canvas__announcer" ref={announcer} role="status" aria-live="polite" />
    </section>
  );
}
