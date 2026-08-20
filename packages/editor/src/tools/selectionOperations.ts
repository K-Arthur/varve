import type { NodeId } from '@varve/scene';
import type { ToolContext } from './types';

/** Boolean operation used by every node-area selection tool. */
export type SelectionOperation = 'replace' | 'add' | 'subtract' | 'intersect';

/**
 * Resolve the selection operation once for a gesture.
 *
 * The operation modifiers are deliberately independent from marquee hit
 * policy. Alt never changes containment: it always subtracts, including when
 * combined with Ctrl/Cmd for a contained subtraction.
 */
export function selectionOperationFromModifiers(modifiers: {
  shiftKey: boolean;
  altKey: boolean;
}): SelectionOperation {
  if (modifiers.shiftKey && modifiers.altKey) return 'intersect';
  if (modifiers.altKey) return 'subtract';
  if (modifiers.shiftKey) return 'add';
  return 'replace';
}

/**
 * Resolve object-marquee hit policy. The preference is application state;
 * Ctrl/Cmd temporarily flips it for this gesture and does not alter the
 * preference. This keeps operation and containment modifiers orthogonal.
 */
export function marqueeUsesContainment(
  preference: boolean,
  modifiers: { ctrlKey: boolean; metaKey: boolean },
): boolean {
  return Boolean(preference) !== (modifiers.ctrlKey || modifiers.metaKey);
}

/**
 * Pure, stable selection algebra. The order of `current` is retained for
 * subtract/intersect so the primary selection remains deterministic; replace
 * and add use the caller's deterministic scene/paint order for candidates.
 */
export function applyNodeSelectionOperation(
  current: readonly NodeId[],
  candidates: readonly NodeId[],
  operation: SelectionOperation,
): NodeId[] {
  const uniqueCandidates = [...new Set(candidates)];
  const candidateSet = new Set(uniqueCandidates);

  switch (operation) {
    case 'replace':
      return uniqueCandidates;
    case 'add': {
      const result = [...current];
      const selected = new Set(result);
      for (const id of uniqueCandidates) {
        if (selected.has(id)) continue;
        selected.add(id);
        result.push(id);
      }
      return result;
    }
    case 'subtract':
      return current.filter((id) => !candidateSet.has(id));
    case 'intersect':
      return current.filter((id) => candidateSet.has(id));
  }
}

/** Apply the pure result through the existing single-id/toggle editor API. */
export function commitNodeSelectionOperation(
  ctx: Pick<ToolContext, 'selection' | 'setSelection' | 'toggleSelection' | 'isSelected'>,
  candidates: readonly NodeId[],
  operation: SelectionOperation,
): NodeId[] {
  const next = applyNodeSelectionOperation(ctx.selection, candidates, operation);

  switch (operation) {
    case 'replace': {
      // Clear first, then add every candidate through the same path used by
      // the editor's established marquee implementation. Besides preserving
      // candidate order, this keeps a multi-node replace a single logical
      // operation even though ToolContext exposes single-id primitives.
      ctx.setSelection(null);
      for (const id of next) ctx.toggleSelection(id, true);
      break;
    }
    case 'add':
      for (const id of candidates) {
        if (!ctx.isSelected(id)) ctx.toggleSelection(id, true);
      }
      break;
    case 'subtract':
      for (const id of candidates) {
        if (ctx.isSelected(id)) ctx.toggleSelection(id, false);
      }
      break;
    case 'intersect':
      ctx.setSelection(next[0] ?? null);
      for (const id of next.slice(1)) ctx.toggleSelection(id, true);
      break;
  }

  return next;
}
