import {
  buildParentIndexMap,
  type Document,
  getParent,
  type NodeId,
  resolveAdjustmentScope,
  type SceneNode,
} from '@varve/scene';
import type { Rect } from '@varve/shared';
import { nodeWorldBounds } from '../scene/world';

export interface NavigationBoundsOptions {
  /** Roots belonging to the currently active page/design canvas. */
  activeSurfaceRootIds?: readonly NodeId[];
}

export interface NavigationBoundsResult {
  bounds: Rect | null;
  /** Useful for non-drawable rows such as empty adjustment layers. */
  reason: 'resolved' | 'no-visible-content' | 'invalid-target';
  targetIds: NodeId[];
}

export function activeSurfaceRootIds(doc: Document, workspaceMode: string): NodeId[] {
  if (workspaceMode === 'print') {
    const root = doc.pages?.find((page) => page.id === doc.activePageId)?.contentRoot;
    return root ? [root] : [];
  }
  const root = doc.designCanvases?.find(
    (canvas) => canvas.id === doc.activeDesignCanvasId,
  )?.contentRoot;
  return root ? [root] : [];
}

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!b) return a;
  if (!a) return { ...b };
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.w, b.x + b.w);
  const maxY = Math.max(a.y + a.h, b.y + b.h);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function isInActiveSurface(
  doc: Document,
  id: NodeId,
  roots: ReadonlySet<NodeId>,
  parentIndex: Map<NodeId, NodeId>,
): boolean {
  if (roots.size === 0) return true;
  let current: NodeId | null = id;
  const visited = new Set<NodeId>();
  while (current && !visited.has(current)) {
    if (roots.has(current)) return true;
    visited.add(current);
    current = parentIndex.get(current) ?? getParent(doc, current);
  }
  return false;
}

function resolveTargetIds(
  doc: Document,
  id: NodeId,
  node: SceneNode,
  activeRoots: ReadonlySet<NodeId>,
  parentIndex: Map<NodeId, NodeId>,
): NodeId[] {
  if (node.kind !== 'adjustment') return [id];
  return resolveAdjustmentScope(doc, node.scope, id).filter((targetId) =>
    isInActiveSurface(doc, targetId, activeRoots, parentIndex),
  );
}

/**
 * Resolve navigation bounds through the canonical scene geometry service.
 * Adjustment rows navigate to their affected content on the active surface;
 * they never fabricate a rectangle from the adjustment node's transform.
 */
export function resolveNavigationBounds(
  doc: Document,
  nodeIds: readonly NodeId[],
  options: NavigationBoundsOptions = {},
): NavigationBoundsResult {
  if (nodeIds.length === 0) {
    return { bounds: null, reason: 'invalid-target', targetIds: [] };
  }

  const parentIndex = buildParentIndexMap(doc);
  const activeRoots = new Set(options.activeSurfaceRootIds ?? []);
  const targetIds: NodeId[] = [];
  let bounds: Rect | null = null;

  for (const id of nodeIds) {
    const node = doc.nodes[id];
    if (!node) continue;
    const resolvedIds = resolveTargetIds(doc, id, node, activeRoots, parentIndex);
    for (const targetId of resolvedIds) {
      if (targetIds.includes(targetId)) continue;
      const target = doc.nodes[targetId];
      if (!target) continue;
      targetIds.push(targetId);
      bounds = unionRect(bounds, nodeWorldBounds(doc, targetId, parentIndex));
    }
  }

  return {
    bounds,
    reason: bounds ? 'resolved' : targetIds.length > 0 ? 'no-visible-content' : 'invalid-target',
    targetIds,
  };
}
