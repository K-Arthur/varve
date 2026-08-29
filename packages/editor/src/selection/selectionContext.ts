/**
 * Shared semantic selection context for Canvas, Layers, and Inspector
 * presentation surfaces.
 *
 * Selection is stored as IDs in EditorState. Consumers should not each
 * reconstruct the primary node or ancestor path: stale IDs, page content
 * roots, and export regions all need the same interpretation everywhere.
 */
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { isContainer, isExportRegion } from '@varve/scene';
import { getOrCreateParentCache, getParentFast } from '../scene/parentIndexCache';

export type SelectionContextKind = 'empty' | 'single' | 'multi';

export interface SelectionHierarchyEntry {
  id: NodeId;
  name: string;
  /** Export regions are frame nodes in storage, but have their own UI identity. */
  kind: string;
  isContainer: boolean;
  node: SceneNode;
}

export interface SelectionContextModel {
  /** Existing, unique node IDs in their stored selection order. */
  ids: NodeId[];
  nodes: SceneNode[];
  kind: SelectionContextKind;
  count: number;
  /** Primary selection, repaired to the first live selected node when stale. */
  primaryId: NodeId | null;
  primaryNode: SceneNode | null;
  /** Structural ancestors for the primary node, excluding page/master roots. */
  hierarchy: SelectionHierarchyEntry[];
}

/**
 * Resolve the node that represents a selection in navigation-oriented UI.
 * Primary selection wins when it is still selected and present in the
 * document; otherwise the first live selected node is a safe fallback.
 */
export function resolvePrimarySelectionId(
  doc: Document,
  selection: readonly NodeId[],
  primaryId: NodeId | null,
): NodeId | null {
  if (primaryId && selection.includes(primaryId) && doc.nodes[primaryId]) {
    return primaryId;
  }
  return selection.find((id) => Boolean(doc.nodes[id])) ?? null;
}

/**
 * Build the canonical selection projection consumed by selection UI.
 *
 * The editor intentionally keeps selection IDs lightweight and ephemeral, so
 * a document mutation can briefly leave an ID stale. This projection filters
 * those IDs and repairs the primary target without mutating EditorState.
 */
export function buildSelectionContext(
  doc: Document,
  selection: readonly NodeId[],
  primaryId: NodeId | null,
  activeContainerId: NodeId | null = null,
): SelectionContextModel {
  const ids: NodeId[] = [];
  const nodes: SceneNode[] = [];
  const seen = new Set<NodeId>();

  for (const id of selection) {
    if (seen.has(id)) continue;
    const node = doc.nodes[id];
    if (!node) continue;
    seen.add(id);
    ids.push(id);
    nodes.push(node);
  }

  const resolvedPrimaryId = resolvePrimarySelectionId(doc, ids, primaryId);
  const primaryNode = resolvedPrimaryId ? (doc.nodes[resolvedPrimaryId] ?? null) : null;
  const hierarchyTargetId = resolvedPrimaryId ?? resolveActiveContainerId(doc, activeContainerId);

  return {
    ids,
    nodes,
    kind: ids.length === 0 ? 'empty' : ids.length === 1 ? 'single' : 'multi',
    count: ids.length,
    primaryId: resolvedPrimaryId,
    primaryNode,
    hierarchy: hierarchyTargetId ? buildSelectionHierarchy(doc, hierarchyTargetId) : [],
  };
}

/**
 * Return the displayable node path from the nearest structural root to a
 * selected node. Page and master content roots are storage scaffolding, not
 * user-facing layers, so they are intentionally omitted.
 */
export function buildSelectionHierarchy(doc: Document, nodeId: NodeId): SelectionHierarchyEntry[] {
  if (!doc.nodes[nodeId]) return [];

  const structuralRootIds = new Set<NodeId>([
    ...(doc.pages?.map((page) => page.contentRoot) ?? []),
    ...Object.values(doc.masters ?? {}).map((master) => master.contentRoot),
  ]);
  const parentCache = getOrCreateParentCache(doc, null);
  const chain: NodeId[] = [];
  const visited = new Set<NodeId>();
  let current: NodeId | null = nodeId;

  while (current && !visited.has(current)) {
    visited.add(current);
    chain.unshift(current);
    current = getParentFast(doc, current, parentCache);
  }

  return chain.flatMap((id) => {
    const node = doc.nodes[id];
    if (!node || structuralRootIds.has(id)) return [];
    return [
      {
        id,
        name: node.name || node.kind,
        kind: isExportRegion(node) ? 'exportRegion' : node.kind,
        isContainer: isContainer(node) && !isExportRegion(node),
        node,
      },
    ];
  });
}

/** Resolve an isolation/container target only when it still exists. */
function resolveActiveContainerId(doc: Document, id: NodeId | null): NodeId | null {
  return id && doc.nodes[id] ? id : null;
}
