/**
 * Repeat Transform — stores the last transform delta so it can be reapplied
 * to the current selection with one command.
 *
 * The delta is a full Affine matrix that was applied to all selected nodes
 * during a gesture. Reapplying it means: for each currently selected node,
 * compute `delta · nodeWorldTransform` and write the result back as the
 * node's local transform.
 */

import type { Affine } from '@varve/shared';

export interface RepeatTransformState {
  delta: Affine;
  /** Snapshot of the selection at the time of the original transform. */
  selectionSnapshot: readonly string[];
}

let lastTransform: RepeatTransformState | null = null;

/** Store the last successful transform for repeat. */
export function storeRepeatTransform(delta: Affine, selection: readonly string[]): void {
  if (
    delta[0] === 1 &&
    delta[1] === 0 &&
    delta[2] === 0 &&
    delta[3] === 1 &&
    delta[4] === 0 &&
    delta[5] === 0
  )
    return;
  lastTransform = { delta, selectionSnapshot: [...selection] };
}

/** Retrieve the last stored transform, or null. */
export function getLastRepeatTransform(): RepeatTransformState | null {
  return lastTransform;
}

/** Clear stored transform (e.g. after undo or tool change). */
export function clearRepeatTransform(): void {
  lastTransform = null;
}
