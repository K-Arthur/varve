/**
 * Shared tracing utilities — canonical shape→path logic for canvas rendering.
 *
 * Consolidates duplicate traceShapeOutline implementations that had drifted
 * between CanvasArea.tsx and replay.ts. Both callers now use this module.
 */
import type { PathPoint, SceneNode } from './types';

type PathContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function tracePathRing(ctx: PathContext, points: PathPoint[]): void {
  const first = points[0];
  if (!first) return;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const point = points[i];
    const previous = points[i - 1];
    if (!point || !previous) continue;
    if (previous.handleOut || point.handleIn) {
      const cp1x = previous.handleOut ? previous.x + previous.handleOut[0] : previous.x;
      const cp1y = previous.handleOut ? previous.y + previous.handleOut[1] : previous.y;
      const cp2x = point.handleIn ? point.x + point.handleIn[0] : point.x;
      const cp2y = point.handleIn ? point.y + point.handleIn[1] : point.y;
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.closePath();
}

/**
 * Trace the outline of a scene node's shape on a CanvasRenderingContext2D.
 * Traces in the node's local space. The caller is responsible for applying
 * the node's world transform before calling.
 */
export function traceSceneNodeOutline(ctx: PathContext, n: SceneNode): void {
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
          if (s.closed) tracePathRing(ctx, s.points);
          else {
            const first = s.points[0];
            if (!first) break;
            ctx.moveTo(first.x, first.y);
            for (let i = 1; i < s.points.length; i++) {
              const point = s.points[i];
              if (point) ctx.lineTo(point.x, point.y);
            }
          }
          for (const hole of s.holes ?? []) tracePathRing(ctx, hole);
        }
        break;
    }
  } else if (n.kind === 'frame') {
    const w = 'w' in n ? (n.w ?? 100) : 100;
    const h = 'h' in n ? (n.h ?? 100) : 100;
    ctx.rect(0, 0, w, h);
  }
}
