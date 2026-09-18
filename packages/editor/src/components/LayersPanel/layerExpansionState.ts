/**
 * Pure helpers for the Layers tree's expansion-state integrity.
 *
 * Extracted from LayersTree for the file's complexity ceiling; re-exported
 * from there for the established test import path.
 *
 * Expansion is user state: only containers that are genuinely NEW to the
 * document expand automatically, a rename or fill edit (new node object,
 * same id) never touches disclosure, and the set transfers across panel
 * detach as bounded window-local presentation state (never document
 * content).
 */

import type { Document, NodeId } from '@varve/scene';
import { isContainer } from '@varve/scene';

/** Ceiling for the expansion set mirrored into the panel-transfer codec —
 * the codec declines arrays longer than 1 000, and a declined value would
 * silently disable the whole panel transfer. Beyond this many expanded
 * containers the transfer resets to the all-expanded default. */
export const PANEL_TRANSFER_EXPANSION_LIMIT = 1000;

/** Node ids present in `next` but not in `prev` (prev null = first sight). */
export function addedIdsBetween(prev: Set<NodeId> | null, next: Set<NodeId>): NodeId[] {
  if (!prev) return [];
  const added: NodeId[] = [];
  for (const id of next) {
    if (!prev.has(id)) added.push(id);
  }
  return added;
}

/**
 * Expand containers that are NEW to the document so imported/pasted subtrees
 * stay visible. Only genuinely new node ids qualify: a rename or fill edit
 * produces a new node object under an existing id, and re-adding every
 * container on that signal would silently re-expand subtrees the user
 * deliberately collapsed. Empty containers are skipped (nothing to reveal).
 */
export function expandAddedContainers(
  doc: Document,
  addedIds: readonly NodeId[],
  expanded: Set<NodeId>,
): Set<NodeId> {
  let next: Set<NodeId> | null = null;
  for (const id of addedIds) {
    const node = doc.nodes[id];
    if (!node || !isContainer(node) || node.children.length === 0) continue;
    if (expanded.has(id) || next?.has(id)) continue;
    next ??= new Set(expanded);
    next.add(id);
  }
  return next ?? expanded;
}
