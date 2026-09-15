import type { Document, NodeId } from '@varve/scene';
import { buildParentIndexMap } from '@varve/scene';
import type { Affine, Rect } from '@varve/shared';
import {
  identity,
  multiplyAffine,
  rotateDeg,
  textMeasureRevision,
  transformRect,
} from '@varve/shared';
import { nodeLocalBounds } from './nodeBounds';
import type { PagePlacementMap } from './pagePlacement';
import { buildPagePlacementMap, pagePlacementForNode } from './pagePlacement';

export interface TransformCache {
  worldTransform: Map<NodeId, Affine>;
  worldBounds: Map<NodeId, Rect>;
  dirty: Set<NodeId>;
  generation: number;
  /**
   * O(1) parent lookup map for the document this cache was last used against.
   * getParent() is O(n) per call, so recomputing every world transform after a
   * structural invalidation without an index is O(n²) on large docs. Built
   * lazily on first use after each invalidation and dropped on invalidation so
   * it never goes stale relative to the doc.
   */
  parentIndex: Map<NodeId, NodeId> | null;
  /**
   * Node -> page placement map (ADR-0123), memoized per `doc.pages` identity.
   * Page placement is appended to composed world transforms so the cached
   * world space is the pasteboard.
   */
  placementMap: PagePlacementMap | null;
  placementPages: unknown;
  /**
   * Text-measurement identity the cached bounds were computed under.
   *
   * Text bounds depend on which font faces are usable, and font readiness
   * changes that without touching the document — so nothing in the document
   * diffing above can notice it. Cached text boxes measured against a fallback
   * face would otherwise outlive the real face becoming available, leaving
   * selection, hit testing, and snapping on the old geometry until an
   * unrelated structural edit happened to wipe the cache.
   */
  measureRevision: string;
}

export function createTransformCache(): TransformCache {
  return {
    worldTransform: new Map(),
    worldBounds: new Map(),
    dirty: new Set(),
    generation: 0,
    parentIndex: null,
    placementMap: null,
    placementPages: undefined,
    measureRevision: textMeasureRevision(),
  };
}

/**
 * Drop everything if text measurement has moved on since these bounds were
 * computed. Cheap enough (one string compare) to run on every lookup.
 */
function ensureMeasureRevision(cache: TransformCache): void {
  const current = textMeasureRevision();
  if (cache.measureRevision === current) return;
  cache.measureRevision = current;
  invalidateAll(cache);
}

const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];

function getPlacementMap(cache: TransformCache, doc: Document): PagePlacementMap {
  if (cache.placementMap !== null && cache.placementPages === doc.pages) {
    return cache.placementMap;
  }
  const map = buildPagePlacementMap(doc);
  cache.placementMap = map;
  cache.placementPages = doc.pages;
  return map;
}

function getCacheParentIndex(cache: TransformCache, doc: Document): Map<NodeId, NodeId> {
  if (!cache.parentIndex) cache.parentIndex = buildParentIndexMap(doc);
  return cache.parentIndex;
}

function computeWorldTransform(cache: TransformCache, doc: Document, id: NodeId): Affine {
  const node = doc.nodes[id];
  if (!node) return identity;

  const nodeTransform = node.transform as Affine;
  const rot = node.rotation ?? 0;
  const combined = rot !== 0 ? multiplyAffine(nodeTransform, rotateDeg(rot)) : nodeTransform;
  const chain: Affine[] = [combined];

  const parentIndex = getCacheParentIndex(cache, doc);
  let parentId = parentIndex.get(id) ?? null;
  while (parentId) {
    const parent = doc.nodes[parentId];
    if (!parent) break;
    const parentRot = parent.rotation ?? 0;
    const parentTransform = parent.transform as Affine;
    chain.push(
      parentRot !== 0 ? multiplyAffine(parentTransform, rotateDeg(parentRot)) : parentTransform,
    );
    parentId = parentIndex.get(parentId) ?? null;
  }

  let world: Affine = identity;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    world = multiplyAffine(world, m);
  }

  // Page placement (ADR-0123): the containing page's placement translation
  // is the root-level offset of the page-owned subtree. It is not part of
  // any node transform, so it is appended after composition.
  const placement = pagePlacementForNode(getPlacementMap(cache, doc), id);
  if (placement) world = multiplyAffine(translate(placement.x, placement.y), world);
  return world;
}

export function getWorldTransform(cache: TransformCache, doc: Document, nodeId: NodeId): Affine {
  ensureMeasureRevision(cache);
  const cached = cache.worldTransform.get(nodeId);
  if (cached !== undefined && !cache.dirty.has(nodeId)) {
    return cached;
  }

  const result = computeWorldTransform(cache, doc, nodeId);
  cache.worldTransform.set(nodeId, result);
  cache.dirty.delete(nodeId);
  return result;
}

export function getWorldBounds(cache: TransformCache, doc: Document, nodeId: NodeId): Rect | null {
  ensureMeasureRevision(cache);
  const cached = cache.worldBounds.get(nodeId);
  if (cached !== undefined && !cache.dirty.has(nodeId)) {
    return cached;
  }

  const node = doc.nodes[nodeId];
  if (!node) return null;

  // Groups carry no own geometry; their world bounds are the union of their
  // children's world bounds. Node local bounds for groups return null, so
  // handle them explicitly here (mirrors nodeWorldBounds in @varve/scene).
  if (node.kind === 'group') {
    const children = node.children ?? [];
    let union: Rect | null = null;
    for (const childId of children) {
      const childBounds = getWorldBounds(cache, doc, childId);
      if (!childBounds) continue;
      if (!union) {
        union = { ...childBounds };
      } else {
        const minX = Math.min(union.x, childBounds.x);
        const minY = Math.min(union.y, childBounds.y);
        const maxX = Math.max(union.x + union.w, childBounds.x + childBounds.w);
        const maxY = Math.max(union.y + union.h, childBounds.y + childBounds.h);
        union = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }
    }
    if (union) {
      cache.worldBounds.set(nodeId, union);
      cache.dirty.delete(nodeId);
    }
    return union;
  }

  const local = nodeLocalBounds(node, doc);
  if (!local) return null;

  const worldMat = getWorldTransform(cache, doc, nodeId);
  const result = transformRect(worldMat, local);
  cache.worldBounds.set(nodeId, result);
  cache.dirty.delete(nodeId);
  return result;
}

export function invalidateAll(cache: TransformCache): void {
  cache.worldTransform.clear();
  cache.worldBounds.clear();
  cache.dirty.clear();
  cache.parentIndex = null;
  cache.generation++;
}

export function invalidateSubtree(cache: TransformCache, doc: Document, nodeId: NodeId): void {
  cache.dirty.add(nodeId);

  const node = doc.nodes[nodeId];
  if (node && 'children' in node && node.children) {
    for (const childId of node.children) {
      invalidateSubtree(cache, doc, childId);
    }
  }

  cache.generation++;
}

export function invalidateNodes(cache: TransformCache, nodeIds: NodeId[]): void {
  for (const id of nodeIds) {
    cache.dirty.add(id);
  }
  cache.generation++;
}
