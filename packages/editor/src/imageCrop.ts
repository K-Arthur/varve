/**
 * Non-destructive image crop — stores crop window on the image fill in
 * source-pixel coordinates instead of baking into node geometry.
 *
 * This makes the crop re-editable after save/reopen: the original source
 * dimensions are preserved on the fill, and the crop rect defines the
 * visible region. Resetting the crop simply removes the crop field.
 *
 * Works on any shape kind (rect, ellipse, circle, polygon, path, etc.),
 * not just rect. The crop bounds use nodeLocalBounds to determine the
 * effective area in node-local space, mapped to source-pixel coords.
 *
 * Research basis: Figma image crop (viewport crop keeps source + mask intact).
 */
import {
  type Affine,
  computeImagePlacement,
  type FaceDetection,
  localToSourcePixel,
} from '@varve/engine';
import type {
  Document,
  ImageCropRect,
  ImageFillData,
  ImageFit,
  NodeId,
  ShapeNode,
} from '@varve/scene';
import {
  getImageFill,
  getOwnRasterMaskAsset,
  isImageShape,
  nodeLocalBounds,
  normalizeImageCropRect,
  normalizeImageRotation,
} from '@varve/scene';
import {
  computeVisibleContentBounds,
  type LocalBounds,
  type PaddingSpec,
  paddingBounds,
} from './imageBounds';

export interface LocalCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Extended crop state that includes fill zoom/pan and fit mode.
 * The viewport rect defines the visible window in node-local space;
 * fillScale/fillOffset control the image-to-viewport mapping.
 */
export interface CropState {
  /** Viewport rect in node-local space — which portion to keep */
  viewport: LocalCropRect;
  /** Image fill scale override (zoom level). Undefined = keep current. */
  fillScale?: number;
  /** Image fill offset X override. Undefined = keep current. */
  fillOffsetX?: number;
  /** Image fill offset Y override. Undefined = keep current. */
  fillOffsetY?: number;
  /** Fit mode override. Undefined = keep current. */
  fillFit?: ImageFit;
  /** Straighten angle in degrees. Applied to image rotation on commit. */
  straightenAngle?: number;
}

/**
 * Compute the effective node-local bounds for an image shape.
 * Uses nodeLocalBounds for any shape kind — not just rect shapes.
 * Returns null for non-shape nodes or zero-dimension nodes.
 */
