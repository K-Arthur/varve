/**
 * Mask resolution for the scene graph.
 *
 * A mask is a property on a container (FrameNode or GroupNode) that designates
 * one of its children as a mask source. The mask type determines how the child
 * is used:
 *   - 'clip': the mask child's outline clips the container's other children
 *   - 'alpha': the mask child's alpha channel modulates the container's
 *     other children (deferred — requires render-time compositing)
 *
 * Research basis: Figma mask model (Fill → Mask, alpha/vector masks),
 * Adobe Illustrator clipping masks.
 */
import type { Mask, SceneNode } from './types';

/** Return the effective mask for a container node, or null if no mask is set. */
export function resolveMask(node: SceneNode): Mask | null {
  if (node.kind !== 'frame' && node.kind !== 'group') return null;
  const n = node as SceneNode & { mask?: Mask };
  if (!n.mask) return null;
  if (!n.children!.includes(n.mask.sourceNodeId)) return null;
  return n.mask;
}

/** True if the container has an active (visible, valid) mask. */
export function isMasked(node: SceneNode): boolean {
  const mask = resolveMask(node);
  return mask !== null && mask.visible;
}
