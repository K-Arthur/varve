/**
 * LiquifyOverlay — deformation grid, freeze coverage, and brush influence.
 *
 * Reads the target's persisted field from the document and live session state
 * from the tool's external store; draws on a device-pixel canvas so a 32×32
 * grid and a 512² freeze mask stay cheap. Pointer-events are disabled — the
 * tool owns the gesture, so the overlay can never eat a pointer sample.
 */

import { sampleLiquifyDisplacement, validateLiquifyField } from '@varve/engine';
import {
  type Document,
  decodeNodeFreezeMask,
  resolveFrequencySeparation,
  type SceneNode,
} from '@varve/scene';
import { useEffect, useRef } from 'react';
import { useEditor } from '../../context';
import {
  getLiquifyOverlaySnapshot,
  subscribeLiquifyOverlay,
} from '../../tools/liquifyOverlayState';
import './liquifyOverlay.css';

type Affine = readonly [number, number, number, number, number, number];

function applyAffine(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function resolveTargetGeometry(
  doc: Document,
  targetId: string,
): { node: SceneNode; transformNodeId: string; width: number; height: number } | null {
  const node = doc.nodes[targetId];
  if (!node) return null;
  if (node.kind === 'rasterLayer') {
    return { node, transformNodeId: node.id, width: node.width, height: node.height };
  }
  if (node.kind === 'group') {
    const separation = resolveFrequencySeparation(doc, targetId);
    if (!separation) return null;
    const low = doc.nodes[separation.state.lowNodeId];
    if (low?.kind !== 'rasterLayer') return null;
    return { node, transformNodeId: low.id, width: low.width, height: low.height };
  }
  return null;
}

export function LiquifyOverlay() {
  const editor = useEditor();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const storeRef = useRef(getLiquifyOverlaySnapshot());
  const freezeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeRevisionRef = useRef(-1);
  const drawRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cssWidth = parent.clientWidth;
    const cssHeight = parent.clientHeight;
    if (cssWidth <= 0 || cssHeight <= 0) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    if (
      canvas.width !== Math.round(cssWidth * dpr) ||
      canvas.height !== Math.round(cssHeight * dpr)
    ) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const state = storeRef.current;
    if (!state.targetId) return;
    const doc = editor.state.document;
    const geometry = resolveTargetGeometry(doc, state.targetId);
    if (!geometry) return;
    const nodeTransform = editor.getWorldTransform(geometry.transformNodeId) as Affine | undefined;
    if (!nodeTransform) return;

    const layerToCanvas = (x: number, y: number) => {
      const world = applyAffine(nodeTransform, x, y);
      return editor.worldToCanvas(world.x, world.y);
    };
    const p0 = layerToCanvas(0, 0);
    const p1 = layerToCanvas(geometry.width, 0);
    const p2 = layerToCanvas(0, geometry.height);
    const a = (p1.x - p0.x) / Math.max(1, geometry.width);
    const b = (p1.y - p0.y) / Math.max(1, geometry.width);
    const c = (p2.x - p0.x) / Math.max(1, geometry.height);
    const d = (p2.y - p0.y) / Math.max(1, geometry.height);
    const scale = Math.max(1e-6, (Math.hypot(a, b) + Math.hypot(c, d)) / 2);

    // Freeze coverage first (under the grid).
    if (state.showFreeze) {
      const node = geometry.node;
      const sessionMask = state.sessionFreeze;
      const mask = sessionMask ?? (node.kind === 'rasterLayer' ? decodeNodeFreezeMask(node) : null);
      if (mask && mask.width > 0 && mask.height > 0) {
        const revisionKey = sessionMask ? state.sessionFreezeRevision : -1;
        if (
          freezeRevisionRef.current !== revisionKey ||
          !freezeCanvasRef.current ||
          freezeCanvasRef.current.width !== mask.width ||
          freezeCanvasRef.current.height !== mask.height
        ) {
          const freezeCanvas = document.createElement('canvas');
          freezeCanvas.width = mask.width;
          freezeCanvas.height = mask.height;
          const freezeCtx = freezeCanvas.getContext('2d');
          if (freezeCtx) {
            const image = freezeCtx.createImageData(mask.width, mask.height);
            for (let i = 0; i < mask.data.length; i++) {
              image.data[i * 4] = 90;
              image.data[i * 4 + 1] = 200;
              image.data[i * 4 + 2] = 255;
              image.data[i * 4 + 3] = Math.round(mask.data[i]! * 0.45);
            }
            freezeCtx.putImageData(image, 0, 0);
          }
          freezeCanvasRef.current = freezeCanvas;
          freezeRevisionRef.current = revisionKey;
        }
        const freezeCanvas = freezeCanvasRef.current;
        if (freezeCanvas) {
          ctx.save();
          ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * p0.x, dpr * p0.y);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(freezeCanvas, 0, 0, geometry.width, geometry.height);
          ctx.restore();
        }
      }
    }

    // Deformation grid: control points displaced by the field.
    if (state.showGrid) {
      const field = validateLiquifyField((geometry.node as { liquify?: unknown }).liquify);
      if (field) {
        const offset: [number, number] = [0, 0];
        ctx.save();
        ctx.strokeStyle = 'rgba(57, 208, 198, 0.55)';
        ctx.lineWidth = 1;
        for (let r = 0; r <= field.rows; r++) {
          ctx.beginPath();
          for (let c = 0; c <= field.columns; c++) {
            const x = (c / field.columns) * field.referenceWidth;
            const y = (r / field.rows) * field.referenceHeight;
            sampleLiquifyDisplacement(field, c / field.columns, r / field.rows, offset);
            const screen = layerToCanvas(x + offset[0], y + offset[1]);
            if (c === 0) ctx.moveTo(screen.x, screen.y);
            else ctx.lineTo(screen.x, screen.y);
          }
          ctx.stroke();
        }
        for (let c = 0; c <= field.columns; c++) {
          ctx.beginPath();
          for (let r = 0; r <= field.rows; r++) {
            const x = (c / field.columns) * field.referenceWidth;
            const y = (r / field.rows) * field.referenceHeight;
            sampleLiquifyDisplacement(field, c / field.columns, r / field.rows, offset);
            const screen = layerToCanvas(x + offset[0], y + offset[1]);
            if (r === 0) ctx.moveTo(screen.x, screen.y);
            else ctx.lineTo(screen.x, screen.y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // Brush influence ring at the live cursor.
    if (state.cursorLayer) {
      const center = layerToCanvas(state.cursorLayer.x, state.cursorLayer.y);
      const outerRadius = Math.max(2, state.radiusLayer * scale);
      const innerRadius = outerRadius * Math.max(0, Math.min(1, state.hardness));
      const freezeActive = state.freezeTool !== 'off';
      ctx.save();
      ctx.setLineDash(freezeActive ? [] : [4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = freezeActive ? '#5ac8ff' : '#39d0c6';
      ctx.beginPath();
      ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
      ctx.stroke();
      if (innerRadius > 1) {
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(center.x, center.y, innerRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        drawRef.current();
      });
    };
    const unsubscribe = subscribeLiquifyOverlay(() => {
      storeRef.current = getLiquifyOverlaySnapshot();
      schedule();
    });
    schedule();
    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={canvasRef} className="liquify-overlay" />;
}