function getNodeBounds(
  node: import('@varve/scene').SceneNode,
  doc: import('@varve/scene').Document,
): { w: number; h: number } | null {
  if (node.kind !== 'shape') return null;
  const shapeNode = node as ShapeNode;
  // Fast path for rect shapes (avoids bounds recomputation)
  if (shapeNode.shape.kind === 'rect') {
    return { w: shapeNode.shape.w, h: shapeNode.shape.h };
  }
  const bounds = nodeLocalBounds(node, doc);
  if (
    bounds &&
    bounds.w > 0 &&
    bounds.h > 0 &&
    Number.isFinite(bounds.w) &&
    Number.isFinite(bounds.h)
  ) {
    return { w: bounds.w, h: bounds.h };
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Translate a local-space offset through an affine matrix. */
export function translateAffine(t: Affine, dx: number, dy: number): Affine {
  const [a, b, c, d, e, f] = t;
  return [a, b, c, d, e + a * dx + c * dy, f + b * dx + d * dy];
}

/**
 * Commit a basic viewport crop on an image shape (backward-compatible).
 * Keeps src / backgroundRemoval / alpha masks; stores crop on the fill.
 */
export function commitImageCrop(doc: Document, nodeId: NodeId, crop: LocalCropRect): Document {
  return commitImageCropExtended(doc, nodeId, { viewport: crop });
}

/**
 * Commit a face/object-aware source crop suggestion without changing node
 * geometry or baking a new raster. The input is already in decoded source
 * pixel coordinates, which is the same coordinate space used by the scene
 * crop field and by export/replay.
 */
export function commitSourceImageCrop(
  doc: Document,
  nodeId: NodeId,
  crop: ImageCropRect,
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as ShapeNode;
  const bounds = getNodeBounds(node, doc);
  const fill = getImageFill(shapeNode);
  if (!bounds || !fill?.image) return doc;

  const sourceWidth = fill.image.imageWidth ?? bounds.w;
  const sourceHeight = fill.image.imageHeight ?? bounds.h;
  const normalized = normalizeImageCropRect(crop, sourceWidth, sourceHeight);
  const old = fill.image.crop;
  const unchanged =
    old?.x === normalized?.x &&
    old?.y === normalized?.y &&
    old?.w === normalized?.w &&
    old?.h === normalized?.h;
  if (unchanged) return doc;

  const image = { ...fill.image };
  if (normalized) image.crop = normalized;
  else delete image.crop;
  const fills = (shapeNode.fills ?? []).map((candidate) => {
    if (candidate.type !== 'image' || !candidate.image) return candidate;
    return { ...candidate, image };
  });
  return { ...doc, nodes: { ...doc.nodes, [nodeId]: { ...shapeNode, fills } } };
}

export interface FaceAwareCropOptions {
  safetyMargin?: number;
  minimumConfidence?: number;
}

/**
 * Run YuNet face detection on the selected image shape's source pixels and
 * commit a source-space crop suggestion that keeps faces in frame. Pure:
 * returns the next document (or null when not applicable / no faces), so
 * callers own the history transaction.
 */
export async function applyFaceAwareCropToDocument(
  doc: Document,
  selection: NodeId[],
  options: FaceAwareCropOptions = {},
): Promise<Document | null> {
  const node = selection.length === 1 ? doc.nodes[selection[0]!] : undefined;
  if (node?.kind !== 'shape' || !isImageShape(node)) return null;
  const shapeNode = node as ShapeNode;
  const imageFill = getImageFill(shapeNode);
  if (!imageFill?.image) return null;

  const { OnnxFaceBackend, suggestFaceAwareCrop } = await import('@varve/engine');

  const image = imageFill.image;
  const sourceWidth = image.imageWidth ?? 1;
  const sourceHeight = image.imageHeight ?? 1;

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for face detection'));
    img.src = image.src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable for face detection');
  ctx.drawImage(img, 0, 0, sourceWidth, sourceHeight);
  const imageData = ctx.getImageData(0, 0, sourceWidth, sourceHeight);

  const backend = new OnnxFaceBackend();
  const result = await backend.run({
    source: {
      assetId: image.assetId ?? image.src,
      sourceRevision: image.src ?? '',
      width: sourceWidth,
      height: sourceHeight,
      orientationNormalized: true,
    },
    capabilities: ['FACE_BOUNDS'],
    quality: 'balanced',
    priority: 'VISIBLE_UI',
    consumer: 'crop:protect-faces',
    input: imageData,
  });
  const faces = result.FACE_BOUNDS?.kind === 'FACE_BOUNDS' ? result.FACE_BOUNDS.faces : [];
  if (faces.length === 0) return null;

  // Target the node's on-canvas aspect ratio so the committed crop keeps
  // the visible window while repositioning it onto the faces.
  const suggestion = suggestFaceAwareCrop(
    { width: sourceWidth, height: sourceHeight },
    {
      width: node.shape.kind === 'rect' ? node.shape.w : sourceWidth,
      height: node.shape.kind === 'rect' ? node.shape.h : sourceHeight,
    },
    faces as unknown as FaceDetection[],
    { safetyMargin: options.safetyMargin, minimumConfidence: options.minimumConfidence },
  );

  let next = doc;
  for (const id of selection) {
    next = commitSourceImageCrop(next, id, {
      x: suggestion.crop.x,
      y: suggestion.crop.y,
      w: suggestion.crop.width,
      h: suggestion.crop.height,
    });
  }
  return next;
}

/** Convert a local viewport through the same placement used by replay/export. */
function nodeLocalToSourceCrop(
  local: LocalCropRect,
  nodeW: number,
  nodeH: number,
  sourceW: number,
  sourceH: number,
  image: ImageFillData,
): ImageCropRect | null {
  const placement = computeImagePlacement({
    fit: image.fit ?? 'fill',
    sourceWidth: sourceW,
    sourceHeight: sourceH,
    bounds: { x: 0, y: 0, w: nodeW, h: nodeH },
    x: image.x,
    y: image.y,
    scale: image.scale,
    rotation: image.rotation,
    flipH: image.flipH,
    flipV: image.flipV,
  });
  if (!placement) return null;

  // Keep right/bottom samples inside the half-open node bounds.
  const right = Math.min(local.x + local.w, nodeW) - Math.max(1e-9, nodeW * Number.EPSILON * 4);
  const bottom = Math.min(local.y + local.h, nodeH) - Math.max(1e-9, nodeH * Number.EPSILON * 4);
  const points = [
    { x: local.x, y: local.y },
    { x: right, y: local.y },
    { x: right, y: bottom },
    { x: local.x, y: bottom },
  ]
    .map((point) => localToSourcePixel(placement, point, { unclipped: true }))
    .filter((point): point is { x: number; y: number } => point !== null);
  if (points.length === 0) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return {
    x: minX,
    y: minY,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * Commit an extended crop including fill zoom/pan and fit mode changes.
 *
 * The crop is stored on the image fill in source-pixel coordinates, NOT
 * baked into node geometry. This means:
 * - The node bounds are preserved (crop is a fill property, not a resize)
 * - The crop can be re-entered and adjusted after save/reopen
 * - Resetting the crop removes the fill.crop field
 */
export function commitImageCropExtended(
  doc: Document,
  nodeId: NodeId,
  cropState: CropState,
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as import('@varve/scene').ShapeNode;
  const bounds = getNodeBounds(node, doc);
  if (!bounds) return doc;
  const W = bounds.w;
  const H = bounds.h;

  const { viewport, fillScale, fillOffsetX, fillOffsetY, fillFit, straightenAngle } = cropState;
  const x = clamp(viewport.x, 0, Math.max(0, W - 1));
  const y = clamp(viewport.y, 0, Math.max(0, H - 1));
  const w = clamp(viewport.w, 1, W - x);
  const h = clamp(viewport.h, 1, H - y);

  const noViewportChange =
    Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(w - W) < 1e-9 && Math.abs(h - H) < 1e-9;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  const sourceWidth = fill.image.imageWidth ?? W;
  const sourceHeight = fill.image.imageHeight ?? H;

  // Apply transform overrides before mapping the viewport. Crop coordinates
  // must describe the previewed placement, not the previous committed one.
  const newImage: typeof fill.image = { ...fill.image };
  if (fillScale !== undefined) newImage.scale = fillScale;
  if (fillOffsetX !== undefined) newImage.x = fillOffsetX;
  if (fillOffsetY !== undefined) newImage.y = fillOffsetY;
  if (fillFit !== undefined) newImage.fit = fillFit;
  if (straightenAngle !== undefined && Math.abs(straightenAngle) > 0.01) {
    const existing = newImage.rotation ?? 0;
    newImage.rotation = normalizeImageRotation((((existing + straightenAngle) % 360) + 360) % 360);
  }

  if (!noViewportChange) {
    const sourceCrop = nodeLocalToSourceCrop(
      { x, y, w, h },
      W,
      H,
      sourceWidth,
      sourceHeight,
      newImage,
    );
    if (!sourceCrop) return doc;
    newImage.crop = normalizeImageCropRect(sourceCrop, sourceWidth, sourceHeight);
  } else {
    delete newImage.crop;
  }

  // Check if anything actually changed
  const oldCrop = fill.image.crop;
  const newCrop = newImage.crop;
  const cropChanged =
    oldCrop?.x !== newCrop?.x ||
    oldCrop?.y !== newCrop?.y ||
    oldCrop?.w !== newCrop?.w ||
    oldCrop?.h !== newCrop?.h;
  const imgChanged =
    cropChanged ||
    newImage.scale !== fill.image.scale ||
    newImage.x !== fill.image.x ||
    newImage.y !== fill.image.y ||
    newImage.fit !== fill.image.fit;
  if (!imgChanged) return doc;

  const fills = (shapeNode.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    return { ...f, image: newImage };
  });

  const updated: ShapeNode = { ...shapeNode, fills };
  if (!getImageFill(updated) && fill) {
    updated.fills = [fill];
  }

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}

/**
 * Reset the crop on an image shape — removes the crop field from the fill,
 * restoring the full source image. Also resets fill offset/scale to defaults.
 */
export function resetImageCrop(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as ShapeNode;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  // No crop to reset
  if (!fill.image.crop && !fill.image.rotation && !fill.image.flipH && !fill.image.flipV) {
    return doc;
  }

  const newImage = { ...fill.image };
  delete newImage.crop;
  newImage.x = 0;
  newImage.y = 0;
  newImage.scale = 1;
  newImage.fit = 'fill';
  delete newImage.rotation;
  delete newImage.flipH;
  delete newImage.flipV;

  const fills = (shapeNode.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    return { ...f, image: newImage };
  });

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...shapeNode, fills } },
  };
}

