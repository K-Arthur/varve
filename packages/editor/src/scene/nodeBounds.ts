import type { SceneNode } from '@strata/scene';
import type { Rect } from '@strata/shared';
import { measureText } from '@strata/shared';

/**
 * Compute the axis-aligned bounding box of a node's geometry in its own local
 * coordinate space (before applying any transform).
 *
 * Returns `null` for node types whose bounds cannot be determined from the
 * scene model alone (e.g. groups whose bounds depend on children, or
 * arrow/path shapes without a clear box).
 */
export function nodeLocalBounds(node: SceneNode): Rect | null {
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { x: s.x, y: s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: s.cx - s.r, y: s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: minX,
          y: minY,
          w: Math.max(Math.abs(s.to[0] - s.from[0]), 4),
          h: Math.max(Math.abs(s.to[1] - s.from[1]), 4),
        };
      }
      case 'polygon':
        return { x: s.cx - s.radius, y: s.cy - s.radius, w: s.radius * 2, h: s.radius * 2 };
      case 'star':
        return {
          x: s.cx - s.outerRadius,
          y: s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
      case 'arrow': {
        const xs = [s.from[0], s.to[0]];
        const ys = [s.from[1], s.to[1]];
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        return {
          x: minX,
          y: minY,
          w: Math.max(Math.abs(s.to[0] - s.from[0]), 4),
          h: Math.max(Math.abs(s.to[1] - s.from[1]), 4),
        };
      }
      case 'path': {
        if (s.points.length === 0) return null;
        const pts = s.points;
        const allX = pts.flatMap((p) => {
          const vals = [p.x];
          if (p.handleIn) vals.push(p.x + p.handleIn[0]);
          if (p.handleOut) vals.push(p.x + p.handleOut[0]);
          return vals;
        });
        const allY = pts.flatMap((p) => {
          const vals = [p.y];
          if (p.handleIn) vals.push(p.y + p.handleIn[1]);
          if (p.handleOut) vals.push(p.y + p.handleOut[1]);
          return vals;
        });
        const minX = Math.min(...allX);
        const minY = Math.min(...allY);
        return {
          x: minX,
          y: minY,
          w: Math.max(...allX) - minX || 4,
          h: Math.max(...allY) - minY || 4,
        };
      }
    }
  }
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    const measured = measureText(node.text, {
      fontSize: fs,
      fontFamily: node.fontFamily ?? 'sans-serif',
      fontWeight: node.fontWeight ?? 400,
      fontStyle: node.fontStyle ?? 'normal',
      letterSpacing: node.letterSpacing ?? 0,
      lineHeight: node.lineHeight ?? 1.4,
    });
    return { x: 0, y: 0, w: Math.max(measured.width, fs * 3), h: measured.height };
  }
  if (node.kind === 'frame') {
    const w = 'w' in node ? (node.w ?? 100) : 100;
    const h = 'h' in node ? (node.h ?? 100) : 100;
    return { x: 0, y: 0, w, h };
  }
  if (node.kind === 'group') {
    return null;
  }
  // Adjustment nodes have no geometry — their bounds are the parent frame's bounds.
  return null;
}
