/**
 * Editor-level warp actions — shared by the Warp tool, command palette,
 * menus, and Inspector. All mutations go through `updateDoc` inside one
 * transaction (single undo step), and all add/remove/expand operations keep
 * the source geometry canonical.
 */

import { makeWarpPreset, type WarpPresetKind } from '@varve/engine';
import type { Document } from '@varve/scene';
import {
  bakeWarpsInDocument,
  canNodeHaveWarps,
  removeWarp,
  setWarpEnabled,
  updateWarp,
  warpSelectionAsGroup,
  warpsOnNode,
  warpUnsupportedReason,
} from '@varve/scene';

/**
 * Structural editor surface the warp actions need. Both EditorContextValue
 * declarations (context.tsx and context/types.ts) satisfy this — decoupling
 * the actions from the interface split. Only the fields the actions read are
 * required, so the actions stay free of a direct context/types import.
 */
export interface WarpActionEditor {
  state: { selection?: string[]; document: Document };
  updateDoc: (fn: (doc: Document) => Document) => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  announce?: (msg: string) => void;
  setWarpEdit: (target: { nodeId: string; modifierId: string } | null) => void;
}

export function selectionIds(e: WarpActionEditor): string[] {
  return e.state.selection ?? [];
}

/** Apply a warp preset to the selection (grouped for multi-selection). */
export function applyWarpToSelection(
  e: WarpActionEditor,
  presetKind: WarpPresetKind = 'four-edge',
): boolean {
  const ids = selectionIds(e);
  if (ids.length === 0) return false;
  const unsupported = ids
    .map((id) => e.state.document.nodes[id])
    .filter(Boolean)
    .map((n) => warpUnsupportedReason(n))
    .filter((r): r is string => r !== null);
  if (unsupported.length > 0) {
    e.announce?.(`Warp unavailable: ${unsupported[0]}`);
    return false;
  }
  const modifier = makeWarpPreset(presetKind);
  let targetNodeId = ids[0]!;
  e.beginTransaction();
  try {
    e.updateDoc((doc) => {
      const next = warpSelectionAsGroup(doc, ids, modifier, 'Warp group');
      return next;
    });
    if (ids.length > 1) {
      // The group node was created by warpSelectionAsGroup.
      targetNodeId = findWarpGroupId(e.state.document, ids) ?? ids[0]!;
    }
  } finally {
    e.commitTransaction();
  }
  e.setWarpEdit({ nodeId: targetNodeId, modifierId: modifier.id });
  return true;
}

function findWarpGroupId(doc: Document, ids: string[]): string | null {
  for (const [id, node] of Object.entries(doc.nodes)) {
    if (
      node.kind === 'group' &&
      id.startsWith('warp-group-') &&
      node.children.some((c) => ids.includes(c))
    ) {
      return id;
    }
  }
  return null;
}

/** Remove one modifier from the active selection's stack. */
export function removeWarpFromSelection(e: WarpActionEditor, modifierId: string): void {
  const ids = selectionIds(e);
  if (ids.length === 0) return;
  e.beginTransaction();
  try {
    e.updateDoc((doc) => {
      let next = doc;
      for (const id of ids) next = removeWarp(next, id, modifierId);
      return next;
    });
  } finally {
    e.commitTransaction();
  }
  e.setWarpEdit(null);
}

/** Toggle a modifier's enabled state on the selection. */
export function toggleWarpOnSelection(e: WarpActionEditor, modifierId: string): void {
  const ids = selectionIds(e);
  if (ids.length === 0) return;
  e.updateDoc((doc) => {
    const node = doc.nodes[ids[0]!];
    const modifier = node ? warpsOnNode(node).find((w) => w.id === modifierId) : undefined;
    const enabled = modifier ? modifier.enabled !== false : true;
    let next = doc;
    for (const id of ids) next = setWarpEnabled(next, id, modifierId, !enabled);
    return next;
  });
}

/** Numeric parameter update on the selection (single undo step). */
export function updateWarpOnSelection(
  e: WarpActionEditor,
  modifierId: string,
  patch: Record<string, unknown>,
): void {
  const ids = selectionIds(e);
  if (ids.length === 0) return;
  e.beginTransaction();
  try {
    e.updateDoc((doc) => {
      let next = doc;
      for (const id of ids) {
        next = updateWarp(next, id, modifierId, patch as never);
      }
      return next;
    });
  } finally {
    e.commitTransaction();
  }
}

/** Eligible modifier for the current selection's primary node. */
export function eligibleWarpNodes(e: WarpActionEditor): string[] {
  return selectionIds(e).filter((id) => canNodeHaveWarps(e.state.document.nodes[id]));
}

/**
 * Expand Appearance: destructively bake the selected nodes' warp stacks with
 * the canonical export-quality evaluator (one undo transaction).
 */
export function expandWarpAppearance(e: WarpActionEditor): boolean {
  const ids = selectionIds(e);
  if (ids.length === 0) return false;
  let result: { baked: string[]; skipped: string[] } = { baked: [], skipped: [] };
  e.beginTransaction();
  try {
    e.updateDoc((doc) => {
      const r = bakeWarpsInDocument(doc, ids, { profile: 'export' });
      result = r;
      return r.document;
    });
  } finally {
    e.commitTransaction();
  }
  if (result.baked.length > 0) {
    e.announce?.(
      `Expanded appearance on ${result.baked.length} object${result.baked.length === 1 ? '' : 's'}`,
    );
  }
  if (result.skipped.length > 0) {
    e.announce?.(
      `${result.skipped.length} object${result.skipped.length === 1 ? ' was' : 's were'} not expandable (warps removed via export flattening instead)`,
    );
  }
  e.setWarpEdit(null);
  return result.baked.length > 0;
}
