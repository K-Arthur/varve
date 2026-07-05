/**
 * Cached parent index for O(1) parent lookups.
 *
 * The scene model's getParent() is O(n) — it scans all nodes every time.
 * This module wraps buildParentIndexMap() (which is O(n) once) and caches
 * the result, invalidating when the document reference changes.
 *
 * Hot paths (selection ops, render loop, layers panel) should create a cache
 * once per frame/operation and pass it to getParentFast/isDescendantFast.
 */

import type { Document, NodeId } from '@strata/scene';
import { buildParentIndexMap, getParent } from '@strata/scene';

/**
 * Cached parent index for O(1) parent lookups.
 * Invalidated when the document reference changes.
 */
export interface ParentIndexCache {
  parentMap: Map<NodeId, NodeId | null>;
  docRef: Document;
}

/**
 * Create or update a parent index cache from a document.
 * Returns existing cache if docRef matches, otherwise rebuilds.
 * Root-level nodes are mapped to null in the index.
 */
export function getOrCreateParentCache(
  doc: Document,
  cache?: ParentIndexCache | null,
): ParentIndexCache {
  if (cache && cache.docRef === doc) return cache;

  const raw = buildParentIndexMap(doc);
  const parentMap: Map<NodeId, NodeId | null> = new Map();

  for (const [childId, parentId] of raw) {
    parentMap.set(childId, parentId);
  }

  for (const id of doc.rootChildren) {
    if (!parentMap.has(id)) {
      parentMap.set(id, null);
    }
  }

  return { parentMap, docRef: doc };
}

/**
 * O(1) parent lookup using cached index.
 * Falls back to O(n) getParent if no cache provided.
 */
export function getParentFast(
  doc: Document,
  id: NodeId,
  cache?: ParentIndexCache | null,
): NodeId | null {
  if (cache && cache.docRef === doc) {
    const result = cache.parentMap.get(id);
    return result !== undefined ? result : null;
  }
  return getParent(doc, id);
}

/**
 * Check if `descendantId` is a descendant of `ancestorId` using cached index.
 * Returns true if both ids are the same (a node is considered an ancestor of itself).
 */
export function isDescendantFast(
  doc: Document,
  ancestorId: NodeId,
  descendantId: NodeId,
  cache?: ParentIndexCache | null,
): boolean {
  if (ancestorId === descendantId) return true;

  const effectiveCache = cache && cache.docRef === doc ? cache : null;
  if (effectiveCache) {
    let current = effectiveCache.parentMap.get(descendantId);
    while (current != null) {
      if (current === ancestorId) return true;
      current = effectiveCache.parentMap.get(current);
    }
    return false;
  }

  let current: NodeId | null = descendantId;
  while (current) {
    if (current === ancestorId) return true;
    current = getParent(doc, current);
  }
  return false;
}
