import { type Document, designCanvasContentRoot, type NodeId } from '@varve/scene';
import type { Point } from '@varve/shared';
import type { ParentIndexCache } from '../../scene/parentIndexCache';
import { nodeWorldTransform, worldToParent } from '../../scene/world';
import { canonicalizeMoveIds } from '../LayersPanel/layerMovePlan';

export interface CanvasDropPosition {
  id: NodeId;
  x: number;
  y: number;
}

/**
 * Resolve the roots travelling from Layers to the canvas. Descendants of a
 * selected ancestor travel inside that ancestor; selection-array order never
 * decides the resulting stacking order.
 */
export function resolveCanvasMoveIds(
  doc: Document,
  selection: NodeId[],
  activeId: NodeId,
  parentCache?: ParentIndexCache | null,
): NodeId[] {
  return canonicalizeMoveIds(doc, selection, activeId, parentCache);
}

/**
 * Place a set of layer roots around the first root's world-space origin while
 * preserving their relative offsets. The returned coordinates are local to
 * the destination parent, so rotated/scaled page or design-canvas roots are
 * handled by the same world/parent conversion used by ordinary reparenting.
 *
 * This computes only translation. `reparentNode` preserves each root's linear
 * transform, including rotation, scale, and flips; `setNodePosition` then
 * updates its translation without flattening that transform.
 */
export function computeCanvasDropPositions(
  doc: Document,
  moveIds: NodeId[],
  dropWorld: Point,
  destinationParentId: NodeId | null,
  parentIndex?: Map<NodeId, NodeId>,
): CanvasDropPosition[] | null {
  const anchorId = moveIds[0];
  if (!anchorId || !doc.nodes[anchorId]) return null;

  const anchorWorld = nodeWorldTransform(doc, anchorId, parentIndex);
  const deltaX = dropWorld[0] - anchorWorld[4];
  const deltaY = dropWorld[1] - anchorWorld[5];
  const positions: CanvasDropPosition[] = [];

  for (const id of moveIds) {
    if (!doc.nodes[id]) return null;
    const world = nodeWorldTransform(doc, id, parentIndex);
    const desired: Point = [world[4] + deltaX, world[5] + deltaY];
    const local = destinationParentId
      ? worldToParent(doc, destinationParentId, desired, parentIndex)
      : desired;
    if (!local || !Number.isFinite(local[0]) || !Number.isFinite(local[1])) return null;
    positions.push({ id, x: local[0], y: local[1] });
  }

  return positions;
}

/** Resolve the same effective root used by EditorContext.reparentNode(null). */
export function resolveCanvasContentRoot(doc: Document, workspaceMode: string): NodeId | null {
  if (workspaceMode !== 'print') return designCanvasContentRoot(doc);
  return doc.pages?.find((page) => page.id === doc.activePageId)?.contentRoot ?? null;
}
