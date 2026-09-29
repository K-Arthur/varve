import {
  addChild,
  addMask,
  canBeMatteSource,
  type Document,
  makeGroupNode,
  makeRasterLayerNode,
  type NodeId,
  nextNodeId,
  nodeLocalBounds,
  nodeWorldTransform,
} from '@varve/scene';
import type { Affine } from '@varve/shared';
import { multiplyAffine, scaleXY, translate, tryInvertAffine } from '@varve/shared';
import {
  activeWorkspaceContentRoot,
  addNodeToActiveWorkspace,
  isPublishingPageSurface,
} from '../scene/activeWorkspace';

export type ClippedPaintLayerResult =
  | { ok: true; document: Document; groupId: NodeId; layerId: NodeId }
  | { ok: false; reason: string };

type WorldTransform = (nodeId: NodeId) => Affine;

const MAX_CLIPPED_PAINT_SIDE = 16_384;
const MAX_CLIPPED_PAINT_PIXELS = 64 * 1024 * 1024;
const VECTOR_EDGE_PADDING = 2;

type PaintBounds = { width: number; height: number; localToWorld: Affine };

function clippedPaintBounds(
  document: Document,
  source: NonNullable<Document['nodes'][string]>,
  sourceWorld: Affine,
): PaintBounds | null {
  if (source.kind === 'rasterLayer') {
    return {
      width: source.width,
      height: source.height,
      localToWorld: sourceWorld,
    };
  }
  if (source.kind !== 'shape') return null;

  const bounds = nodeLocalBounds(source, document);
  if (
    !bounds ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.w) ||
    !Number.isFinite(bounds.h) ||
    bounds.w <= 0 ||
    bounds.h <= 0
  ) {
    return null;
  }

  // A small transparent margin keeps antialiased contour coverage and an
  // ordinary centered stroke from touching the raster layer's outer edge.
  const visibleStrokeOutset = Math.max(
    0,
    ...(source.strokes ?? [])
      .filter((stroke) => stroke.visible)
      .map((stroke) => {
        const sideWeight = stroke.perSideWeights
          ? Math.max(...stroke.perSideWeights)
          : stroke.weight;
        return (
          sideWeight *
          (stroke.align === 'outside' ? 1 : 0.5) *
          (stroke.join === 'miter' ? Math.max(1, stroke.miterLimit) : 1)
        );
      }),
  );
  const padding = Math.ceil(visibleStrokeOutset + VECTOR_EDGE_PADDING);
  const localWidth = bounds.w + padding * 2;
  const localHeight = bounds.h + padding * 2;
  const width = Math.ceil(localWidth);
  const height = Math.ceil(localHeight);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_CLIPPED_PAINT_SIDE ||
    height > MAX_CLIPPED_PAINT_SIDE ||
    width * height > MAX_CLIPPED_PAINT_PIXELS
  ) {
    return null;
  }

  const localPixelToSource = multiplyAffine(
    translate(bounds.x - padding, bounds.y - padding),
    scaleXY(localWidth / width, localHeight / height),
  );
  return {
    width,
    height,
    localToWorld: multiplyAffine(sourceWorld, localPixelToSource),
  };
}

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
 * Create an editable raster paint layer whose group alpha is tied to a visible
 * raster or vector shape source. The group path is used because live scene-node
 * mattes are supported on containers, while leaf masks use pixel/vector data.
 */
export function createClippedPaintLayer(
  document: Document,
  workspaceMode: string,
  sourceId: NodeId,
  getWorldTransform?: WorldTransform,
): ClippedPaintLayerResult {
  const source = document.nodes[sourceId];
  if (!source) return { ok: false, reason: 'The selected source layer no longer exists.' };
  if (!canBeMatteSource(source) || (source.kind !== 'rasterLayer' && source.kind !== 'shape')) {
    return {
      ok: false,
      reason: 'Select a visible raster layer or vector shape to use as the clipping source.',
    };
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
  const paintBounds = clippedPaintBounds(document, source, sourceWorld);
  if (!paintBounds) {
    return {
      ok: false,
      reason: 'The clipping source needs measurable bounds within the 16,384 px layer limit.',
    };
  }
  const layerTransform = multiplyAffine(rootInverse, paintBounds.localToWorld);

  const { id: groupId, doc: withGroupId } = nextNodeId(document);
  const { id: layerId, doc: withLayerId } = nextNodeId(withGroupId);
  const sourceName = source.name?.trim() || 'Paint Source';
  const group = makeGroupNode(groupId, { name: `${sourceName} clipped paint` });
  const layer = makeRasterLayerNode(
    layerId,
    { width: paintBounds.width, height: paintBounds.height },
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