/**
 * Set image rotation (degrees clockwise). Applied to source pixels before
 * fit/placement math. Stored on the fill so it is independent of the node's
 * object-space transform.
 */
export function setImageRotation(doc: Document, nodeId: NodeId, degrees: number): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as ShapeNode;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  const normalized = ((degrees % 360) + 360) % 360;
  const newImage = { ...fill.image };
  if (Math.abs(normalized) < 1e-6) {
    delete newImage.rotation;
  } else {
    newImage.rotation = normalized;
  }

  const fills = (shapeNode.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    return { ...f, image: newImage };
  });

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...shapeNode, fills } },
  };
}

/**
 * Set image flip. Stored on the fill so it is independent of the node's
 * object-space transform.
 */
export function setImageFlip(
  doc: Document,
  nodeId: NodeId,
  axis: 'horizontal' | 'vertical',
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as ShapeNode;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  const newImage = { ...fill.image };
  if (axis === 'horizontal') {
    newImage.flipH = !newImage.flipH;
  } else {
    newImage.flipV = !newImage.flipV;
  }

  const fills = (shapeNode.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    return { ...f, image: newImage };
  });

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: { ...shapeNode, fills } },
  };
}

// ---------------------------------------------------------------------------
// Expand / reset / trim — high-level document mutations
// ---------------------------------------------------------------------------

