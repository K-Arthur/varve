/**
 * Mask resolution for leaf outputs and structural containers.
 *
 * Kept apart from mutation code so rendering eligibility stays small,
 * explicit, and reusable without growing the mask CRUD hub.
 */

import type { Document } from './document';
import { canReceiveRasterMask, isVisualMaskTarget } from './maskCapability';
import { resolveNodePaints } from './paint';
import type { Mask, RasterMaskAsset, SceneNode, ShapeNode } from './types';

function isContainerMaskOwner(
  node: SceneNode,
): node is SceneNode & { mask?: Mask; children: string[] } {
  return node.kind === 'frame' || node.kind === 'group' || node.kind === 'adjustment';
}

export function resolvedImageMaskFill(doc: Pick<Document, 'paints'>, node: SceneNode) {
  if (node.kind !== 'shape') return undefined;
  return resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc).find(
    (fill) => fill.type === 'image' && fill.image,
  )?.image;
}

export function isImageMaskTarget(
  doc: Pick<Document, 'paints'>,
  node: SceneNode,
): node is ShapeNode {
  return node.kind === 'shape' && Boolean(resolvedImageMaskFill(doc, node));
}

export function resolveNodeMask(
  node: SceneNode,
  validateMaskSource: (doc: Document | undefined, mask: Mask) => string | null,
): Mask | null {
  if (!node.mask || node.mask.visible === false || validateMaskSource(undefined, node.mask)) {
    return null;
  }
  if (isVisualMaskTarget(node)) {
    return node.mask.vectorMask?.points.length || node.mask.rasterMask || node.mask.matteSource
      ? node.mask
      : null;
  }
  if (!isContainerMaskOwner(node)) return null;
  if (node.mask.vectorMask?.points.length || node.mask.matteSource || node.mask.rasterMask) {
    return node.mask;
  }
  if (!node.mask.sourceNodeId) return null;
  return node.kind === 'adjustment' || node.children.includes(node.mask.sourceNodeId)
    ? node.mask
    : null;
}

export function resolveNodeRasterMaskAsset(
  doc: Pick<Document, 'paints' | 'rasterMaskAssets'>,
  node: SceneNode,
  isValidAssetId: (assetId: string) => boolean,
  getAsset: (
    doc: Pick<Document, 'rasterMaskAssets'>,
    assetId: string,
  ) => RasterMaskAsset | undefined,
): RasterMaskAsset | null {
  const mask = node.mask;
  if (
    !mask?.rasterMask ||
    mask.type !== 'alpha' ||
    mask.visible === false ||
    'sourceNodeId' in mask ||
    'vectorMask' in mask ||
    !isValidAssetId(mask.rasterMask.assetId)
  ) {
    return null;
  }
  const coordinateSpace = mask.rasterMask.coordinateSpace;
  if (
    (coordinateSpace === 'source-image-pixels' && !isImageMaskTarget(doc, node)) ||
    (coordinateSpace === 'container-local-pixels' && node.kind !== 'frame') ||
    (coordinateSpace === 'node-local-pixels' && !isVisualMaskTarget(node)) ||
    !canReceiveRasterMask(node)
  ) {
    return null;
  }
  return getAsset(doc, mask.rasterMask.assetId) ?? null;
}
