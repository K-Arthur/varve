import type { Constraints, Document, NodeId, SceneNode } from '@strata/scene';
import { isContainer } from '@strata/scene';
import { getParentFast } from '../scene/parentIndexCache';
import { nodeWorldBounds } from '../scene/world';

export interface ConstraintSuggestion {
  nodeId: NodeId;
  constraints: Constraints;
  confidence: number;
  reason: string;
}

/** Tolerance for edge alignment detection (in parent-local units) */
const EDGE_TOLERANCE = 4;

/**
 * Suggest responsive constraints for a node based on its position
 * and size relative to its parent frame.
 */
export function suggestConstraint(doc: Document, nodeId: NodeId): ConstraintSuggestion | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;

  const parentId = getParentFast(doc, nodeId);
  if (!parentId) return null;

  const parent = doc.nodes[parentId];
  if (!parent || !isContainer(parent)) return null;
  if (parent.kind !== 'frame') return null;

  const parentW = (parent as import('@strata/scene').FrameNode).w || 400;
  const parentH = (parent as import('@strata/scene').FrameNode).h || 300;

  // Get the node's local position and size
  const bounds = nodeWorldBounds(doc, nodeId);
  if (!bounds) return null;

  const localX = node.transform[4] ?? 0;
  const localY = node.transform[5] ?? 0;
  const localW = getNodeWidth(node);
  const localH = getNodeHeight(node);

  if (localW <= 0 || localH <= 0) return null;

  // Detect which edges are close to the parent edges
  const nearLeft = localX <= EDGE_TOLERANCE;
  const nearRight = Math.abs(parentW - (localX + localW)) <= EDGE_TOLERANCE;
  const nearTop = localY <= EDGE_TOLERANCE;
  const nearBottom = Math.abs(parentH - (localY + localH)) <= EDGE_TOLERANCE;

  const edgeCount =
    (nearLeft ? 1 : 0) + (nearRight ? 1 : 0) + (nearTop ? 1 : 0) + (nearBottom ? 1 : 0);
  const hSpan = localW >= parentW * 0.8;
  const vSpan = localH >= parentH * 0.8;
  const hCenter = Math.abs(localX + localW / 2 - parentW / 2) <= EDGE_TOLERANCE;
  const vCenter = Math.abs(localY + localH / 2 - parentH / 2) <= EDGE_TOLERANCE;

  // Determine horizontal constraint
  let horizontal: 'min' | 'max' | 'center' | 'stretch' | 'scale';
  let hReason: string;

  if (hSpan && nearLeft && nearRight) {
    horizontal = 'stretch';
    hReason = 'spans full width, pinned to both edges';
  } else if (nearLeft && nearRight) {
    horizontal = 'stretch';
    hReason = 'close to both left and right edges';
  } else if (nearLeft) {
    horizontal = 'min';
    hReason = 'pinned to left edge';
  } else if (nearRight) {
    horizontal = 'max';
    hReason = 'pinned to right edge';
  } else if (hCenter) {
    horizontal = 'center';
    hReason = 'centered horizontally';
  } else {
    horizontal = 'min';
    hReason = 'no strong edge alignment detected';
  }

  // Determine vertical constraint
  let vertical: 'min' | 'max' | 'center' | 'stretch' | 'scale';
  let vReason: string;

  if (vSpan && nearTop && nearBottom) {
    vertical = 'stretch';
    vReason = 'spans full height, pinned to both edges';
  } else if (nearTop && nearBottom) {
    vertical = 'stretch';
    vReason = 'close to both top and bottom edges';
  } else if (nearTop) {
    vertical = 'min';
    vReason = 'pinned to top edge';
  } else if (nearBottom) {
    vertical = 'max';
    vReason = 'pinned to bottom edge';
  } else if (vCenter) {
    vertical = 'center';
    vReason = 'centered vertically';
  } else {
    vertical = 'min';
    vReason = 'no strong edge alignment detected';
  }

  // Compute confidence: higher when more edges are clearly aligned
  const confidence = Math.min(1, 0.4 + edgeCount * 0.15);
  const reason = `${hReason}, ${vReason}`;

  return {
    nodeId,
    constraints: { horizontal, vertical },
    confidence,
    reason,
  };
}

function getNodeWidth(node: SceneNode): number {
  if (node.kind === 'frame' || node.kind === 'text') return (node as { w: number }).w || 0;
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect') return s.w;
    if (s.kind === 'ellipse') return s.rx * 2;
    if (s.kind === 'circle') return s.r * 2;
  }
  return 0;
}

function getNodeHeight(node: SceneNode): number {
  if (node.kind === 'frame' || node.kind === 'text') return (node as { h: number }).h || 0;
  if (node.kind === 'shape') {
    const s = node.shape;
    if (s.kind === 'rect') return s.h;
    if (s.kind === 'ellipse') return s.ry * 2;
    if (s.kind === 'circle') return s.r * 2;
  }
  return 0;
}

/**
 * Suggest constraints for multiple selected nodes.
 * Returns suggestions only for nodes inside frames.
 */
export function suggestConstraintsForSelection(
  doc: Document,
  nodeIds: NodeId[],
): ConstraintSuggestion[] {
  const suggestions: ConstraintSuggestion[] = [];
  for (const id of nodeIds) {
    const suggestion = suggestConstraint(doc, id);
    if (suggestion) suggestions.push(suggestion);
  }
  return suggestions;
}
