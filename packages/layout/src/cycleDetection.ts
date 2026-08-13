/**
 * Cycle detection for auto-layout parent-child resize relationships.
 *
 * Detects circular dependencies where a child sized as a percentage/fill of a
 * parent that itself sizes to fit its children would create an infinite loop.
 *
 * Uses DFS with a visitation trail — terminates early at O(n) in the worst case,
 * where n is the number of nodes in the document.
 *
 * Research basis: CSS containment/layout cycle detection (CSS Sizing Level 4),
 * Figma auto-layout cycle guards, token alias cycle detection in color engines.
 */

import type { Document, NodeId } from '@varve/scene';
import { getParent } from '@varve/scene';

export type LayoutCycleVerdict = 'no_cycle' | 'cycle_detected';

export interface CycleCheckResult {
  verdict: LayoutCycleVerdict;
  cycle: NodeId[];
  /** Human-readable description of the cycle for debugging / user feedback. */
  description: string;
}

/**
 * Check whether applying a layout sizing change to `targetId` would create a
 * circular resize dependency in the document.
 *
 * A cycle exists when:
 *   - `targetId` has `layoutSizing === 'fill'` (sized by parent)
 *   - The target's ancestor chain contains a node that is sized by its own
 *     children (layoutSizing === 'hug' or auto-layout enabled)
 *   - AND that ancestor's size depends on `targetId` transitively through
 *     the layout flow
 */
export function checkLayoutCycle(doc: Document, targetId: NodeId): CycleCheckResult {
  const target = doc.nodes[targetId];
  if (!target) {
    return { verdict: 'no_cycle', cycle: [], description: 'Target node not found' };
  }

  // Only fill-sized nodes can create a cycle
  if (target.layoutSizing !== 'fill') {
    return { verdict: 'no_cycle', cycle: [], description: 'Not a fill-sized node' };
  }

  // Walk the ancestor chain looking for hug-sized containers
  const visited: NodeId[] = [targetId];
  let currentId: NodeId | null = getParent(doc, targetId);

  while (currentId) {
    visited.push(currentId);
    const current = doc.nodes[currentId];

    if (!current) {
      break;
    }

    // A container with layoutSizing 'hug' and auto-layout enabled is sized
    // by its children — fill-sized children create a cycle
    const hasAutoLayout = current.kind === 'frame' && current.layoutStyle !== undefined;

    if (hasAutoLayout && current.layoutSizing === 'hug') {
      // Check if target is a direct layout child of this container
      const children = ('children' in current ? current.children : undefined) ?? [];
      if (children.includes(targetId)) {
        // The fill-sized child is a direct child of a hug-sized container:
        // child wants to fill parent, parent wants to hug child — cycle
        const description =
          `"${target.name ?? targetId}" has layoutSizing 'fill' inside ` +
          `"${current.name ?? currentId}" which has layoutSizing 'hug'. ` +
          `The parent cannot size to fit its children while a child fills the parent.`;
        return { verdict: 'cycle_detected', cycle: [...visited], description };
      }

      // Indirect cycle: the fill child is nested deeper inside a hug container
      const isDescendantOfCurrent = isAncestorOf(doc, currentId, targetId, visited);
      if (isDescendantOfCurrent) {
        const description =
          `Layout cycle detected: "${target.name ?? targetId}" (fill) is a descendant ` +
          `of "${current.name ?? currentId}" (hug), creating a circular dependency.`;
        return { verdict: 'cycle_detected', cycle: [...visited], description };
      }
    }

    currentId = getParent(doc, currentId);
  }

  return { verdict: 'no_cycle', cycle: [], description: 'No layout cycle detected' };
}

/** Check if `ancestorId` is an ancestor of `nodeId` in the scene tree. */
function isAncestorOf(
  doc: Document,
  ancestorId: NodeId,
  nodeId: NodeId,
  exclude: NodeId[],
): boolean {
  let current: NodeId | null = getParent(doc, nodeId);
  while (current) {
    if (current === ancestorId) return true;
    if (exclude.includes(current)) return false; // reached already-visited boundary
    current = getParent(doc, current);
  }
  return false;
}
