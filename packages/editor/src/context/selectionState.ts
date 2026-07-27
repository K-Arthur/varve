import type { NodeId } from '@strata/scene';

/**
 * Canonical source of truth for the editor's selection-origin literals.
 *
 * Centralising this small union prevents string widening in reducer-style
 * update paths and gives both `EditorContext` and `SelectionContext` a
 * shared vocabulary for `selectionOrigin`.
 */
export type SelectionOrigin = 'canvas' | 'layers' | 'keyboard' | 'command' | 'api';

/** Default origin for selection changes triggered from the canvas. */
export const DEFAULT_SELECTION_ORIGIN: SelectionOrigin = 'canvas';

/**
 * Compute the primary selection id after a toggle operation.
 *
 * - Non-additive (normal click): primary becomes the clicked id.
 * - Additive deselect: if the deselected id was primary, fall back to the
 *   first remaining selected node; otherwise keep current primary.
 * - Additive select: keep current primary, or use the first selected node
 *   (which is the newly added one) when none was set.
 */
export function nextSelectionPrimary(
  currentSelection: NodeId[],
  nextSelection: NodeId[],
  currentPrimary: NodeId | null,
  toggledId: NodeId,
  additive: boolean,
): NodeId | null {
  if (nextSelection.length === 0) return null;
  if (!additive) return toggledId;
  if (currentSelection.includes(toggledId)) {
    // toggledId was removed
    return currentPrimary === toggledId ? nextSelection[0]! : currentPrimary;
  }
  // toggledId was added
  return currentPrimary ?? nextSelection[0]!;
}
