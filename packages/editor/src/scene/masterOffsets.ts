/**
 * Master-projection render offsets (M8, ADR-0132): master content roots sit
 * at the pasteboard origin and serve many pages, so projected master items
 * render at the placement of each page they are applied to. The transform
 * cache yields the unplaced master world transform (master nodes are not
 * page-owned); the render loop applies the containing page's placement
 * translation per node.
 *
 * Pure helpers — CanvasArea consumes this through one thin import; the map
 * is rebuilt once per frame from the placed scene.
 */

import type { Document, NodeId } from '@varve/scene';
import { buildPlacedScene } from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import { multiplyAffine } from '@varve/shared';

export interface MasterOffset {
  x: number;
  y: number;
}

/**
 * Node id -> placement translation for every projected master item.
 * Override-filtered master nodes only: 'modified' overrides are page-owned
 * replacement nodes (already covered by the placement map), and
 * hidden/deleted overrides project nothing (B3).
 */
export function collectMasterOffsets(doc: Document): Map<NodeId, MasterOffset> {
  const map = new Map<NodeId, MasterOffset>();
  for (const placed of buildPlacedScene(doc).pages) {
    if (placed.masterNodes.length === 0) continue;
    const offset: MasterOffset = { x: placed.placement.x, y: placed.placement.y };
    for (const id of placed.masterNodes) map.set(id, offset);
  }
  return map;
}

const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];

/** World transform with the page placement translation applied. */
export function offsetWorldTransform(world: Affine, offset: MasterOffset): Affine {
  return multiplyAffine(translate(offset.x, offset.y), world);
}

/** World bounds shifted by the page placement translation. */
export function offsetWorldBounds(bounds: Rect | null, offset: MasterOffset): Rect | null {
  if (!bounds) return null;
  return { x: bounds.x + offset.x, y: bounds.y + offset.y, w: bounds.w, h: bounds.h };
}
