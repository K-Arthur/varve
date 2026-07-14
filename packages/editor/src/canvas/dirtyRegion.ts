/**
 * Conservative document dirty-region analysis.
 *
 * Partial redraw is used only when every changed node is a non-container with
 * known old/new bounds. Structural edits fall back to a full redraw because a
 * parent transform, clip, mask, or isolation change can affect descendants.
 */

import type { Document, NodeId } from '@strata/scene';
import { isContainer, resolveAllStyles } from '@strata/scene';
import type { Rect } from '@strata/shared';
import { nodeVisualWorldBounds } from './visualBounds';

export type DirtyRegion = { kind: 'none' } | { kind: 'full' } | { kind: 'partial'; bounds: Rect };

function unionBounds(left: Rect | null, right: Rect): Rect {
  if (!left) return { ...right };
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.w, right.x + right.w);
  const maxY = Math.max(left.y + left.h, right.y + right.h);
  return { x, y, w: maxX - x, h: maxY - y };
}

export function computeDocumentDirtyRegion(previous: Document, next: Document): DirtyRegion {
  if (previous === next) return { kind: 'none' };
  const ids = new Set<NodeId>([...Object.keys(previous.nodes), ...Object.keys(next.nodes)]);
  let bounds: Rect | null = null;
  let changed = false;
  const previousStyles = resolveAllStyles(previous);
  const nextStyles = resolveAllStyles(next);

  for (const id of ids) {
    const before = previous.nodes[id];
    const after = next.nodes[id];
    if (before === after) continue;
    changed = true;
    if ((before && isContainer(before)) || (after && isContainer(after))) return { kind: 'full' };

    const beforeBounds = before ? nodeVisualWorldBounds(previous, id, previousStyles) : null;
    const afterBounds = after ? nodeVisualWorldBounds(next, id, nextStyles) : null;
    if (!beforeBounds && !afterBounds) return { kind: 'full' };
    if (beforeBounds) bounds = unionBounds(bounds, beforeBounds);
    if (afterBounds) bounds = unionBounds(bounds, afterBounds);
  }

  if (!changed) return { kind: 'none' };
  return bounds ? { kind: 'partial', bounds } : { kind: 'full' };
}
