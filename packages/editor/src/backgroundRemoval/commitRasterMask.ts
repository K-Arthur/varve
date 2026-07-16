/**
 * commitRasterMask — commit background removal masks as native RasterMaskAssets.
 *
 * No new code may write to the legacy ShapeNode.backgroundRemoval field.
 * All mask data goes through the native raster mask pipeline:
 *   Document.rasterMaskAssets + NodeBase.mask.rasterMask
 *
 * First commit for a node creates a stable asset ID (mask-{nodeId}).
 * Subsequent commits create versioned IDs (mask-{nodeId}-v{N}) because
 * the asset system treats assets as immutable by ID.
 *
 * Research basis: Figma non-destructive pixel masks, ADR-0005 offline-first
 * asset model, immutable Document pattern.
 */
import type { BackgroundRemovalProvenance, Document, NodeId, RasterMaskAsset } from '@strata/scene';
import {
  addRasterMaskAsset,
  removeRasterMaskAsset,
  updateRasterMaskAsset,
} from '@strata/scene';

export interface RasterMaskCommitFields {
  dataUrl: string;
  width: number;
  height: number;
  method?: string;
  runtime?: string;
  generatedAt?: number;
  confidence?: number;
  decontaminate?: boolean;
}

function dataUrlByteLength(dataUrl: string): number {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return 0;
  const base64 = dataUrl.slice(prefix.length);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function makeProvenance(
  fields: RasterMaskCommitFields,
): BackgroundRemovalProvenance | undefined {
  if (!fields.method && !fields.generatedAt) return undefined;
  return {
    method: (fields.method ?? 'quick') as 'quick' | 'ai-balanced' | 'ai-quality',
    runtime: 'typescript',
    generatedAt: fields.generatedAt ?? Date.now(),
    origin: 'native',
    ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
    ...(fields.decontaminate !== undefined ? { decontaminate: fields.decontaminate } : {}),
    ...(fields.runtime !== undefined ? { modelVersion: fields.runtime } : {}),
  };
}

function makeAsset(assetId: string, fields: RasterMaskCommitFields): RasterMaskAsset {
  return {
    id: assetId,
    mimeType: 'image/png',
    dataUrl: fields.dataUrl,
    width: fields.width,
    height: fields.height,
    byteLength: dataUrlByteLength(fields.dataUrl),
  };
}

/**
 * Commit a raster mask to the document as a native RasterMaskAsset.
 *
 * - First call: creates a stable `mask-{nodeId}` asset.
 * - Subsequent calls: creates a versioned `mask-{nodeId}-v{rev}` asset
 *   and updates the node reference, because the asset system treats
 *   assets as immutable by ID.
 *
 * The asset dimensions must match the source image fill dimensions
 * (enforced by validateSourcePixelDimensions). Callers must ensure
 * fields.width/height match the source image's natural dimensions.
 */
export function commitRasterMask(
  doc: Document,
  nodeId: NodeId,
  fields: RasterMaskCommitFields,
): Document {
  const node = doc.nodes[nodeId];
  const existingMask = node?.mask?.rasterMask;

  if (existingMask) {
    const currentRev = existingMask.editRevision ?? 0;
    const newRev = currentRev + 1;
    const assetId = `mask-${nodeId}-v${newRev}`;
    const asset = makeAsset(assetId, fields);
    return updateRasterMaskAsset(doc, nodeId, asset);
  }

  const asset = makeAsset(`mask-${nodeId}`, fields);
  return addRasterMaskAsset(doc, nodeId, asset, {
    provenance: makeProvenance(fields),
    editRevision: 1,
  });
}

/**
 * Remove a raster mask from a node, cleaning up the asset if unreferenced.
 */
export function removeRasterMaskFromNode(doc: Document, nodeId: NodeId): Document {
  return removeRasterMaskAsset(doc, nodeId);
}

/**
 * Check whether a node has a native raster mask attached.
 */
export function hasNativeRasterMask(doc: Document, nodeId: NodeId): boolean {
  const node = doc.nodes[nodeId];
  return Boolean(node?.mask?.rasterMask);
}
