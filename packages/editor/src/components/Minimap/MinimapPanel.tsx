import type { Shape } from '@strata/engine';
import type { SceneNode } from '@strata/scene';
import { imageShapeH, imageShapeW, isImageShape } from '@strata/scene';
import { transformRect } from '@strata/shared';
import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '../../context';
import { nodeWorldTransform } from '../../scene/world';
import './minimap.css';

const MINIMAP_WIDTH = 160;
const MINIMAP_MAX_HEIGHT = 120;
const PADDING = 12;

function getNodeLocalBounds(node: SceneNode): { x: number; y: number; w: number; h: number } {
  switch (node.kind) {
    case 'shape':
      if (isImageShape(node)) {
        return { x: 0, y: 0, w: imageShapeW(node), h: imageShapeH(node) };
      }
      return getShapeBounds(node.shape);
    case 'frame':
      return { x: 0, y: 0, w: node.w, h: node.h };
    case 'group':
      return { x: -50, y: -50, w: 100, h: 100 };
    case 'text':
      return {
        x: 0,
        y: 0,
        w: Math.max((node.text?.length || 1) * (node.fontSize || 16) * 0.6, 20),
        h: (node.fontSize || 16) * 1.4,
      };
    case 'adjustment':
      return { x: 0, y: 0, w: 100, h: 100 };
    default:
      return { x: 0, y: 0, w: 100, h: 100 };
  }
}

function getShapeBounds(shape: Shape): { x: number; y: number; w: number; h: number } {
  switch (shape.kind) {
    case 'rect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'ellipse':
      return {
        x: shape.cx - shape.rx,
        y: shape.cy - shape.ry,
        w: shape.rx * 2,
        h: shape.ry * 2,
      };
    case 'circle':
      return {
        x: shape.cx - shape.r,
        y: shape.cy - shape.r,
        w: shape.r * 2,
        h: shape.r * 2,
      };
    case 'line':
    case 'arrow':
      return {
        x: Math.min(shape.from[0], shape.to[0]),
        y: Math.min(shape.from[1], shape.to[1]),
        w: Math.max(Math.abs(shape.to[0] - shape.from[0]), 4),
        h: Math.max(Math.abs(shape.to[1] - shape.from[1]), 4),
      };
    case 'polygon':
      return {
        x: shape.cx - shape.radius,
        y: shape.cy - shape.radius,
        w: shape.radius * 2,
        h: shape.radius * 2,
      };
    case 'star':
      return {
        x: shape.cx - shape.outerRadius,
        y: shape.cy - shape.outerRadius,
        w: shape.outerRadius * 2,
        h: shape.outerRadius * 2,
      };
    case 'path': {
      if (shape.points.length === 0) return { x: 0, y: 0, w: 100, h: 100 };
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX,
        y: minY,
        w: Math.max(Math.max(...xs) - minX, 4),
        h: Math.max(Math.max(...ys) - minY, 4),
      };
    }
    default:
      return { x: 0, y: 0, w: 100, h: 100 };
  }
}

