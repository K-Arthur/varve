/**
 * Warp-aware bounds for scene nodes (local space only).
 *
 * Bounds taxonomy (see editor canvas/visualBounds.ts):
 *  - Source bounds — canonical geometry bounds (no warp)
 *  - Warped bounds — evaluated geometry bounds (conservative sampled)
 *  - Visual bounds — warped bounds + stroke/effect padding (editor-side)
 *
 * Layout always uses source bounds (the `layoutBounds: 'source'` policy is
 * the default and the only supported value in this version): warp never
 * triggers reflow loops because layout dimensions (`w`/`h`, auto-layout)
 * come from unwarped geometry.
 *
 * World-matrix composition is intentionally NOT done here — coordinateService
 * owns that — so this module never imports from it (no import cycle).
 */

import {
  hasLiveWarps,
  type WarpRect,
  type WarpSettings,
  warpBoundsOfPoints,
  warpBoundsOfWarpedPoints,
} from '@varve/engine';
import type { Affine, Rect } from '@varve/shared';
import { applyAffine, multiplyAffine, rotateDeg } from '@varve/shared';
import type { Document } from './document';
import { buildParentIndexMap } from './document';
import { nodeLocalBoundsSource } from './sourceBounds';
import type { NodeId, SceneNode } from './types';
import { warpsOnNode } from './warpOps';

const CORNERS = (r: WarpRect): Array<[number, number]> => [
  [r.x, r.y],
  [r.x + r.w, r.y],
  [r.x + r.w, r.y + r.h],
  [r.x, r.y + r.h],
];

function settingsOf(node: SceneNode): WarpSettings | undefined {
  return (node as { warpSettings?: WarpSettings }).warpSettings;
}

/**
 * Warped local bounds of a shape/text node carrying live warps. Falls back
 * to null when the node has no live warps (callers then use source bounds).
 */
export function nodeWarpedLocalBounds(
  node: SceneNode,
  doc?: { paints?: Record<string, import('./types').Paint> },
): Rect | null {
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) return null;
  const source = nodeLocalBoundsSource(node, doc);
  if (!source) return null;
  const settings = settingsOf(node);
  const { bounds } = warpBoundsOfPoints(
    CORNERS(source),
    source,
    warps,
    settings ? { settings } : {},
  );
  return bounds;
}

/** Bounds of a point set (already-warped) with conservative padding. */
export function warpedPointsBounds(
  points: Array<[number, number]>,
  sourceBounds: WarpRect,
  settings?: WarpSettings,
): Rect {
  return warpBoundsOfWarpedPoints(points, sourceBounds, settings ? { settings } : {});
}

function domainOf(points: Array<[number, number]>): WarpRect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (minX === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: minX, y: minY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

/** Local-space transform of a node relative to one of its ancestors. */
export function localTransformToAncestor(
  doc: Document,
  nodeId: NodeId,
  ancestorId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Affine | null {
  const index = parentIndex ?? buildParentIndexMap(doc);
  const chain: Affine[] = [];
  let current: NodeId | null = nodeId;
  const visited = new Set<NodeId>();
  while (current && current !== ancestorId && !visited.has(current)) {
    visited.add(current);
    const node = doc.nodes[current];
    if (!node) break;
    const t = node.transform as Affine;
    const rot = node.rotation ?? 0;
    chain.push(rot !== 0 ? multiplyAffine(t, rotateDeg(rot)) : t);
    current = index.get(current) ?? null;
  }
  if (current !== ancestorId || chain.length === 0) return null;
  let m: Affine = [1, 0, 0, 1, 0, 0];
  for (let i = chain.length - 1; i >= 0; i--) {
    m = multiplyAffine(m, chain[i]!);
  }
  return m;
}

/**
 * Warped local bounds of a warped container: children geometry is
 * transformed into container-local space, warped through the container's
 * stack, and unioned (conservative).
 */
export function warpedContainerLocalBounds(
  doc: Document,
  containerId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
): Rect | null {
  const node = doc.nodes[containerId];
  if (!node || (node.kind !== 'group' && node.kind !== 'frame')) return null;
  const warps = warpsOnNode(node);
  if (!hasLiveWarps(warps)) return null;
  const index = parentIndex ?? buildParentIndexMap(doc);

  const childrenLocal: Array<[number, number]> = [];
  for (const childId of node.children) {
    const child = doc.nodes[childId];
    if (!child) continue;
    const childBounds = hasLiveWarps(warpsOnNode(child))
      ? nodeWarpedLocalBounds(child, doc)
      : nodeLocalBoundsSource(child, doc);
    if (!childBounds) continue;
    const localMat = localTransformToAncestor(doc, childId, containerId, index);
    if (!localMat) continue;
    for (const [x, y] of CORNERS(childBounds)) {
      const p = applyAffine(localMat, [x, y]);
      childrenLocal.push([p[0], p[1]]);
    }
  }
  if (childrenLocal.length === 0) return null;
  const settings = settingsOf(node);
  const { bounds } = warpBoundsOfPoints(
    childrenLocal,
    domainOf(childrenLocal),
    warps,
    settings ? { settings } : {},
  );
  return bounds;
}

/** Does this container carry a live warp that affects its children? */
export function isWarpedContainer(node: SceneNode | undefined): boolean {
  if (!node || (node.kind !== 'group' && node.kind !== 'frame')) return false;
  return hasLiveWarps(warpsOnNode(node));
}
