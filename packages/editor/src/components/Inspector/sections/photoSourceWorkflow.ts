import { rangeRasterToSrgbBytes, toneMapReinhardGlobal } from '@varve/engine/hdr';
import type { RawRecipe } from '@varve/engine/raw';
import type {
  Document,
  DocumentAsset,
  ImageFillData,
  RasterLayerNode,
  SceneNode,
} from '@varve/scene';
import {
  addChild,
  createEmbeddedAsset,
  type EmbeddedAssetInput,
  getImageFill,
  getParent,
  insertNode,
  isImageShape,
  makeRasterLayerNode,
  makeRasterSourceLayer,
  nextNodeId,
} from '@varve/scene';
import { createRangeRaster, multiplyAffine, type RangeRaster } from '@varve/shared';

export const MAX_PHOTO_SOURCE_BYTES = 512 * 1024 * 1024;

/** Convert immutable file bytes to a persisted data URL without a spread/call-stack allocation. */
export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const end = Math.min(bytes.length, offset + chunkSize);
    let chunk = '';
    for (let index = offset; index < end; index++) chunk += String.fromCharCode(bytes[index]!);
    binary += chunk;
  }
  return `data:${mimeType || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** Decode an embedded data URL into bounded bytes for a local decoder. */
export function dataUrlToBytes(
  dataUrl: string,
  maxBytes: number = MAX_PHOTO_SOURCE_BYTES,
): Uint8Array {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Embedded source is not a data URL');
  const encoded = dataUrl.slice(comma + 1);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('Invalid source byte limit');
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    throw new Error(
      `Embedded source exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MiB limit`,
    );
  }
  const binary = atob(encoded);
  if (binary.length > maxBytes) {
    throw new Error(
      `Embedded source exceeds the ${(maxBytes / (1024 * 1024)).toFixed(0)} MiB limit`,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function fileToDataUrl(file: File): Promise<string> {
  if (file.size > MAX_PHOTO_SOURCE_BYTES) {
    throw new Error(
      `Source file exceeds the ${(MAX_PHOTO_SOURCE_BYTES / (1024 * 1024)).toFixed(0)} MiB limit`,
    );
  }
  return bytesToDataUrl(
    new Uint8Array(await file.arrayBuffer()),
    file.type || 'application/octet-stream',
  );
}

/** Make a disposable SDR PNG. The range-bearing input remains untouched. */
export interface SdrRenditionOptions {
  /** Scene exposure in stops, or display-linear output exposure. */
  exposureStops?: number;
  /** Positive display white scale for the explicit output transform. */
  whitePoint?: number;
}

export function rangeRasterToSdrPngDataUrl(
  source: RangeRaster,
  options: SdrRenditionOptions = {},
): string {
  if (typeof document === 'undefined') throw new Error('Image export requires a browser document');
  if (source.contract.reference === 'display-referred') {
    throw new Error('SDR rendition requires scene-linear or display-linear working data');
  }
  // Radiance/RAW masters need the explicit global tone map. Exposure fusion
  // already produces display-linear values; applying Reinhard again would be
  // an accidental second tone-map and would change its declared semantics.
  const display =
    source.contract.reference === 'scene-linear'
      ? toneMapReinhardGlobal(source, options).raster
      : applyDisplayExposure(source, options);
  const bytes = rangeRasterToSrgbBytes(display);
  const canvas = document.createElement('canvas');
  canvas.width = display.contract.width;
  canvas.height = display.contract.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('SDR preview canvas is unavailable');
  context.putImageData(
    new ImageData(bytes as unknown as ImageDataArray, canvas.width, canvas.height),
    0,
    0,
  );
  return canvas.toDataURL('image/png');
}

function applyDisplayExposure(source: RangeRaster, options: SdrRenditionOptions): RangeRaster {
  const exposureStops = options.exposureStops ?? 0;
  const whitePoint = options.whitePoint ?? 1;
  if (!Number.isFinite(exposureStops)) throw new Error('display exposure must be finite');
  if (!Number.isFinite(whitePoint) || whitePoint <= 0) {
    throw new Error('display white point must be positive and finite');
  }
  const multiplier = 2 ** exposureStops;
  const output = createRangeRaster({
    ...source.contract,
    stride: source.contract.width * 4,
    sampleType: 'float32',
    encoding: {
      ...source.contract.encoding,
      transfer: 'linear',
      bitDepth: 'float32',
      alphaMode: 'straight',
    },
    reference: 'display-linear',
    alphaMode: 'straight',
    provenance: 'derived-display-preview',
  });
  for (let y = 0; y < source.contract.height; y++) {
    for (let x = 0; x < source.contract.width; x++) {
      const sourceIndex = y * source.contract.stride + x * 4;
      const outputIndex = (y * source.contract.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const value = source.pixels[sourceIndex + channel]!;
        output.pixels[outputIndex + channel] = Number.isFinite(value)
          ? Math.max(0, (value * multiplier) / whitePoint)
          : 0;
      }
      const alpha = source.pixels[sourceIndex + 3]!;
      output.pixels[outputIndex + 3] = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 0;
    }
  }
  return output;
}

export function parseRawRecipe(value: unknown): RawRecipe | null {
  if (!isRecord(value)) return null;
  const numericKeys = [
    'exposureStops',
    'blackPoint',
    'whitePoint',
    'highlights',
    'shadows',
    'noiseReduction',
    'captureSharpening',
    'outputSharpening',
  ] as const;
  if (
    value.version !== 1 ||
    typeof value.decoderId !== 'string' ||
    (value.profile !== 'camera-matrix' && value.profile !== 'srgb-d65') ||
    (value.whiteBalance !== 'as-shot' && value.whiteBalance !== 'custom') ||
    value.demosaic !== 'bilinear-bayer' ||
    (value.cameraMatrix !== undefined &&
      !['auto', 'color-matrix-1', 'color-matrix-2'].includes(value.cameraMatrix as string)) ||
    (value.lensCorrection !== 'none' && value.lensCorrection !== 'lensfun-if-available') ||
    ![1, 2, 3, 4, 5, 6, 7, 8].includes(value.orientation as number) ||
    numericKeys.some((key) => typeof value[key] !== 'number' || !Number.isFinite(value[key]))
  ) {
    return null;
  }
  if (
    value.customMultipliers !== undefined &&
    (!Array.isArray(value.customMultipliers) ||
      value.customMultipliers.length !== 3 ||
      value.customMultipliers.some((item) => typeof item !== 'number' || !Number.isFinite(item)))
  ) {
    return null;
  }
  return value as unknown as RawRecipe;
}

export interface PhotoAssetSet {
  sourceAsset: DocumentAsset;
  derivedAsset: DocumentAsset;
  document: Document;
}

export interface RetouchLayerSet {
  document: Document;
  sourceNodeId: string;
  repairNodeId: string;
}

/**
 * Add a locked pixel source plus an empty writable repair layer above an
 * ordinary image. The original image node remains in the document, hidden but
 * recoverable; subsequent retouch edits therefore have explicit ownership.
 */
export function addRetouchLayerSet(
  doc: Document,
  imageNodeId: string,
  source: { width: number; height: number; pixels: Uint8ClampedArray },
): RetouchLayerSet | null {
  const imageNode = doc.nodes[imageNodeId];
  if (imageNode?.kind !== 'shape' || !isImageShape(imageNode)) return null;
  const imageFill = getImageFill(imageNode)?.image;
  if (!imageFill) return null;
  const hasRotation = Math.abs(imageFill.rotation ?? 0) > 1e-6;
  const hasPlacementTransform =
    (imageFill.fit !== 'fill' && imageFill.fit !== 'stretch') ||
    imageFill.x !== 0 ||
    imageFill.y !== 0 ||
    imageFill.scale !== 1 ||
    hasRotation ||
    imageFill.flipH === true ||
    imageFill.flipV === true ||
    imageFill.crop !== undefined ||
    imageFill.upscale !== undefined ||
    imageFill.generativeEditOverlay !== undefined ||
    imageFill.perspective !== undefined;
  if (hasPlacementTransform) {
    throw new Error(
      'Retouch preparation currently requires an uncropped, untransformed image fill; bake or reset the image placement first',
    );
  }
  if (imageNode.shape.kind !== 'rect') {
    throw new Error('Retouch preparation currently requires an uncropped rectangular image');
  }

  const scaleX = imageNode.shape.w / source.width;
  const scaleY = imageNode.shape.h / source.height;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    throw new Error('Retouch preparation could not resolve the image-to-pixel scale');
  }
  // A RAW development can replace a preview-sized image fill with a
  // full-resolution rendition while preserving the document rectangle. The
  // repair layer stores those full-resolution pixels and maps them back to
  // the existing shape bounds instead of forcing a layout change.
  const pixelTransform = multiplyAffine(imageNode.transform, [scaleX, 0, 0, scaleY, 0, 0]);
  const sourceAsset = imageFill.assetId ? doc.assets?.[imageFill.assetId] : undefined;
  const sourceRevision =
    imageFill.photoSource?.sourceRevision ??
    sourceAsset?.hash ??
    `rendered-image:${source.width}x${source.height}`;
  // The repair target is an RGBA8 rendition, even when its provenance points
  // back to a RAW recipe. Keep the retouch stage truthful rather than calling
  // an encoded SDR image display-linear.
  const sourceStage = 'rendered-image' as const;

  let allocated = nextNodeId(doc);
  const sourceNodeId = allocated.id;
  const sourceNode = makeRasterSourceLayer(sourceNodeId, source, {
    name: 'Photo pixels',
    transform: pixelTransform,
    locked: true,
  });
  let nextDocument = allocated.doc;
  const parentId = getParent(nextDocument, imageNodeId);
  nextDocument = parentId
    ? addChild(nextDocument, parentId, sourceNode)
    : insertNode(nextDocument, sourceNode, nextDocument.rootChildren.indexOf(imageNodeId) + 1);

  allocated = nextNodeId(nextDocument);
  const repairNodeId = allocated.id;
  const repairNode: RasterLayerNode = {
    ...makeRasterLayerNode(
      repairNodeId,
      { width: source.width, height: source.height },
      { name: 'Repair layer' },
    ),
    transform: pixelTransform,
    retouchProvenance: {
      role: 'baked-retouch',
      sourceNodeId: imageNodeId,
      sourceRevision,
      sourceStage,
      policy: 'baked',
    },
  };
  nextDocument = allocated.doc;
  const repairParentId = getParent(nextDocument, imageNodeId);
  nextDocument = repairParentId
    ? addChild(nextDocument, repairParentId, repairNode)
    : insertNode(nextDocument, repairNode, nextDocument.rootChildren.indexOf(sourceNodeId) + 1);

  nextDocument = {
    ...nextDocument,
    nodes: {
      ...nextDocument.nodes,
      [imageNodeId]: { ...imageNode, visible: false },
    },
  };
  return { document: nextDocument, sourceNodeId, repairNodeId };
}

/** Add immutable source and derived bytes while preserving the existing asset manager contract. */
export function addPhotoAssetSet(
  doc: Document,
  sourceInput: EmbeddedAssetInput,
  sourceProvenance: NonNullable<DocumentAsset['photoSource']>,
  derivedInput: EmbeddedAssetInput,
  derivedProvenance: NonNullable<DocumentAsset['photoSource']>,
): PhotoAssetSet {
  const sourceAsset = { ...createEmbeddedAsset(sourceInput), photoSource: sourceProvenance };
  const derivedAsset = { ...createEmbeddedAsset(derivedInput), photoSource: derivedProvenance };
  const assets = {
    ...doc.assets,
    [sourceAsset.id]: doc.assets?.[sourceAsset.id] ?? sourceAsset,
    [derivedAsset.id]: derivedAsset,
  };
  return { sourceAsset, derivedAsset, document: { ...doc, assets } };
}

/** Replace only the selected node's existing image fill; geometry and other fills remain intact. */
export function replaceImageFill(
  doc: Document,
  nodeId: string,
  patch: (image: ImageFillData) => ImageFillData,
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const fills = node.fills?.map((fill) => {
    if (fill.type !== 'image' || !fill.image) return fill;
    return { ...fill, image: patch(fill.image) };
  });
  if (!fills) return doc;
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...node, fills } as SceneNode } };
}

export function selectedImageAsset(doc: Document, node: SceneNode): DocumentAsset | undefined {
  if (node.kind !== 'shape' || !isImageShape(node)) return undefined;
  const fill = getImageFill(node);
  const assetId = fill?.type === 'image' ? fill.image?.assetId : undefined;
  return assetId ? doc.assets?.[assetId] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
