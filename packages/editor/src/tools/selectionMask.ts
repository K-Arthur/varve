/**
 * Bridges an analytical document-space area selection to Varve's native
 * raster-mask asset format.
 *
 * The raster mask is bounded to the selected image/frame target.  It is never
 * a full-canvas allocation, and the target's world transform is applied while
 * sampling so rotated, scaled, nested layers retain document-space semantics.
 */
import {
  type AreaSelection,
  areaSelectionCoverageAt,
  computeImagePlacement,
  localToSourcePixel,
  sourcePixelToLocal,
} from '@varve/engine';
import {
  buildParentIndexMap,
  type Document,
  getImageFill,
  isImageShape,
  type NodeId,
  type SceneNode,
} from '@varve/scene';
import { type Affine, applyAffine, tryInvertAffine } from '@varve/shared';
import { nodeLocalBounds, nodeWorldTransform } from '../scene/world';

export const MAX_SELECTION_MASK_DIMENSION = 16_384;
export const MAX_SELECTION_MASK_PIXELS = 16_777_216;

export interface SelectionMaskRaster {
  data: Uint8Array;
  width: number;
  height: number;
  coordinateSpace: 'source-image-pixels' | 'container-local-pixels';
  sourceLocator?: string;
}

export interface DecodedMaskPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function sampleDecodedAlpha(pixels: DecodedMaskPixels, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= pixels.width || y >= pixels.height) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(pixels.width - 1, x0 + 1);
  const y1 = Math.min(pixels.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (px: number, py: number) => pixels.data[(py * pixels.width + px) * 4 + 3]! / 255;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function sampleSelection(
  selection: AreaSelection,
  worldTransform: Affine,
  localX: number,
  localY: number,
  sourceMapper?: (x: number, y: number) => { x: number; y: number } | null,
): number {
  const local = sourceMapper?.(localX, localY) ?? { x: localX, y: localY };
  if (!local) return 0;
  const world = applyAffine(worldTransform, [local.x, local.y]);
  return areaSelectionCoverageAt(selection, { x: world[0], y: world[1] });
}

function writeCoverage(
  data: Uint8Array,
  index: number,
  selection: AreaSelection,
  worldTransform: Affine,
  localX: number,
  localY: number,
  antialias: boolean,
  sourceMapper?: (x: number, y: number) => { x: number; y: number } | null,
): void {
  const offsets = antialias
    ? ([0.25, 0.25, 0.75, 0.25, 0.25, 0.75, 0.75, 0.75] as const)
    : ([0.5, 0.5] as const);
  let total = 0;
  for (let offset = 0; offset < offsets.length; offset += 2) {
    total += sampleSelection(
      selection,
      worldTransform,
      localX + offsets[offset]!,
      localY + offsets[offset + 1]!,
      sourceMapper,
    );
  }
  data[index] = Math.round((total / (offsets.length / 2)) * 255);
}

function selectionUsesAntialias(expression: AreaSelection['expression']): boolean {
  if (expression.kind === 'shape') return expression.shape.antialias;
  return selectionUsesAntialias(expression.left) || selectionUsesAntialias(expression.right);
}

function dimensionsAllowed(width: number, height: number): boolean {
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_SELECTION_MASK_DIMENSION &&
    height <= MAX_SELECTION_MASK_DIMENSION &&
    width * height <= MAX_SELECTION_MASK_PIXELS
  );
}

function imageSourceDimensions(
  node: SceneNode,
  doc: Document,
): { width: number; height: number } | null {
  if (node.kind !== 'shape') return null;
  const image = getImageFill(node)?.image;
  const bounds = nodeLocalBounds(node, doc);
  if (!image || !bounds) return null;
  const width = Math.ceil(image.imageWidth ?? bounds.w);
  const height = Math.ceil(image.imageHeight ?? bounds.h);
  return dimensionsAllowed(width, height) ? { width, height } : null;
}

/** Rasterize one finite selection into the native mask coordinate space. */
export function rasterizeAreaSelectionForNode(
  doc: Document,
  nodeId: NodeId,
  selection: AreaSelection,
): SelectionMaskRaster | null {
  const node = doc.nodes[nodeId];
  if (!node) return null;
  const parentIndex = buildParentIndexMap(doc);
  const worldTransform = nodeWorldTransform(doc, nodeId, parentIndex);
  const antialias = selectionUsesAntialias(selection.expression);

  if (node.kind === 'frame') {
    const bounds = nodeLocalBounds(node, doc);
    const width = Math.ceil(node.w ?? bounds?.w ?? 0);
    const height = Math.ceil(node.h ?? bounds?.h ?? 0);
    if (!dimensionsAllowed(width, height)) return null;
    const originX = bounds?.x ?? 0;
    const originY = bounds?.y ?? 0;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        writeCoverage(
          data,
          y * width + x,
          selection,
          worldTransform,
          originX + x,
          originY + y,
          antialias,
        );
      }
    }
    return { data, width, height, coordinateSpace: 'container-local-pixels' };
  }

  if (node.kind !== 'shape' || !isImageShape(node)) return null;
  const dimensions = imageSourceDimensions(node, doc);
  const image = getImageFill(node)?.image;
  const bounds = nodeLocalBounds(node, doc);
  if (!dimensions || !image || !bounds) return null;
  const placement = computeImagePlacement({
    fit: image.fit,
    sourceWidth: dimensions.width,
    sourceHeight: dimensions.height,
    bounds,
    x: image.x,
    y: image.y,
    scale: image.scale,
    sourceCrop: image.crop,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
  if (!placement) return null;

  const data = new Uint8Array(dimensions.width * dimensions.height);
  const sourceMapper = (x: number, y: number) => sourcePixelToLocal(placement, { x, y });
  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      writeCoverage(
        data,
        y * dimensions.width + x,
        selection,
        worldTransform,
        x,
        y,
        antialias,
        sourceMapper,
      );
    }
  }
  return {
    data,
    width: dimensions.width,
    height: dimensions.height,
    coordinateSpace: 'source-image-pixels',
    sourceLocator: image.src,
  };
}

