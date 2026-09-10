/**
 * Shared node measurement, flow-participation, and constraint-clamping
 * helpers used by both the flex and grid layout engines (and by the
 * intrinsic hug-sizing pass in reflow.ts).
 *
 * Kept in one place so flex/grid/hug measurement never diverge — a node's
 * "natural" size must mean the same thing everywhere it's measured.
 */
import type { LayoutSizing, SceneNode, Stroke } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, measureText, measureWrappedText } from '@varve/shared';

export interface Size {
  w: number;
  h: number;
}

/** A node's own natural (unresolved) size — does not recurse into a frame's children. */
export function measureNodeSize(n: SceneNode, includeBorders = false): Size {
  const base = measureNodeSizeRaw(n);
  if (!includeBorders) return base;
  const [top, right, bottom, left] = strokeOutsets(n);
  return { w: base.w + left + right, h: base.h + top + bottom };
}

function measureNodeSizeRaw(n: SceneNode): Size {
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
  if (n.kind === 'frame') return { w: n.w ?? 0, h: n.h ?? 0 };
  if (n.kind === 'text') {
    const fs = n.fontSize ?? 16;
    const opts = {
      fontSize: fs,
      fontFamily: n.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: n.fontWeight ?? 400,
      fontStyle: n.fontStyle ?? 'normal',
      letterSpacing: n.letterSpacing ?? 0,
      lineHeight: n.lineHeight ?? 1.4,
      textCase: n.textCase,
    };
    const content = n.text ?? '';
    if (!n.w || n.textResizing === 'autoWidth') {
      const measured = measureText(content, opts);
      return { w: Math.max(measured.width, 20), h: measured.height };
    }
    const wrapped = measureWrappedText(content, n.w, opts);
    const h = n.textResizing === 'fixed' && n.h != null ? n.h : wrapped.height;
    return { w: n.w, h };
  }
  return { w: 0, h: 0 };
}

/** Conservative visible-stroke footprint for border-aware layout. Effects
 * such as shadows and blur are deliberately excluded. */
function strokeOutsets(n: SceneNode): [number, number, number, number] {
  const strokes =
    ('strokes' in n ? n.strokes : undefined)?.filter(
      (stroke) => stroke.visible !== false && stroke.weight > 0,
    ) ?? [];
  if (strokes.length === 0) return [0, 0, 0, 0];
  const outset = (stroke: Stroke, weight = stroke.weight): number =>
    stroke.align === 'outside' ? weight : stroke.align === 'center' ? weight / 2 : 0;
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;
  for (const stroke of strokes) {
    const sides = stroke.perSideWeights;
    if (sides) {
      top = Math.max(top, outset(stroke, sides[0]));
      right = Math.max(right, outset(stroke, sides[1]));
      bottom = Math.max(bottom, outset(stroke, sides[2]));
      left = Math.max(left, outset(stroke, sides[3]));
    } else {
      const edge = outset(stroke);
      top = Math.max(top, edge);
      right = Math.max(right, edge);
      bottom = Math.max(bottom, edge);
      left = Math.max(left, edge);
    }
  }
  return [top, right, bottom, left];
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
