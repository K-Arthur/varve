/**
 * useThumbnail — renders a simplified 28×28 thumbnail for a scene node.
 *
 * Uses OffscreenCanvas with requestIdleCallback for non-blocking rendering.
 * Falls back to setTimeout if requestIdleCallback is unavailable.
 *
 * Research basis: OffscreenCanvas (WICG), idle-until-urgent pattern.
 */
import type { SceneNode, ShapeNode } from '@strata/scene';
import { useCallback, useEffect, useRef, useState } from 'react';

const THUMB_W = 28;
const THUMB_H = 28;
const PADDING = 2;

function renderNodeToCanvas(node: SceneNode, canvas: OffscreenCanvas | HTMLCanvasElement) {
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;

  ctx.clearRect(0, 0, THUMB_W, THUMB_H);

  const fill = node.fill
    ? `rgba(${node.fill[0]}, ${node.fill[1]}, ${node.fill[2]}, ${(node.fill[3] / 255).toFixed(3)})`
    : 'rgba(200,200,200,1)';

  const area = THUMB_W - PADDING * 2;
  const ox = PADDING;
  const oy = PADDING;

  ctx.fillStyle = fill;

  if (node.kind === 'shape') {
    const s = (node as ShapeNode).shape;
    switch (s.kind) {
      case 'rect':
        ctx.fillRect(ox, oy, area, area);
        break;
      case 'ellipse': {
        const scaleE = area / 2 / Math.min(s.rx, s.ry);
        ctx.beginPath();
        ctx.ellipse(ox + area / 2, oy + area / 2, s.rx * scaleE, s.ry * scaleE, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'circle': {
        const scaleC = area / 2 / s.r;
        ctx.beginPath();
        ctx.arc(ox + area / 2, oy + area / 2, s.r * scaleC, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'line': {
        ctx.strokeStyle = fill;
        ctx.lineWidth = Math.max(1, s.tolerance);
        ctx.beginPath();
        ctx.moveTo(ox, oy + area / 2);
        ctx.lineTo(ox + area, oy + area / 2);
        ctx.stroke();
        break;
      }
      case 'path': {
        const pts = s.points;
        if (pts.length > 0 && pts[0]) {
          ctx.beginPath();
          ctx.moveTo(ox + (pts[0].x % area), oy + (pts[0].y % area));
          for (let i = 1; i < pts.length; i++) {
            const pt = pts[i];
            if (pt) ctx.lineTo(ox + (pt.x % area), oy + (pt.y % area));
          }
          if (s.closed) {
            ctx.closePath();
            ctx.fill();
          } else {
            ctx.stroke();
          }
        }
        break;
      }
      default:
        ctx.fillRect(ox, oy, area, area);
    }
  } else if (node.kind === 'text') {
    ctx.fillStyle = fill;
    ctx.font = '10px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', ox + area / 2 - 4, oy + area / 2);
  } else if ('src' in node && typeof (node as Record<string, unknown>).src === 'string') {
    ctx.fillStyle = 'rgba(200,200,255,0.3)';
    ctx.fillRect(ox, oy, area, area);
  } else {
    ctx.fillRect(ox, oy, area, area);
  }

  return canvas;
}

export function useThumbnail(node: SceneNode): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const nodeRef = useRef(node);
  nodeRef.current = node;

  const render = useCallback(() => {
    let canvas: OffscreenCanvas | HTMLCanvasElement;
    let useOffscreen = false;

    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(THUMB_W, THUMB_H);
      useOffscreen = true;
    } else {
      canvas = document.createElement('canvas');
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
    }

    renderNodeToCanvas(nodeRef.current, canvas);

    if (useOffscreen) {
      (canvas as OffscreenCanvas).convertToBlob().then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => setDataUrl(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } else {
      setDataUrl((canvas as HTMLCanvasElement).toDataURL('image/png'));
    }
  }, []);

  useEffect(() => {
    // Reset thumbnail on node change, render in idle callback
    setDataUrl(null);

    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(render, { timeout: 300 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(render, 50);
    return () => clearTimeout(id);
  }, [node.id, node.kind, render]);

  return dataUrl;
}
