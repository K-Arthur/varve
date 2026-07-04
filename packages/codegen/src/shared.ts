/**
 * Shared helpers for codegen targets — geometry-to-string, color formatting,
 * and shape vertex computations.
 */

import { managedColorToRgba } from '@strata/shared';
import type { Affine } from '@strata/engine';
import type { NodeId, Document as SceneDocument, SceneNode, ManagedColor } from '@strata/scene';

export function rgba(c: ManagedColor | readonly [number, number, number, number]): string {
  if ('space' in c) {
    const [r, g, b, a] = managedColorToRgba(c);
    return `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
  }
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(3)})`;
}

export function colorToHex(c: ManagedColor | readonly [number, number, number, number]): string {
  if ('space' in c) {
    const [r, g, b] = managedColorToRgba(c);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`;
}

export function affineToSvg(t: Affine): string {
  return `matrix(${t[0]},${t[1]},${t[2]},${t[3]},${t[4]},${t[5]})`;
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function computeNodePos(node: SceneNode): { x: number; y: number; w: number; h: number } {
  const tx = node.transform[4] ?? 0;
  const ty = node.transform[5] ?? 0;
  if (node.kind === 'shape') {
    const s = node.shape;
    switch (s.kind) {
      case 'rect':
        return { x: tx + s.x, y: ty + s.y, w: s.w, h: s.h };
      case 'ellipse':
        return { x: tx + s.cx - s.rx, y: ty + s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'circle':
        return { x: tx + s.cx - s.r, y: ty + s.cy - s.r, w: s.r * 2, h: s.r * 2 };
      case 'line': {
        const minX = Math.min(s.from[0], s.to[0]);
        const minY = Math.min(s.from[1], s.to[1]);
        return {
          x: tx + minX,
          y: ty + minY,
          w: Math.abs(s.to[0] - s.from[0]) || 1,
          h: Math.abs(s.to[1] - s.from[1]) || 1,
        };
      }
      case 'polygon':
        return {
          x: tx + s.cx - s.radius,
          y: ty + s.cy - s.radius,
          w: s.radius * 2,
          h: s.radius * 2,
        };
      case 'star':
        return {
          x: tx + s.cx - s.outerRadius,
          y: ty + s.cy - s.outerRadius,
          w: s.outerRadius * 2,
          h: s.outerRadius * 2,
        };
    }
  }
  if (node.kind === 'text') {
    const fs = node.fontSize ?? 16;
    return { x: tx, y: ty, w: node.text.length * fs * 0.6, h: fs * 1.4 };
  }
  return { x: tx, y: ty, w: 200, h: 160 };
}

export function shapeVerticesToPoints(s: SceneNode): string {
  if (s.kind !== 'shape') return '';
  const shape = s.shape;
  if (shape.kind === 'polygon') {
    const pts: string[] = [];
    for (let i = 0; i < shape.sides; i++) {
      const a = (2 * Math.PI * i) / shape.sides - Math.PI / 2 + shape.rotation;
      pts.push(`${shape.cx + shape.radius * Math.cos(a)},${shape.cy + shape.radius * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  if (shape.kind === 'star') {
    const pts: string[] = [];
    for (let i = 0; i < shape.points * 2; i++) {
      const a = (Math.PI * i) / shape.points - Math.PI / 2 + shape.rotation;
      const r = i % 2 === 0 ? shape.outerRadius : shape.innerRadius;
      pts.push(`${shape.cx + r * Math.cos(a)},${shape.cy + r * Math.sin(a)}`);
    }
    return pts.join(' ');
  }
  return '';
}

export function getChildren(doc: SceneDocument, node: SceneNode): SceneNode[] {
  if (node.kind !== 'frame' && node.kind !== 'group') return [];
  return (node.children ?? []).map((cid: NodeId) => doc.nodes[cid]).filter(Boolean) as SceneNode[];
}
