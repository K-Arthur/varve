/**
 * World-space transform and bounds helpers for the editor.
 *
 * These are the single source of truth for converting between a node's local
 * coordinate space and the world coordinate space used by the renderer,
 * hit-tester, selection overlay, and reveal logic.
 *
 * Research basis: scene-graph transform composition (standard affine chain).
 * Each node's `transform` is a local→parent affine; the world matrix is the
 * product of all ancestor transforms left-multiplied by the node's own.
 */

import type { Document, NodeId } from '@strata/scene';
import { buildParentIndexMap, getParent } from '@strata/scene';
import type { Affine, Rect } from '@strata/shared';
import {
  transformRect as affineTransformRect,
  identity,
  multiplyAffine,
  rotateDeg,
} from '@strata/shared';
import { nodeLocalBounds } from './nodeBounds';
import type { ParentIndexCache } from './parentIndexCache';
import type { TransformCache } from './transformCache';
import { getWorldTransform as getCachedTransform } from './transformCache';

export { nodeLocalBounds } from './nodeBounds';

/**
 * Walk the ancestor chain from `id` up to the root, composing local→parent
 * transforms into a single world→local affine.
 *
 * When `parentIndex` is provided (from {@link buildParentIndexMap}), parent
 * lookups are O(1) instead of O(n) — callers in hot paths (render loop) should
 * pre-build the index once per frame.
 *
 * When `cache` is provided, the result is cached and reused across calls within
 * the same cache generation — callers that repeatedly query transforms should
 * pass a cache for O(1) amortized lookup.
 *
 * Composes in scene-graph order: for parent transforms P₁, P₂, …, Pₙ where
 * P₁ is the root ancestor, the world transform is
 *   Pₙ · … · P₂ · P₁ · node.transform
 * (node's transform applied first in local space, then each parent's in order).
 */
export function nodeWorldTransform(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
  cache?: TransformCache,
  parentCache?: ParentIndexCache,
): Affine {
  if (cache) {
    return getCachedTransform(cache, doc, id);
  }
  const node = doc.nodes[id];
  if (!node) return identity;

  const nodeTransform = node.transform as Affine;
  const rot = node.rotation ?? 0;
  const combined = rot !== 0 ? multiplyAffine(nodeTransform, rotateDeg(rot)) : nodeTransform;
  const chain: Affine[] = [combined];

  const getParentFn = parentIndex
    ? (_d: Document, childId: NodeId) => parentIndex.get(childId) ?? null
    : parentCache && parentCache.docRef === doc
      ? (_d: Document, childId: NodeId) => parentCache.parentMap.get(childId) ?? null
      : getParent;
  let parentId = getParentFn(doc, id);
  while (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) break;
    const parentRot = parent.rotation ?? 0;
    const parentTransform = parent.transform as Affine;
    chain.push(
      parentRot !== 0 ? multiplyAffine(parentTransform, rotateDeg(parentRot)) : parentTransform,
    );
    parentId = getParentFn(doc, parentId);
  }

  // Compose in scene-graph order (children last → applied first, parents first → applied last).
  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }
  return world;
}

/**
 * Compute the axis-aligned world-space bounding box of a group node by
 * unioning all children's world bounds. Groups have no own geometry.
 */
export function groupWorldBounds(
  doc: Document,
  groupId: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
  cache?: TransformCache,
  parentCache?: ParentIndexCache,
): Rect | null {
  const node = doc.nodes[groupId];
  if (node?.kind !== 'group') return null;
  let union: Rect | null = null;
  for (const childId of node.children) {
    const b = nodeWorldBounds(doc, childId, parentIndex, cache, parentCache);
    if (!b) continue;
    if (!union) {
      union = { x: b.x, y: b.y, w: b.w, h: b.h };
    } else {
      const minX = Math.min(union.x, b.x);
      const minY = Math.min(union.y, b.y);
      const maxX = Math.max(union.x + union.w, b.x + b.w);
      const maxY = Math.max(union.y + union.h, b.y + b.h);
      union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
  }
  return union;
}

/**
 * Compute the node's geometry bounds in world space.
 *
 * This is the canonical function for selection overlay, reveal, and
 * zoom-to-fit. Returns `null` when bounds cannot be determined.
 * Groups return the union of all their children's world bounds.
 *
 * When `parentIndex` is provided, parent lookups are O(1) instead of O(n).
 */
export function nodeWorldBounds(
  doc: Document,
  id: NodeId,
  parentIndex?: Map<NodeId, NodeId>,
  cache?: TransformCache,
  parentCache?: ParentIndexCache,
): Rect | null {
  const node = doc.nodes[id];
  if (!node) return null;
  if (node.kind === 'group') return groupWorldBounds(doc, id, parentIndex, cache, parentCache);
  const local = nodeLocalBounds(node, doc);
  if (!local) return null;
  const worldMat = nodeWorldTransform(doc, id, parentIndex, cache, parentCache);
  return affineTransformRect(worldMat, local);
}
