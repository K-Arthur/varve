/**
 * Conservative document dirty-region analysis.
 *
 * Partial redraw is used only when every changed node is a non-container with
 * known old/new bounds. Structural edits fall back to a full redraw because a
 * parent transform, clip, mask, or isolation change can affect descendants.
 */

import type { Document, NodeId, RasterLayerNode } from '@strata/scene';
import { isContainer, parseTileKey, resolveAllStyles, TILE_SIZE } from '@strata/scene';
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

function rasterTileWorldBounds(tileKey: string): Rect {
  const { col, row } = parseTileKey(tileKey);
  return {
    x: col * TILE_SIZE,
    y: row * TILE_SIZE,
    w: TILE_SIZE,
    h: TILE_SIZE,
  };
}

function changedRasterTileBounds(before: RasterLayerNode, after: RasterLayerNode): Rect[] {
  const rects: Rect[] = [];
  const allKeys = new Set<string>([...before.tiles.keys(), ...after.tiles.keys()]);
  for (const key of allKeys) {
    const bTile = before.tiles.get(key);
    const aTile = after.tiles.get(key);
    if (bTile === aTile) continue;
    if (bTile && aTile && bTile.version === aTile.version) continue;
    rects.push(rasterTileWorldBounds(key));
  }
  return rects;
}

export function computeDocumentDirtyRegion(
  previous: Document,
  next: Document,
  forceFull?: boolean,
): DirtyRegion {
  if (previous === next || forceFull) return { kind: forceFull ? 'full' : 'none' };
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

    if ((before && isContainer(before)) || (after && isContainer(after))) {
      return { kind: 'full' };
    }

    if (before?.kind === 'rasterLayer' || after?.kind === 'rasterLayer') {
      const rBefore = before as RasterLayerNode | undefined;
      const rAfter = after as RasterLayerNode | undefined;

      if (rBefore && rAfter) {
        const tileRects = changedRasterTileBounds(rBefore, rAfter);
        if (tileRects.length === 0) continue;
        for (const tr of tileRects) {
          bounds = unionBounds(bounds, tr);
        }
        continue;
      }
    }

    const beforeBounds = before ? nodeVisualWorldBounds(previous, id, previousStyles) : null;
    const afterBounds = after ? nodeVisualWorldBounds(next, id, nextStyles) : null;
    if (!beforeBounds && !afterBounds) {
      return { kind: 'full' };
    }
    if (beforeBounds) bounds = unionBounds(bounds, beforeBounds);
    if (afterBounds) bounds = unionBounds(bounds, afterBounds);
  }

  if (!changed) return { kind: 'none' };
  return bounds ? { kind: 'partial', bounds } : { kind: 'full' };
}
