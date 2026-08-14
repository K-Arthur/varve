/**
 * Type-aware node geometry resizing — used by both selection-overlay
 * transform baking and inspector W/H field edits.
 *
 * Each node kind has its own geometry model:
 *   shape → shape.{w,h} (or rx/ry, radius, from/to, points…)
 *   frame → {w,h}
 *   text  → {w,h}
 *   group → no-op (bounds derived from children)
 *
 * Images: by default, resizing scales the image fill with the bounds
 * (like Figma).  To clip/reveal without distortion, use the Crop tool
 * (shortcut: C) which lets you resize bounds in `crop` mode.
 *
 * Research basis: Figma multi-type resize, Sketch Resizing.
 */

import type { PathPoint } from '@varve/engine';
import type { SceneNode, ShapeNode } from '@varve/scene';

export function resizeNodeGeometry(n: SceneNode, w: number, h: number): SceneNode {
  if (n.kind === 'frame') return { ...n, w, h };
  if (n.kind === 'text') return { ...n, w, h };
  if (n.kind !== 'shape') return n;
  const s = (n as ShapeNode).shape;
  switch (s.kind) {
    case 'rect':
      return { ...n, shape: { ...s, w, h } } as SceneNode;
    case 'ellipse':
      return {
        ...n,
        shape: { ...s, rx: w / 2, ry: h / 2, cx: w / 2, cy: h / 2 },
      } as SceneNode;
    case 'circle':
      return {
        ...n,
        shape: { ...s, r: Math.max(w, h) / 2, cx: w / 2, cy: h / 2 },
      } as SceneNode;
    case 'line': {
      const oldW = Math.abs(s.to[0] - s.from[0]) || 1;
      const oldH = Math.abs(s.to[1] - s.from[1]) || 1;
      const sx = w / oldW;
      const sy = h / oldH;
      const cx = (s.from[0] + s.to[0]) / 2;
      const cy = (s.from[1] + s.to[1]) / 2;
      return {
        ...n,
        shape: {
          ...s,
          from: [cx + (s.from[0] - cx) * sx, cy + (s.from[1] - cy) * sy] as [number, number],
          to: [cx + (s.to[0] - cx) * sx, cy + (s.to[1] - cy) * sy] as [number, number],
        },
      } as SceneNode;
    }
    case 'arrow': {
      const oldW2 = Math.abs(s.to[0] - s.from[0]) || 1;
      const oldH2 = Math.abs(s.to[1] - s.from[1]) || 1;
      const sx2 = w / oldW2;
      const sy2 = h / oldH2;
      const cx2 = (s.from[0] + s.to[0]) / 2;
      const cy2 = (s.from[1] + s.to[1]) / 2;
      return {
        ...n,
        shape: {
          ...s,
          from: [cx2 + (s.from[0] - cx2) * sx2, cy2 + (s.from[1] - cy2) * sy2] as [number, number],
          to: [cx2 + (s.to[0] - cx2) * sx2, cy2 + (s.to[1] - cy2) * sy2] as [number, number],
        },
      } as SceneNode;
    }
    case 'polygon':
      return { ...n, shape: { ...s, radius: Math.max(1, w / 2) } } as SceneNode;
    case 'star': {
      const oldOR = s.outerRadius || 1;
      const newOR = Math.max(1, w / 2);
      const ratio = newOR / oldOR;
      return {
        ...n,
        shape: {
          ...s,
          outerRadius: newOR,
          innerRadius: Math.max(1, s.innerRadius * ratio),
        },
      } as SceneNode;
    }
    case 'path': {
      const points = s.points;
      if (points.length === 0) return n;
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      const pbw = maxX - minX || 1;
      const pbh = maxY - minY || 1;
      const sx3 = w / pbw;
      const sy3 = h / pbh;
      return {
        ...n,
        shape: {
          ...s,
          points: points.map((p: PathPoint) => ({
            x: (p.x - minX) * sx3 + minX,
            y: (p.y - minY) * sy3 + minY,
            handleIn: p.handleIn
              ? ([p.handleIn[0] * sx3, p.handleIn[1] * sy3] as [number, number])
              : null,
            handleOut: p.handleOut
              ? ([p.handleOut[0] * sx3, p.handleOut[1] * sy3] as [number, number])
              : null,
          })),
        },
      } as SceneNode;
    }
    default:
      return n;
  }
}
