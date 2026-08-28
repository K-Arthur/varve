/**
 * Leaf-mask mutations kept outside the structural mask CRUD hub.
 *
 * Visual leaves own their mask on their rendered output, while frames and
 * groups own masks over a child composite. Keeping the leaf rules together
 * prevents the two coordinate-space contracts from drifting.
 */

import type { Document } from './document';
import { canReceiveLayerMask, canReceiveRasterMask, isVisualMaskTarget } from './maskCapability';
import { isImageMaskTarget } from './maskResolution';
import type {
  LiveMatteSource,
  Mask,
  MaskFillRule,
  MaskType,
  NodeId,
  RasterMaskAsset,
  RasterMaskData,
  RasterMaskSourceIdentity,
  SceneNode,
  ShapeNode,
  VectorMaskData,
} from './types';

interface RasterMaskAttachmentDeps {
  imageSourceIdentity: (
    doc: Pick<Document, 'paints'>,
    node: ShapeNode,
    revision: number,
  ) => RasterMaskSourceIdentity;
  validateAsset: (asset: RasterMaskAsset) => string | null;
  getAsset: (
    doc: Pick<Document, 'rasterMaskAssets'>,
    assetId: string,
  ) => RasterMaskAsset | undefined;
  assetsEqual: (left: RasterMaskAsset, right: RasterMaskAsset) => boolean;
  validateSource: (doc: Document | undefined, mask: Mask) => string | null;
  validateDimensions: (
    doc: Document,
    node: SceneNode,
    rasterMask: RasterMaskData,
    asset: RasterMaskAsset,
  ) => string | null;
  discardUnreferencedAsset: (doc: Document, assetId: string) => Document;
}

interface RasterMaskUpdateDeps {
  validateAsset: (asset: RasterMaskAsset) => string | null;
  getAsset: (
    doc: Pick<Document, 'rasterMaskAssets'>,
    assetId: string,
  ) => RasterMaskAsset | undefined;
  assetsEqual: (left: RasterMaskAsset, right: RasterMaskAsset) => boolean;
  validateDimensions: (
    doc: Document,
    node: SceneNode,
    rasterMask: RasterMaskData,
    asset: RasterMaskAsset,
  ) => string | null;
  discardUnreferencedAsset: (doc: Document, assetId: string) => Document;
}

export function attachRasterMaskAsset(
  deps: RasterMaskAttachmentDeps,
  doc: Document,
  nodeId: NodeId,
  asset: RasterMaskAsset,
  rasterMask: Partial<Omit<RasterMaskData, 'assetId' | 'coordinateSpace'>> | undefined,
  coordinateSpace: Exclude<RasterMaskData['coordinateSpace'], 'legacy-preview-pixels'>,
): Document {
  const node = doc.nodes[nodeId];
  const isImage = node !== undefined && isImageMaskTarget(doc, node);
  const isFrame = node?.kind === 'frame';
  if (!node || !canReceiveRasterMask(node) || deps.validateAsset(asset)) return doc;
  if (
    (coordinateSpace === 'node-local-pixels' && !isVisualMaskTarget(node)) ||
    (coordinateSpace === 'container-local-pixels' && !isFrame) ||
    (coordinateSpace === 'source-image-pixels' && !isImage)
  ) {
    return doc;
  }
  const existing = deps.getAsset(doc, asset.id);
  if (existing && !deps.assetsEqual(existing, asset)) return doc;

  const revision = rasterMask?.sourceIdentity?.revision ?? 1;
  const sourceIdentity =
    coordinateSpace === 'container-local-pixels'
      ? ({ kind: 'source-metadata', locator: 'container-local', revision } as const)
      : coordinateSpace === 'node-local-pixels'
        ? ({ kind: 'source-metadata', locator: `node-local:${nodeId}`, revision } as const)
        : (rasterMask?.sourceIdentity ??
          deps.imageSourceIdentity(doc, node as ShapeNode, revision));
  const maskData: RasterMaskData = {
    assetId: asset.id,
    coordinateSpace,
    sourceIdentity,
    ...(rasterMask?.editRevision !== undefined ? { editRevision: rasterMask.editRevision } : {}),
    ...(rasterMask?.staleReason !== undefined ? { staleReason: rasterMask.staleReason } : {}),
    ...(rasterMask?.provenance !== undefined ? { provenance: rasterMask.provenance } : {}),
  };
  const mask: Mask = { type: 'alpha', visible: true, rasterMask: maskData };
  const candidate = {
    ...doc,
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  if (
    deps.validateSource(candidate, mask) ||
    deps.validateDimensions(candidate, node, maskData, asset)
  ) {
    return doc;
  }

  const updated: Document = {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...node, mask } },
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  const priorAssetId = node.mask?.rasterMask?.assetId;
  return priorAssetId && priorAssetId !== asset.id
    ? deps.discardUnreferencedAsset(updated, priorAssetId)
    : updated;
}

export function isLeafMaskRequestValid(
  sourceNodeId: NodeId | undefined,
  type: MaskType,
  opts: { vectorMask?: VectorMaskData; matteSource?: LiveMatteSource } | undefined,
): boolean {
  return (
    !sourceNodeId &&
    Boolean(opts?.vectorMask || opts?.matteSource) &&
    !(opts?.matteSource && (type === 'clip' || opts.matteSource.kind === 'scene-node'))
  );
}

export function replaceRasterMaskAsset(
  deps: RasterMaskUpdateDeps,
  doc: Document,
  nodeId: NodeId,
  asset: RasterMaskAsset,
): Document {
  const node = doc.nodes[nodeId];
  const currentMask = node?.mask;
  const current = currentMask?.rasterMask;
  if (!node || !currentMask || !current || !canReceiveRasterMask(node)) return doc;
  if (deps.validateAsset(asset)) return doc;
  const existing = deps.getAsset(doc, asset.id);
  if (existing && !deps.assetsEqual(existing, asset)) return doc;
  if (current.assetId === asset.id && existing && deps.assetsEqual(existing, asset)) return doc;
  if (deps.validateDimensions(doc, node, current, asset)) return doc;
  const currentEditRevision = current.editRevision ?? 0;
  if (!Number.isSafeInteger(currentEditRevision) || currentEditRevision < 0) return doc;
  if (currentEditRevision === Number.MAX_SAFE_INTEGER) return doc;
  const updated: Document = {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        mask: {
          ...currentMask,
          rasterMask: {
            ...current,
            assetId: asset.id,
            editRevision: currentEditRevision + 1,
          },
        },
      },
    },
    rasterMaskAssets: { ...doc.rasterMaskAssets, [asset.id]: asset },
  };
  return deps.discardUnreferencedAsset(updated, current.assetId);
}

export function setNodeMaskVectorPath(
  doc: Document,
  nodeId: NodeId,
  points: import('@varve/engine').PathPoint[],
  closed: boolean,
  fillRule: MaskFillRule | undefined,
  removeMask: (doc: Document, nodeId: NodeId) => Document,
  updateMaskProperty: (
    doc: Document,
    nodeId: NodeId,
    key: string,
    value: VectorMaskData | undefined,
  ) => Document,
): Document {
  if (points.length === 0) {
    const node = doc.nodes[nodeId];
    if (!node || !canReceiveLayerMask(node) || !node.mask?.vectorMask) return doc;
    if (!node.mask.sourceNodeId && !node.mask.matteSource) return removeMask(doc, nodeId);
  }
  return updateMaskProperty(
    doc,
    nodeId,
    'vectorMask',
    points.length > 0 ? { points, closed, fillRule: fillRule ?? 'nonzero' } : undefined,
  );
}
