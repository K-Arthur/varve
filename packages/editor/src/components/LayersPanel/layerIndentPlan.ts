/**
 * Pure planning for the keyboard and context-menu indent/outdent commands —
 * the non-drag reparenting path (WCAG 2.5.7; the drag grip is the other
 * route, and keyboard-only users previously had no reparent equivalent at
 * all).
 *
 * Research basis: Krita's "Move Layer Up/Down … switches layers in and out
 * of groups when coming across them" (Ctrl+PageUp/PageDown, Layers docker
 * docs) is the canonical non-drag reparent primitive; Figma and Sketch offer
 * no keyboard reparent. Varve binds, tree-local like the sibling reorder:
 *   Ctrl+Alt+] — Move Into Container Above (indent)
 *   Ctrl+Alt+[ — Move Out of Container (outdent)
 *
 * Order model (see docs/architecture/layers-drag-drop.md): `children[]` is
 * back-to-front; the panel displays front-most first. Appending to a
 * container's children therefore displays the node directly beneath the
 * container's row (the classic indent result), and outdenting inserts at the
 * parent's own raw index in the grandparent, which displays the node
 * directly beneath the parent's whole subtree block.
 */

import type { ContainerNode, Document, NodeId } from '@varve/scene';
import { isContainer } from '@varve/scene';
import {
  getParentFast,
  isDescendantFast,
  type ParentIndexCache,
} from '../../scene/parentIndexCache';
import { siblingsOf } from './layerDropResolver';

export type IndentOutdentPlan =
  | { kind: 'indent'; containerId: NodeId }
  | { kind: 'outdent'; parentId: NodeId | null; index: number }
  | {
      kind: 'invalid';
      reason: 'no-row-above' | 'row-above-not-container' | 'cycle' | 'already-root';
    };

/** Minimal display-order entry the planner needs (FlatEntry assigns to it). */
export interface StructureEntry {
  node: { id: NodeId };
  parentId: NodeId | null;
}

/**
 * Plan moving `movedIds` (canonicalized selection roots) into the container
 * displayed directly above the focused row. The row above a focused single
 * node can never be its own descendant (a subtree is contiguous below its
 * root row), but with a multi-root selection it CAN belong to another moved
 * root — those rows are skipped, and a target that is itself a moved root or
 * sits inside a moved subtree is the cycle case, refused rather than
 * silently re-scoped.
 */
export function planIndent(
  doc: Document,
  entries: readonly StructureEntry[],
  focusIdx: number,
  movedIds: readonly NodeId[],
  parentCache: ParentIndexCache | null,
): IndentOutdentPlan {
  let above = focusIdx - 1;
  while (above >= 0) {
    const entry = entries[above];
    if (!entry) break;
    const inMovedSubtree = movedIds.some((root) =>
      isDescendantFast(doc, root, entry.node.id, parentCache),
    );
    if (!inMovedSubtree) break;
    above -= 1;
  }
  const targetEntry = entries[above];
  if (!targetEntry) return { kind: 'invalid', reason: 'no-row-above' };
  const target = doc.nodes[targetEntry.node.id];
  if (!target || !isContainer(target)) {
    return { kind: 'invalid', reason: 'row-above-not-container' };
  }
  // isDescendantFast treats a node as its own ancestor, so this also covers
  // the target being one of the moved roots.
  for (const root of movedIds) {
    if (isDescendantFast(doc, root, targetEntry.node.id, parentCache)) {
      return { kind: 'invalid', reason: 'cycle' };
    }
  }
  return { kind: 'indent', containerId: targetEntry.node.id };
}

/**
 * Plan moving one canonicalized root out of its container, landing directly
 * beneath the parent's subtree block. `parentId: null` means the active
 * surface's content root (the context command resolves that). The insertion
 * index is the parent's own slot in the grandparent's children: after the
 * move the node displays below the parent's block, mirroring indent.
 */
export function planOutdent(
  doc: Document,
  id: NodeId,
  designCanvasId: NodeId | undefined,
  parentCache: ParentIndexCache | null,
): IndentOutdentPlan {
  const parentId = getParentFast(doc, id, parentCache);
  if (!parentId) return { kind: 'invalid', reason: 'already-root' };
  if (!doc.nodes[parentId]) return { kind: 'invalid', reason: 'already-root' };
  const grandparentId = getParentFast(doc, parentId, parentCache);
  const grandparentSiblings = siblingsOf(doc, grandparentId, designCanvasId);
  const parentIndex = grandparentSiblings.indexOf(parentId);
  if (parentIndex < 0) return { kind: 'invalid', reason: 'already-root' };
  return { kind: 'outdent', parentId: grandparentId, index: parentIndex };
}

/**
 * Canonicalized roots in DISPLAY order (front-most first). Appending them to
 * the destination in reverse display order preserves their relative stacking
 * — the same discipline computeMultiMoveSteps applies for drag moves.
 */
export function orderRootsForAppend(
  entries: readonly StructureEntry[],
  roots: readonly NodeId[],
): NodeId[] {
  const entryIndex = new Map(entries.map((e, i) => [e.node.id, i] as const));
  return [...roots].sort((a, b) => (entryIndex.get(b) ?? 0) - (entryIndex.get(a) ?? 0));
}

/**
 * The container node backing an indent plan, for lock/target validation by
 * the caller (which owns the effective-lock model and announcements).
 */
export function containerForPlan(doc: Document, containerId: NodeId): ContainerNode | undefined {
  const node = doc.nodes[containerId];
  return node && isContainer(node) ? (node as ContainerNode) : undefined;
}
