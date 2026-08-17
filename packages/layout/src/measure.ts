/**
 * Shared node measurement, flow-participation, and constraint-clamping
 * helpers used by both the flex and grid layout engines (and by the
 * intrinsic hug-sizing pass in reflow.ts).
 *
 * Kept in one place so flex/grid/hug measurement never diverge — a node's
 * "natural" size must mean the same thing everywhere it's measured.
 */
import type { LayoutSizing, SceneNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, measureText } from '@varve/shared';

export interface Size {
  w: number;
  h: number;
}

/** A node's own natural (unresolved) size — does not recurse into a frame's children. */
export function measureNodeSize(n: SceneNode): Size {
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { w: s.w, h: s.h };
    if (s.kind === 'ellipse') return { w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle') return { w: s.r * 2, h: s.r * 2 };
    if (s.kind === 'path') {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      if (xs.length === 0) return { w: 0, h: 0 };
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
  }
  if (n.kind === 'frame') return { w: n.w, h: n.h };
  if (n.kind === 'text') {
    const fs = n.fontSize ?? 16;
    const measured = measureText(n.text ?? '', {
      fontSize: fs,
      fontFamily: n.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: n.fontWeight ?? 400,
      fontStyle: n.fontStyle ?? 'normal',
      letterSpacing: n.letterSpacing ?? 0,
      lineHeight: n.lineHeight ?? 1.4,
    });
    return { w: Math.max(measured.width, 20), h: measured.height };
  }
  return { w: 0, h: 0 };
}

/** Whether a child participates in its parent's flow layout (not hidden, not absolute). */
export function isFlowParticipant(n: SceneNode): boolean {
  return n.visible !== false && n.layoutPosition !== 'absolute';
}

/** Effective sizing mode for one axis, falling back to the legacy unified field. */
export function axisSizing(n: SceneNode, axis: 'width' | 'height'): LayoutSizing {
  const perAxis = axis === 'width' ? n.layoutSizingWidth : n.layoutSizingHeight;
  return perAxis ?? n.layoutSizing ?? 'fixed';
}

/** Clamp a value to a node's min/max for one axis. Unset bounds are unbounded, not 0/Infinity constants. */
export function clampAxis(value: number, n: SceneNode, axis: 'width' | 'height'): number {
  const min = axis === 'width' ? n.minWidth : n.minHeight;
  const max = axis === 'width' ? n.maxWidth : n.maxHeight;
  let v = value;
  if (typeof min === 'number') v = Math.max(v, min);
  if (typeof max === 'number') v = Math.min(v, max);
  return v;
}
