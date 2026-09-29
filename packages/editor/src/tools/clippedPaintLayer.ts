import {
  addChild,
  addMask,
  canBeMatteSource,
  type Document,
  makeGroupNode,
  makeRasterLayerNode,
  type NodeId,
  nextNodeId,
  nodeWorldTransform,
  type RasterLayerNode,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { multiplyAffine, tryInvertAffine } from '@varve/shared';
import {
  activeWorkspaceContentRoot,
  addNodeToActiveWorkspace,
  isPublishingPageSurface,
} from '../scene/activeWorkspace';

export type ClippedPaintLayerResult =
  | { ok: true; document: Document; groupId: NodeId; layerId: NodeId }
  | { ok: false; reason: string };

type WorldTransform = (nodeId: NodeId) => Affine;

function parentIndex(document: Document): Map<NodeId, NodeId> {
  const parents = new Map<NodeId, NodeId>();
  for (const [parentId, candidate] of Object.entries(document.nodes)) {
    if (!('children' in candidate) || !Array.isArray(candidate.children)) continue;
    for (const childId of candidate.children) {
      if (document.nodes[childId] && !parents.has(childId)) parents.set(childId, parentId);
    }
  }
  return parents;
}

function isActiveSurfaceDescendant(document: Document, sourceId: NodeId, rootId: NodeId): boolean {
  const parents = parentIndex(document);
  const visited = new Set<NodeId>();
  let currentId: NodeId | undefined = sourceId;
  while (currentId) {
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    const current = document.nodes[currentId];
    if (!current || current.visible === false) return false;
    if (currentId === rootId) return true;
    currentId = parents.get(currentId);
  }
  return false;
}

function currentWorkspaceRoot(document: Document, workspaceMode: string): NodeId | null {
  const rootId = activeWorkspaceContentRoot(document, workspaceMode);
  if (!rootId || !document.nodes[rootId]) return null;
  if (
    isPublishingPageSurface(document, workspaceMode) &&
    !document.pages?.some((page) => page.id === document.activePageId)
  ) {
    return null;
  }
  return rootId;
}

/**
 * Create a raster paint layer whose group alpha is tied to a visible raster
 * source. The group path is used because live scene-node mattes are currently
 * supported on containers, while leaf raster masks accept pixel/vector masks.
 */
export function createClippedPaintLayer(
  document: Document,
  workspaceMode: string,
  sourceId: NodeId,
  getWorldTransform?: WorldTransform,
): ClippedPaintLayerResult {
  const source = document.nodes[sourceId];
  if (!source) return { ok: false, reason: 'The selected source layer no longer exists.' };
  if (source.kind !== 'rasterLayer' || !canBeMatteSource(source)) {
    return { ok: false, reason: 'Select a raster paint layer to use as the clipping source.' };
  }

  const rootId = currentWorkspaceRoot(document, workspaceMode);
  const root = rootId ? document.nodes[rootId] : undefined;
  if (!rootId || !root || !('children' in root)) {
    return { ok: false, reason: 'The active canvas or page is unavailable.' };
  }
  if (root.visible === false || root.locked === true) {
    return { ok: false, reason: 'The active canvas or page is hidden or locked.' };
  }
  if (!isActiveSurfaceDescendant(document, sourceId, rootId)) {
    return {
      ok: false,
      reason: 'The clipping source must be visible on the active canvas or page.',
    };
  }

  let sourceWorld: Affine;
  let rootWorld: Affine;
  try {
    sourceWorld = getWorldTransform?.(sourceId) ?? nodeWorldTransform(document, sourceId);
    rootWorld = getWorldTransform?.(rootId) ?? nodeWorldTransform(document, rootId);
  } catch {
    return { ok: false, reason: 'The clipping source has an invalid transform.' };
  }
  const rootInverse = tryInvertAffine(rootWorld);
  if (!rootInverse || !tryInvertAffine(sourceWorld)) {
    return { ok: false, reason: 'The clipping source has an invalid transform.' };
  }
  const layerTransform = multiplyAffine(rootInverse, sourceWorld);

  const { id: groupId, doc: withGroupId } = nextNodeId(document);
  const { id: layerId, doc: withLayerId } = nextNodeId(withGroupId);
  const sourceName = (source as RasterLayerNode).name?.trim() || 'Paint Layer';
  const group = makeGroupNode(groupId, { name: `${sourceName} clipped paint` });
  const layer = makeRasterLayerNode(
    layerId,
    { width: source.width, height: source.height },
    { name: 'Shading' },
  );
  layer.transform = layerTransform;

  const withGroup = addNodeToActiveWorkspace(withLayerId, group, workspaceMode);
  const withLayer = addChild(withGroup, groupId, layer);
  const masked = addMask(withLayer, groupId, undefined, 'alpha', {
    matteSource: { kind: 'scene-node', nodeId: sourceId },
    hideMaskSource: true,
  });
  if (
    masked === withLayer ||
    masked.nodes[groupId]?.kind !== 'group' ||
    !masked.nodes[groupId].mask
  ) {
    return { ok: false, reason: 'Varve could not attach the live alpha clipping mask.' };
  }
  return { ok: true, document: masked, groupId, layerId };
}
