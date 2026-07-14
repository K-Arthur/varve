/**
 * Container culling policy for Canvas 2D scene traversal.
 *
 * A group's canonical bounds already union every descendant, so an offscreen
 * group can be skipped safely. A frame's own bounds do not include overflow;
 * descendants may only be skipped when the frame actually clips them.
 */
import type { SceneNode } from '@strata/scene';

export function canCullDescendantsWithContainerBounds(node: SceneNode): boolean {
  return node.kind === 'group' || (node.kind === 'frame' && node.clipContent !== false);
}
