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
import type { Document, NodeId } from '@strata/scene';
import { getParent } from '@strata/scene';
import { computeDocumentDirtyRegion } from './dirtyRegion';

export interface InvalidationPlan {
  isStructural: boolean;
  /** Only meaningful when `isStructural` is false. */
  changedIds: NodeId[];
}

export function computeInvalidationPlan(previous: Document, next: Document): InvalidationPlan {
  const dirty = computeDocumentDirtyRegion(previous, next);
  const isStructural = dirty.kind === 'full' || previous.rootChildren !== next.rootChildren;
  if (isStructural) return { isStructural: true, changedIds: [] };

  const changedIds = new Set<NodeId>();
  for (const id of Object.keys(previous.nodes)) {
    if (previous.nodes[id] !== next.nodes[id]) changedIds.add(id);
  }
  for (const id of Object.keys(next.nodes)) {
    if (!(id in previous.nodes)) changedIds.add(id);
  }
  for (const id of [...changedIds]) {
    const parent = getParent(next, id);
    if (parent) changedIds.add(parent);
  }
  return { isStructural: false, changedIds: [...changedIds] };
}
