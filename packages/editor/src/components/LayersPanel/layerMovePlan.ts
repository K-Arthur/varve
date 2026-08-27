/**
 * Planning a Layers move as a sequence of single-node reparent calls.
 *
 * `reparentNode` moves one node at a time: it removes the node from the
 * target's `children` array, then splices it back at the index given. A
 * multi-row drag is therefore several such calls, and the plan is only
 * correct if it *composes* — the members of the run that have not moved yet
 * are still occupying slots underneath the insertion point.
 */

import type { NodeId } from '@varve/scene';

/**
 * Compute (id, index) insertion steps for landing a multi-node move
 * contiguously at `basePosition` in `targetSiblings`, applied as a sequence
 * of single-item splice-style inserts (matching how `reparentNode` is called
 * one node at a time). `moveIdsVisualOrder` must be in panel/entries order
 * (front-most/highest-array-index first, since flattenTree walks children
 * back-to-front) — this function reverses it to ascending array-index order
 * so each call's index composes correctly against the previous ones and the
 * group's original relative order is preserved either way you read it.
 */
export function computeMultiMoveSteps(
  targetSiblings: NodeId[],
  moveIdsVisualOrder: NodeId[],
  basePosition: number,
): Array<{ id: NodeId; index: number }> {
  const ascendingOrder = [...moveIdsVisualOrder].reverse();
  const moving = new Set(ascendingOrder);

  // Anchor the run by how many *stationary* siblings must end up above it,
  // not by a raw array slot. Slot arithmetic silently drifts as soon as one
  // member of the run is lifted out of the list, which is what made
  // multi-row drags land in scrambled order.
  let anchor = 0;
  for (let i = 0; i < Math.min(basePosition, targetSiblings.length); i++) {
    if (!moving.has(targetSiblings[i]!)) anchor++;
  }

  // reparentNode applies one node at a time, each call removing the node and
  // splicing it back at the given index, so every step has to be planned
  // against the list as it exists at that moment: the not-yet-moved members
  // of the run are still sitting at their original positions and shift every
  // slot beneath them. Simulating the sequence is the only way the composed
  // result matches the single move the user actually performed.
  const list = [...targetSiblings];
  const steps: Array<{ id: NodeId; index: number }> = [];
  let previousId: NodeId | null = null;

  for (const id of ascendingOrder) {
    const without = list.filter((x) => x !== id);
    let index: number;
    if (previousId === null) {
      // First of the run: sit just past `anchor` stationary siblings.
      // Run members still awaiting their turn are stepped over rather than
      // counted — they get lifted out and re-placed after this one anyway.
      index = without.length;
      let stationarySeen = 0;
      for (let i = 0; i < without.length; i++) {
        if (stationarySeen === anchor) {
          index = i;
          break;
        }
        if (!moving.has(without[i]!)) stationarySeen++;
      }
    } else {
      // Every later member lands immediately after the previous one, which
      // keeps the group contiguous and preserves its internal order.
      index = without.indexOf(previousId) + 1;
    }

    steps.push({ id, index });
    without.splice(Math.max(0, Math.min(index, without.length)), 0, id);
    list.length = 0;
    list.push(...without);
    previousId = id;
  }

  return steps;
}

/** Return true when applying the planned splice steps leaves this sibling list unchanged. */
export function isNoOpMove(
  targetSiblings: NodeId[],
  steps: Array<{ id: NodeId; index: number }>,
): boolean {
  let result = [...targetSiblings];
  for (const step of steps) {
    result = result.filter((id) => id !== step.id);
    result.splice(Math.max(0, Math.min(step.index, result.length)), 0, step.id);
  }
  if (result.length !== targetSiblings.length) return false;
  return result.every((id, index) => id === targetSiblings[index]);
}