/** Convert a native RGBA mask asset into a document-space area selection. */
export function areaSelectionFromMaskPixels(
  doc: Document,
  nodeId: NodeId,
  pixels: DecodedMaskPixels,
  coordinateSpace: 'source-image-pixels' | 'container-local-pixels',
): AreaSelection | null {
  const node = doc.nodes[nodeId];
  const bounds = node ? nodeLocalBounds(node, doc) : null;
  if (!node || !bounds) return null;

  const width = Math.ceil(bounds.w);
  const height = Math.ceil(bounds.h);
  if (!dimensionsAllowed(width, height)) return null;

  const parentIndex = buildParentIndexMap(doc);
  const transform = nodeWorldTransform(doc, nodeId, parentIndex);
  const inverse = tryInvertAffine(transform);
  if (!inverse) return null;

  let sourceMapper: ((x: number, y: number) => { x: number; y: number } | null) | undefined;
  if (coordinateSpace === 'source-image-pixels' && node.kind === 'shape' && isImageShape(node)) {
    const image = getImageFill(node)?.image;
    const dimensions = imageSourceDimensions(node, doc);
    if (!image || !dimensions) return null;
    const placement = computeImagePlacement({
      fit: image.fit,
      sourceWidth: dimensions.width,
      sourceHeight: dimensions.height,
      bounds,
      x: image.x,
      y: image.y,
      scale: image.scale,
      sourceCrop: image.crop,
      rotation: image.rotation,
      flipH: image.flipH,
      flipV: image.flipV,
    });
    if (!placement) return null;
    sourceMapper = (x, y) => localToSourcePixel(placement, { x, y });
  }

  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const localX = bounds.x + x + 0.5;
      const localY = bounds.y + y + 0.5;
      const source = sourceMapper?.(localX, localY);
      // Image placement coordinates describe pixel edges. Sampling at the
      // destination pixel centre therefore lands on the corresponding source
      // pixel centre after subtracting half a source pixel.
      const sourceX = (source?.x ?? ((localX - bounds.x) / bounds.w) * pixels.width) - 0.5;
      const sourceY = (source?.y ?? ((localY - bounds.y) / bounds.h) * pixels.height) - 0.5;
      data[y * width + x] = Math.round(sampleDecodedAlpha(pixels, sourceX, sourceY) * 255);
    }
  }
  const boundary: Array<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  }> = [];
  // A pathological 16M-pixel mask can have millions of edge segments. Keep
  // the exact contour for normal editor selections and let the overlay use a
  // bounded rectangle fallback for masks too large to trace interactively.
  const maxBoundarySegments = 250_000;
  const localPoint = (x: number, y: number) =>
    applyAffine(transform, [bounds.x + (x / width) * bounds.w, bounds.y + (y / height) * bounds.h]);
  const addBoundary = (fromX: number, fromY: number, toX: number, toY: number) => {
    if (boundary.length >= maxBoundarySegments) return;
    const from = localPoint(fromX, fromY);
    const to = localPoint(toX, toY);
    boundary.push({ from: { x: from[0], y: from[1] }, to: { x: to[0], y: to[1] } });
  };
  for (let y = 0; y < height && boundary.length < maxBoundarySegments; y += 1) {
    for (let x = 0; x < width && boundary.length < maxBoundarySegments; x += 1) {
      if ((data[y * width + x] ?? 0) === 0) continue;
      if (x === 0 || (data[y * width + x - 1] ?? 0) === 0) addBoundary(x, y, x, y + 1);
      if (x === width - 1 || (data[y * width + x + 1] ?? 0) === 0) {
        addBoundary(x + 1, y + 1, x + 1, y);
      }
      if (y === 0 || (data[(y - 1) * width + x] ?? 0) === 0) addBoundary(x + 1, y, x, y);
      if (y === height - 1 || (data[(y + 1) * width + x] ?? 0) === 0) {
        addBoundary(x, y + 1, x + 1, y + 1);
      }
    }
  }
  return {
    coordinateSpace: 'document',
    generation: 1,
    expression: {
      kind: 'shape',
      shape: {
        kind: 'raster-mask',
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
        width,
        height,
        data,
        boundary,
        transform,
        inverseTransform: inverse,
        feather: 0,
        antialias: false,
      },
    },
  };
}

export function decodeRasterMaskDataUrl(dataUrl: string): Promise<DecodedMaskPixels | null> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context || canvas.width <= 0 || canvas.height <= 0) return resolve(null);
        const result = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ data: result.data, width: result.width, height: result.height });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

/** Encode a one-channel selection mask as an immutable RGBA PNG asset. */
export function encodeSelectionMaskPng(raster: SelectionMaskRaster): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width;
    canvas.height = raster.height;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.toDataURL !== 'function') return null;
    const rgba = new Uint8ClampedArray(raster.data.length * 4);
    for (let index = 0, offset = 0; index < raster.data.length; index += 1, offset += 4) {
      const value = raster.data[index]!;
      rgba[offset] = value;
      rgba[offset + 1] = value;
      rgba[offset + 2] = value;
      rgba[offset + 3] = value;
    }
    const imageData = context.createImageData(raster.width, raster.height);
    imageData.data.set(rgba);
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
