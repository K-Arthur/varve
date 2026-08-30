/**
 * Resolve the child-array insertion index for a drop inside its existing
 * flex container. The scene's child order is the layout order; canvas
 * geometry is used only to infer the user's intended slot.
 */
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { nodeWorldBounds } from '../scene/world';

interface FlowEntry {
  id: NodeId;
  primary: number;
  cross: number;
}

function isFlowChild(node: SceneNode): boolean {
  return node.visible !== false && node.layoutPosition !== 'absolute';
}

/**
 * Return the `FrameNode.children` index to use after removing `movingId`, or
 * null when the drop cannot change flow order. Absolute and hidden children
 * keep their authored positions and never become drag-reorder targets.
 */
export function layoutDropInsertionIndex(
  doc: Document,
  frameId: NodeId,
  movingId: NodeId,
  dropCenter: { x: number; y: number },
): number | null {
  const frame = doc.nodes[frameId];
  const moving = doc.nodes[movingId];
  if (frame?.kind !== 'frame' || !frame.layoutStyle || !moving || !isFlowChild(moving)) return null;
  if (!frame.children.includes(movingId)) return null;

  const row = frame.layoutStyle.direction === 'row' || frame.layoutStyle.direction === 'rowReverse';
  const reverse =
    frame.layoutStyle.direction === 'rowReverse' || frame.layoutStyle.direction === 'columnReverse';
  const flowEntries: FlowEntry[] = [];

  for (const id of frame.children) {
    if (id === movingId) continue;
    const child = doc.nodes[id];
    if (!child || !isFlowChild(child)) continue;
    const bounds = nodeWorldBounds(doc, id);
    if (!bounds) continue;
    flowEntries.push({
      id,
      primary: row ? bounds.x + bounds.w / 2 : bounds.y + bounds.h / 2,
      cross: row ? bounds.y + bounds.h / 2 : bounds.x + bounds.w / 2,
    });
  }
  if (flowEntries.length === 0) return null;

  // For wrapping layouts, cross-axis ordering groups rows/columns before
  // ordering within each line. Reverse directions reverse only the primary
  // axis, exactly like the flex engine.
  const direction = reverse ? -1 : 1;
  flowEntries.sort((a, b) => {
    const crossDelta = a.cross - b.cross;
    if (Math.abs(crossDelta) > 1) return crossDelta;
    return direction * (a.primary - b.primary);
  });

  const dropPrimary = row ? dropCenter.x : dropCenter.y;
  const dropCross = row ? dropCenter.y : dropCenter.x;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < flowEntries.length; i++) {
    const entry = flowEntries[i]!;
    const distance = (dropPrimary - entry.primary) ** 2 + (dropCross - entry.cross) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = i;
    }
  }

  const nearest = flowEntries[nearestIndex]!;
  const beforeNearest = direction * (dropPrimary - nearest.primary) < 0;
  const beforeId = flowEntries[nearestIndex + (beforeNearest ? 0 : 1)]?.id;
  const childrenWithoutMoving = frame.children.filter((id) => id !== movingId);
  if (beforeId) return childrenWithoutMoving.indexOf(beforeId);

  const lastFlowIndex = childrenWithoutMoving.reduce(
    (last, id, index) => (flowEntries.some((entry) => entry.id === id) ? index : last),
    -1,
  );
  return lastFlowIndex + 1;
}
