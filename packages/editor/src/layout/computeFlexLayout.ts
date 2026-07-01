/**
 * Pure-TS flex/column layout engine for FrameNode auto-layout.
 *
 * Replaces the deferred Taffy WASM / Rust IPC route with a synchronous
 * TypeScript implementation for MVP. Only supports flex row/column with gap
 * and padding; wrapping, grow/shrink, and grid are deferred.
 *
 * Returns the new { id, x, y, w, h } for each child so the caller can apply
 * them as transform updates.
 */
import type { FrameNode, SceneNode } from '@strata/scene';

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function childSize(n: SceneNode): { w: number; h: number } {
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
  if (n.kind === 'text') return { w: 120, h: 32 };
  return { w: 0, h: 0 };
}

export function computeFlexLayout(frame: FrameNode, children: SceneNode[]): LayoutResult[] {
  const style = frame.layoutStyle;
  if (!style || children.length === 0) return [];

  const [pt, , , pl] = style.padding;
  const gap = style.gap;
  const isRow = style.direction === 'row' || style.direction === 'rowReverse';

  const results: LayoutResult[] = [];
  let cursor = isRow ? pl : pt;

  const orderedChildren =
    style.direction === 'rowReverse' || style.direction === 'columnReverse'
      ? [...children].reverse()
      : children;

  for (const child of orderedChildren) {
    const { w, h } = childSize(child);
    if (isRow) {
      results.push({ id: child.id, x: cursor, y: pt, w, h });
      cursor += w + gap;
    } else {
      results.push({ id: child.id, x: pl, y: cursor, w, h });
      cursor += h + gap;
    }
  }

  if (style.direction === 'rowReverse' || style.direction === 'columnReverse') {
    results.reverse();
  }

  return results;
}