/**
 * Expand an image node's bounds outward by padding.
 * Works on any shape node with an image fill — grows the shape bounds
 * and shifts the image fill origin to keep the visible content centered.
 */
export function expandBounds(
  doc: Document,
  nodeId: NodeId,
  opts: {
    padding: number;
    paddingSides?: { top?: number; right?: number; bottom?: number; left?: number };
  },
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as import('@varve/scene').ShapeNode;
  const bounds = getNodeBounds(shapeNode, doc);
  if (!bounds) return doc;

  const padding: PaddingSpec = opts.paddingSides ?? opts.padding;
  const expanded = paddingBounds({ x: 0, y: 0, w: bounds.w, h: bounds.h }, padding);

  if (expanded.x === 0 && expanded.y === 0 && expanded.w === bounds.w && expanded.h === bounds.h) {
    return doc;
  }

  const updated = {
    ...shapeNode,
    shape: { ...shapeNode.shape, w: expanded.w, h: expanded.h },
    transform: translateAffine(shapeNode.transform, -expanded.x, -expanded.y),
  };

  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

/**
 * Reset an image node back to its source-image bounds.
 * Removes any viewport crop and resets fill offsets to 0.
 */
export function resetToSourceBounds(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as import('@varve/scene').ShapeNode;
  const bounds = getNodeBounds(node, doc);
  if (!bounds) return doc;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  const sourceW = fill.image.imageWidth ?? bounds.w;
  const sourceH = fill.image.imageHeight ?? bounds.h;
  if (sourceW <= 0 || sourceH <= 0) return doc;

  // For rect shapes, reset geometry to source dimensions + identity transform.
  // For non-rect shapes (ellipse, circle, etc.), preserve the shape kind and
  // geometry — only reset the fill properties.
  const shape = shapeNode.shape;
  const resetShape =
    shape.kind === 'rect' ? { kind: 'rect' as const, x: 0, y: 0, w: sourceW, h: sourceH } : shape;

  const updated: ShapeNode = {
    ...shapeNode,
    shape: resetShape as typeof shapeNode.shape,
    ...(shape.kind === 'rect'
      ? { transform: [1, 0, 0, 1, 0, 0] as import('@varve/shared').Affine }
      : {}),
    fills: (shapeNode.fills ?? []).map((f) => {
      if (f.type !== 'image' || !f.image) return f;
      return {
        ...f,
        image: { ...f.image, x: 0, y: 0, scale: 1 },
      };
    }),
  };

  return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
}

export interface TrimToSubjectOptions {
  /** Which source to trim from — falls back through the same chain as
   * computeVisibleContentBounds regardless, but callers can request the
   * raster mask specifically ('mask'), a plain alpha scan of the source
   * image ('alpha'), or let the bounds engine pick the best available
   * ('combined', the default). */
  source?: 'mask' | 'alpha' | 'combined';
  alphaThreshold?: number;
  /** Optional pre-computed local-space bounds (e.g. from a DETR detection)
   * to trim to directly, bypassing mask/alpha bounds computation entirely. */
  explicitBounds?: LocalBounds;
}

/**
 * Trim an image node to its subject (visible content bounds).
 * Computes the tight bounds from the node's raster mask (e.g. a SAM2
 * "Select Subject" selection applied as a mask), vector mask, clip mask,
 * or source alpha via computeVisibleContentBounds, then shrinks the node
 * to those bounds the same way a manual viewport crop would.
 *
 * Falls back to resetToSourceBounds when no tighter bounds can be computed.
 */
export async function trimToSubject(
  doc: Document,
  nodeId: NodeId,
  padding = 0,
  options: TrimToSubjectOptions = {},
): Promise<Document> {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as ShapeNode;
  const bounds = getNodeBounds(shapeNode, doc);
  if (!bounds) return doc;
  const W = bounds.w;
  const H = bounds.h;
  if (W <= 0 || H <= 0) return doc;

  let local: LocalBounds | null = options.explicitBounds ?? null;

  if (!local) {
    const assetId = shapeNode.mask?.rasterMask?.assetId;
    const rasterMaskAsset =
      assetId && options.source !== 'alpha' ? getOwnRasterMaskAsset(doc, assetId) : undefined;

    const result = await computeVisibleContentBounds(doc, nodeId, {
      alphaThreshold: options.alphaThreshold,
      rasterMaskAsset,
    });
    // 'source-alpha' and 'fallback' both mean "no real mask found" — the
    // former is computeVisibleContentBounds's own fallback to the node's
    // full shape bounds, which is a same-size no-op crop, not a trim.
    if (
      result &&
      (result.method === 'vector-path' ||
        result.method === 'raster-alpha' ||
        result.method === 'clip-mask')
    ) {
      local = result.local;
    }
  }

  if (!local) return resetToSourceBounds(doc, nodeId);

  const padded = padding > 0 ? paddingBounds(local, padding) : local;
  // Clamp to the node's own current bounds — the computed subject can't
  // be trimmed to something larger than the frame it's found within.
  const x = clamp(padded.x, 0, Math.max(0, W - 1));
  const y = clamp(padded.y, 0, Math.max(0, H - 1));
  const w = clamp(padded.x + padded.w - x, 1, W - x);
  const h = clamp(padded.y + padded.h - y, 1, H - y);

  return commitImageCropExtended(doc, nodeId, { viewport: { x, y, w, h } });
}
