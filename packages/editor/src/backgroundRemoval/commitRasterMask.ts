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
import type { BackgroundRemovalProvenance, Document, NodeId, RasterMaskAsset } from '@varve/scene';
import {
  addRasterMaskAsset,
  removeRasterMaskAsset,
  resolveNodePaints,
  updateRasterMaskAsset,
} from '@varve/scene';

export interface RasterMaskCommitFields {
  dataUrl: string;
  width: number;
  height: number;
  method?: string;
  runtime?: BackgroundRemovalProvenance['runtime'];
  modelId?: string;
  modelVersion?: string;
  modelChecksum?: string;
  generatedAt?: number;
  confidence?: number;
  decontaminate?: boolean;
  /** Source locator and decoded dimensions captured with this mask. */
  sourceLocator?: string;
  /**
   * Pixel coordinate space of the committed mask. Defaults to
   * `source-image-pixels` (image shapes). Frames use
   * `container-local-pixels` (brush-painted layer masks).
   */
  coordinateSpace?: 'source-image-pixels' | 'container-local-pixels';
}

function dataUrlByteLength(dataUrl: string): number {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return 0;
  const base64 = dataUrl.slice(prefix.length);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function makeProvenance(fields: RasterMaskCommitFields): BackgroundRemovalProvenance | undefined {
  if (!fields.method && !fields.generatedAt) return undefined;
  return {
    method: (fields.method ?? 'quick') as 'quick' | 'ai-balanced' | 'ai-quality',
    runtime: fields.runtime ?? 'typescript',
    generatedAt: fields.generatedAt ?? Date.now(),
    origin: 'native',
    ...(fields.confidence !== undefined ? { confidence: fields.confidence } : {}),
    ...(fields.decontaminate !== undefined ? { decontaminate: fields.decontaminate } : {}),
    ...(fields.modelId !== undefined ? { modelId: fields.modelId } : {}),
    ...(fields.modelVersion !== undefined ? { modelVersion: fields.modelVersion } : {}),
    ...(fields.modelChecksum !== undefined ? { modelChecksum: fields.modelChecksum } : {}),
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
 * Keep cached image metadata aligned with the browser-decoded, orientation-
 * normalized pixels used for inference. Older imports could retain display
 * dimensions here, which made a valid full-resolution mask fail scene
 * validation during Apply. Referenced paints are detached to an equivalent
 * inline fill so correcting one image does not mutate every paint consumer.
 */
function normalizeSourceDimensions(
  doc: Document,
  nodeId: NodeId,
  fields: RasterMaskCommitFields,
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape') return doc;
  const fills = resolveNodePaints(node as unknown as Parameters<typeof resolveNodePaints>[0], doc);
  let found = false;
  let changed = false;
  const normalizedFills = fills.map((fill) => {
    if (
      found ||
      fill.type !== 'image' ||
      !fill.image ||
      (fields.sourceLocator !== undefined && fill.image.src !== fields.sourceLocator)
    ) {
      return fill;
    }
    found = true;
    if (fill.image.imageWidth === fields.width && fill.image.imageHeight === fields.height) {
      return fill;
    }
    changed = true;
    return {
      ...fill,
      image: { ...fill.image, imageWidth: fields.width, imageHeight: fields.height },
    };
  });
  if (!found || (!changed && !(node.paintRefs && node.paintRefs.length > 0))) return doc;
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [nodeId]: {
        ...node,
        fills: normalizedFills,
        ...(node.paintRefs && node.paintRefs.length > 0 ? { paintRefs: [] } : {}),
      },
    },
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
  const sourceAlignedDoc = normalizeSourceDimensions(doc, nodeId, fields);
  const node = sourceAlignedDoc.nodes[nodeId];
  const existingMask = node?.mask?.rasterMask;

  if (existingMask) {
    const currentRev = existingMask.editRevision ?? 0;
    const newRev = currentRev + 1;
    const assetId = `mask-${nodeId}-v${newRev}`;
    const asset = makeAsset(assetId, fields);
    const updated = updateRasterMaskAsset(sourceAlignedDoc, nodeId, asset);
    return updated === sourceAlignedDoc ? doc : updated;
  }

  const asset = makeAsset(`mask-${nodeId}`, fields);
  const updated = addRasterMaskAsset(
    sourceAlignedDoc,
    nodeId,
    asset,
    {
      provenance: makeProvenance(fields),
      editRevision: 1,
    },
    { coordinateSpace: fields.coordinateSpace },
  );
  return updated === sourceAlignedDoc ? doc : updated;
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