export function MinimapPanel() {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDragging = useRef(false);
  const { selectedNodes } = useEditor();
  const sel = selectedNodes();

  const resolveCssVar = useCallback((name: string, fallback: string): string => {
    if (typeof document === 'undefined') return fallback;
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return val || fallback;
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { document: doc, zoom, pan } = editor.state;
    const rootNodes = doc.rootChildren.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const nodeBounds: { x: number; y: number; w: number; h: number; id: string }[] = [];

    for (const node of rootNodes) {
      const local = getNodeLocalBounds(node);
      const worldTf = nodeWorldTransform(doc, node.id);
      const worldBounds = transformRect(worldTf, local);
      nodeBounds.push({ ...worldBounds, id: node.id });
      minX = Math.min(minX, worldBounds.x);
      minY = Math.min(minY, worldBounds.y);
      maxX = Math.max(maxX, worldBounds.x + worldBounds.w);
      maxY = Math.max(maxY, worldBounds.y + worldBounds.h);
    }

    if (!Number.isFinite(minX)) {
      minX = -200;
      minY = -200;
      maxX = 200;
      maxY = 200;
    }

    const contentW = maxX - minX + PADDING * 2;
    const contentH = maxY - minY + PADDING * 2;
    const aspect = contentW / contentH;

    let mmW = MINIMAP_WIDTH;
    let mmH = mmW / aspect;
    if (mmH > MINIMAP_MAX_HEIGHT) {
      mmH = MINIMAP_MAX_HEIGHT;
      mmW = mmH * aspect;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = mmW * dpr;
    canvas.height = mmH * dpr;
    canvas.style.width = `${mmW}px`;
    canvas.style.height = `${mmH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = Math.min(mmW / contentW, mmH / contentH) * 0.9;
    const offsetX = (mmW - contentW * scale) / 2;
    const offsetY = (mmH - contentH * scale) / 2;

    ctx.clearRect(0, 0, mmW, mmH);

    const bgColor = resolveCssVar('--color-surface-raised', '#1e1e1e');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, mmW, mmH);

    const nodeColor = resolveCssVar('--color-border-subtle', '#444');
    ctx.fillStyle = nodeColor;
    for (const b of nodeBounds) {
      const x = offsetX + (b.x - minX + PADDING) * scale;
      const y = offsetY + (b.y - minY + PADDING) * scale;
      const w = Math.max(b.w * scale, 1);
      const h = Math.max(b.h * scale, 1);
      ctx.fillRect(x, y, w, h);
    }

    // Draw selection highlight
    if (sel.length > 0) {
      const selectedIds = new Set(sel.map((n) => n.id));
      const selectionColor = resolveCssVar('--color-interactive-default', '#39d0c6');
      ctx.strokeStyle = selectionColor;
      ctx.lineWidth = 2;
      for (const b of nodeBounds) {
        if (selectedIds.has(b.id)) {
          const x = offsetX + (b.x - minX + PADDING) * scale;
          const y = offsetY + (b.y - minY + PADDING) * scale;
          const w = Math.max(b.w * scale, 1);
          const h = Math.max(b.h * scale, 1);
          ctx.strokeRect(x, y, w, h);
        }
      }
    }

    const vpWorldLeft = -pan.x / zoom;
    const vpWorldTop = -pan.y / zoom;

    const canvasEl = document.querySelector('.editor-canvas canvas');
    const vpW = canvasEl ? canvasEl.clientWidth / zoom : 800 / zoom;
    const vpH = canvasEl ? canvasEl.clientHeight / zoom : 600 / zoom;

    const vx = offsetX + (vpWorldLeft - minX + PADDING) * scale;
    const vy = offsetY + (vpWorldTop - minY + PADDING) * scale;
    const vw = vpW * scale;
    const vh = vpH * scale;

    ctx.fillStyle = 'oklch(0.5 0.2 220 / 0.15)';
    ctx.strokeStyle = 'oklch(0.5 0.2 220 / 0.4)';
    ctx.lineWidth = 1;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.strokeRect(vx, vy, vw, vh);
  }, [editor.state.document, editor.state.zoom, editor.state.pan, resolveCssVar, sel]);

  useEffect(() => {
    draw();
  }, [draw]);

  const getViewportSize = useCallback(() => {
    const canvasEl = document.querySelector('.editor-canvas canvas');
    return {
      w: canvasEl ? canvasEl.clientWidth : 800,
      h: canvasEl ? canvasEl.clientHeight : 600,
    };
  }, []);

  const minimapToWorld = useCallback(
    (mmX: number, mmY: number) => {
      const { document: doc } = editor.state;
      const rootNodes = doc.rootChildren.map((id) => doc.nodes[id]).filter(Boolean) as SceneNode[];

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const node of rootNodes) {
        const local = getNodeLocalBounds(node);
        const worldTf = nodeWorldTransform(doc, node.id);
        const worldBounds = transformRect(worldTf, local);
        minX = Math.min(minX, worldBounds.x);
        minY = Math.min(minY, worldBounds.y);
        maxX = Math.max(maxX, worldBounds.x + worldBounds.w);
        maxY = Math.max(maxY, worldBounds.y + worldBounds.h);
      }

      if (!Number.isFinite(minX)) {
        minX = -200;
        minY = -200;
        maxX = 200;
        maxY = 200;
      }

      const contentW = maxX - minX + PADDING * 2;
      const contentH = maxY - minY + PADDING * 2;
      const aspect = contentW / contentH;

      let mmW = MINIMAP_WIDTH;
      let mmH = mmW / aspect;
      if (mmH > MINIMAP_MAX_HEIGHT) {
        mmH = MINIMAP_MAX_HEIGHT;
        mmW = mmH * aspect;
      }

      const scale = Math.min(mmW / contentW, mmH / contentH) * 0.9;
      const offsetX = (mmW - contentW * scale) / 2;
      const offsetY = (mmH - contentH * scale) / 2;

      const worldX = (mmX - offsetX) / scale + minX - PADDING;
      const worldY = (mmY - offsetY) / scale + minY - PADDING;

      return { x: worldX, y: worldY };
    },
    [editor.state],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isDragging.current = true;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mmX = e.clientX - rect.left;
      const mmY = e.clientY - rect.top;
      const world = minimapToWorld(mmX, mmY);
      const vp = getViewportSize();
      editor.setPan({
        x: vp.w / 2 - world.x * editor.state.zoom,
        y: vp.h / 2 - world.y * editor.state.zoom,
      });
      canvas.setPointerCapture(e.pointerId);
    },
    [editor, minimapToWorld, getViewportSize],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDragging.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mmX = e.clientX - rect.left;
      const mmY = e.clientY - rect.top;
      const world = minimapToWorld(mmX, mmY);
      const vp = getViewportSize();
      editor.setPan({
        x: vp.w / 2 - world.x * editor.state.zoom,
        y: vp.h / 2 - world.y * editor.state.zoom,
      });
    },
    [editor, minimapToWorld, getViewportSize],
  );

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div className="minimap-panel">
      <canvas
        ref={canvasRef}
        className="minimap-panel__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      />
    </div>
  );
}
