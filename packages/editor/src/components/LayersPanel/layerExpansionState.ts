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

/**
 * The transfer codec uses a compact string rather than an array. The generic
 * panel state codec bounds arrays and object entries at 1,000 items; keeping
 * the ids in one delimited string preserves large documents without silently
 * dropping the tail of the user's disclosure state.
 */
export const PANEL_TRANSFER_EXPANSION_LIMIT = 1000;

export interface LayerExpansionTransfer {
  version: 1;
  initialized: true;
  encodedIds: string;
}

const TRANSFER_SEPARATOR = '\u001f';

export function encodeExpansionTransfer(ids: Iterable<NodeId>): LayerExpansionTransfer {
  return {
    version: 1,
    initialized: true,
    encodedIds: [...ids].join(TRANSFER_SEPARATOR),
  };
}

export function decodeExpansionTransfer(value: unknown): Set<NodeId> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<LayerExpansionTransfer>;
  if (candidate.version !== 1 || candidate.initialized !== true) return null;
  if (typeof candidate.encodedIds !== 'string') return null;
  if (candidate.encodedIds === '') return new Set<NodeId>();
  return new Set(candidate.encodedIds.split(TRANSFER_SEPARATOR).filter(Boolean) as NodeId[]);
}

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
