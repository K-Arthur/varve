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

import type { Document, NodeId } from '@varve/scene';
import { buildParentIndexMap, getParent, nodesDifferOnlyInTransforms } from '@varve/scene';

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
  // The provider, Layers panel, Layers tree, and selection context each hold
  // their own cache ref, so one document change rebuilt this index for every
  // holder. Share the most recent build under the same identity contract.
  if (lastSharedParentCache?.docRef === doc) return lastSharedParentCache;

  const raw = committedParentIndex(doc);
  const parentMap: Map<NodeId, NodeId | null> = new Map();

  for (const [childId, parentId] of raw) {
    parentMap.set(childId, parentId);
  }

  for (const id of doc.rootChildren) {
    if (!parentMap.has(id)) {
      parentMap.set(id, null);
    }
  }

  lastSharedParentCache = { parentMap, docRef: doc };
  return lastSharedParentCache;
}

let lastSharedParentCache: ParentIndexCache | null = null;

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

/**
 * A parent map shared between consumers. Mutation after construction throws,
 * so one consumer cannot corrupt another's view of the document.
 */
class SealedParentIndex extends Map<NodeId, NodeId> {
  #sealed = false;

  seal(): this {
    this.#sealed = true;
    return this;
  }

  override set(key: NodeId, value: NodeId): this {
    if (this.#sealed) throw new Error('committedParentIndex maps are shared and read-only');
    return super.set(key, value);
  }

  override delete(key: NodeId): boolean {
    if (this.#sealed) throw new Error('committedParentIndex maps are shared and read-only');
    return super.delete(key);
  }

  override clear(): void {
    if (this.#sealed) throw new Error('committedParentIndex maps are shared and read-only');
    super.clear();
  }
}

const COMMITTED_PARENT_INDEX_CAPACITY = 4;
const committedParentIndexes: Array<{ nodes: Document['nodes']; index: Map<NodeId, NodeId> }> = [];

/**
 * The child → parent map (same contents as `buildParentIndexMap`) for a
 * committed, immutable document, shared by every read-only consumer.
 *
 * During a drag, name labels, the accessibility tree, Inspector restrictions,
 * the align bar, move planning, and both dirty-region passes each rebuilt this
 * map for the same document every frame (16% of main-thread time at 10k
 * nodes). Keyed by the `nodes` record — the map's only input — and bounded to
 * the most recent records, because undo history keeps old documents alive.
 *
 * Only for documents that are no longer being edited in place. Code that
 * builds a document by mutating a fresh `nodes` record must keep using
 * `buildParentIndexMap` until the record is published.
 */
export function committedParentIndex(doc: Document): Map<NodeId, NodeId> {
  const nodes = doc.nodes;
  for (let i = 0; i < committedParentIndexes.length; i++) {
    const entry = committedParentIndexes[i]!;
    if (entry.nodes !== nodes) continue;
    if (i > 0) {
      committedParentIndexes.splice(i, 1);
      committedParentIndexes.unshift(entry);
    }
    return entry.index;
  }
  // A move leaves every parent link intact, and every drag frame commits one.
  // The sealed map can be shared with the moved document as it is.
  const latest = committedParentIndexes[0];
  if (latest && nodesDifferOnlyInTransforms(latest.nodes, nodes)) {
    committedParentIndexes.unshift({ nodes, index: latest.index });
    if (committedParentIndexes.length > COMMITTED_PARENT_INDEX_CAPACITY) {
      committedParentIndexes.pop();
    }
    return latest.index;
  }
  // Filled after construction: Map's constructor would call the overridden
  // `set` before the subclass's private field exists.
  const index = new SealedParentIndex();
  for (const [childId, parentId] of buildParentIndexMap(doc)) index.set(childId, parentId);
  index.seal();
  committedParentIndexes.unshift({ nodes, index });
  if (committedParentIndexes.length > COMMITTED_PARENT_INDEX_CAPACITY) {
    committedParentIndexes.pop();
  }
  return index;
}
