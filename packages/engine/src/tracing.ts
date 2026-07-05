/**
 * Shared tracing utilities — canonical shape→path logic for canvas rendering.
 *
 * Consolidates duplicate traceShapeOutline implementations that had drifted
 * between CanvasArea.tsx and replay.ts. Both callers now use this module.
 */
import type { SceneNode } from './types';

/**
 * Trace the outline of a scene node's shape on a CanvasRenderingContext2D.
 * Traces in the node's local space. The caller is responsible for applying
 * the node's world transform before calling.
 */
export function traceSceneNodeOutline(ctx: CanvasRenderingContext2D, n: SceneNode): void {
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
