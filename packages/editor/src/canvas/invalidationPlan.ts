/**
 * Decides whether a document change requires a full cache wipe or can use
 * selective, node-level invalidation.
 *
 * A structural change (container added/removed/reparented, top-level order
 * changed) can affect descendants, clipping, or spatial indexing in ways a
 * per-node diff can't safely capture, so it forces a full wipe. Everything
 * else (fill/stroke/opacity/position edits on non-container nodes) only
 * needs the touched nodes — plus their parents, since a parent's cached
 * world bounds can be a union of its children's bounds — invalidated.
 */
import type { Document, NodeId } from '@varve/scene';
import { buildParentIndexMap } from '@varve/scene';
import { computeDocumentDirtyRegion, pagePlacementChanged } from './dirtyRegion';

export interface InvalidationPlan {
  isStructural: boolean;
  /** Only meaningful when `isStructural` is false. */
  changedIds: NodeId[];
}

export function computeInvalidationPlan(previous: Document, next: Document): InvalidationPlan {
  const dirty = computeDocumentDirtyRegion(previous, next);
  // A page placement/size change shifts every node on the page in world
  // space without changing node identity, so it must wipe the transform
  // cache even though the node diff would classify it as non-structural.
  const isStructural =
    dirty.kind === 'full' ||
    previous.rootChildren !== next.rootChildren ||
    pagePlacementChanged(previous, next);
  if (isStructural) return { isStructural: true, changedIds: [] };

  const changedIds = new Set<NodeId>();
  for (const id of Object.keys(previous.nodes)) {
    if (previous.nodes[id] !== next.nodes[id]) changedIds.add(id);
  }
  for (const id of Object.keys(next.nodes)) {
    if (!(id in previous.nodes)) changedIds.add(id);
  }
  if (changedIds.size === 0) return { isStructural: false, changedIds: [] };
  // getParent() is O(n) per call; a bulk edit (duplicate, paste, delete) can
  // change thousands of nodes, so parent lookups here would be O(n²). Build
  // one O(n) index and resolve every parent through it.
  //
  // Walk every ancestor, not just the direct parent: world bounds of a group
  // are the union of its descendants' bounds, so a change anywhere in a group
  // invalidates every enclosing container up the chain. Skipping levels would
  // leave a grandparent group serving a stale cached union from transformCache.
  const parents = buildParentIndexMap(next);
  for (const id of [...changedIds]) {
    let parent = parents.get(id);
    while (parent) {
      changedIds.add(parent);
      parent = parents.get(parent);
    }
  }
  return { isStructural: false, changedIds: [...changedIds] };
}
