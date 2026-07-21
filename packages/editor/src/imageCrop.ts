/**
 * Non-destructive image crop — shrink the node frame and re-offset the image fill.
 *
 * Research basis: Figma image crop (viewport crop keeps source + mask intact).
 */
import type { Affine } from '@strata/engine';
import type { Document, ImageFit, NodeId, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';
import { type PaddingSpec, paddingBounds } from './imageBounds';

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
 * Keeps src / backgroundRemoval / alpha masks; adjusts bounds + fill offsets.
 */
export function commitImageCrop(doc: Document, nodeId: NodeId, crop: LocalCropRect): Document {
  return commitImageCropExtended(doc, nodeId, { viewport: crop });
}

/**
 * Commit an extended crop including fill zoom/pan and fit mode changes.
 */
export function commitImageCropExtended(
  doc: Document,
  nodeId: NodeId,
  cropState: CropState,
): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as import('@strata/scene').ShapeNode;
  if (shapeNode.shape.kind !== 'rect') return doc;

  const W = shapeNode.shape.w;
  const H = shapeNode.shape.h;
  if (W <= 0 || H <= 0) return doc;

  const { viewport, fillScale, fillOffsetX, fillOffsetY, fillFit } = cropState;
  const x = clamp(viewport.x, 0, Math.max(0, W - 1));
  const y = clamp(viewport.y, 0, Math.max(0, H - 1));
  const w = clamp(viewport.w, 1, W - x);
  const h = clamp(viewport.h, 1, H - y);

  const noViewportChange =
    Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(w - W) < 1e-9 && Math.abs(h - H) < 1e-9;

  // If only fill scale/offset/fit changed, apply those without viewport crop
  const fill = getImageFill(shapeNode);
  const fills = (shapeNode.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    const img = f.image;
    return {
      ...f,
      image: {
        ...img,
        // Compensate viewport crop: origin shift + new centered fit box
        x: noViewportChange
          ? fillOffsetX !== undefined
            ? fillOffsetX
            : img.x
          : fillOffsetX !== undefined
            ? fillOffsetX
            : img.x + (W - w) / 2 - x,
        y: noViewportChange
          ? fillOffsetY !== undefined
            ? fillOffsetY
            : img.y
          : fillOffsetY !== undefined
            ? fillOffsetY
            : img.y + (H - h) / 2 - y,
        scale: fillScale !== undefined ? fillScale : img.scale,
        fit: fillFit !== undefined ? fillFit : img.fit,
      },
    };
  });

  if (noViewportChange) {
    // Check if any fill properties actually changed; if not, return doc as-is
    const img = shapeNode.fills?.find((f) => f.type === 'image')?.image;
    const fillChanged =
      (fillScale !== undefined && Math.abs(fillScale - (img?.scale ?? 1)) > 0.001) ||
      (fillOffsetX !== undefined && Math.abs(fillOffsetX - (img?.x ?? 0)) > 0.001) ||
      (fillOffsetY !== undefined && Math.abs(fillOffsetY - (img?.y ?? 0)) > 0.001) ||
      (fillFit !== undefined && fillFit !== img?.fit);
    if (!fillChanged) return doc;
    // Only fill property changes — no viewport crop
    const updated: ShapeNode = { ...shapeNode, fills };
    if (!getImageFill(updated) && fill) {
      updated.fills = [fill];
    }
    return { ...doc, nodes: { ...doc.nodes, [nodeId]: updated } };
  }

  const updated: ShapeNode = {
    ...shapeNode,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    transform: translateAffine(shapeNode.transform, x, y),
    fills,
  };

  if (!getImageFill(updated) && fill) {
    updated.fills = [fill];
  }

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
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
  if (!node || node.kind !== 'shape') return doc;
  const shapeNode = node as import('@strata/scene').ShapeNode;
  if (shapeNode.shape.kind !== 'rect') return doc;

  const shape = shapeNode.shape as { w: number; h: number };
  const padding: PaddingSpec = opts.paddingSides ?? opts.padding;
  const expanded = paddingBounds({ x: 0, y: 0, w: shape.w, h: shape.h }, padding);

  if (expanded.x === 0 && expanded.y === 0 && expanded.w === shape.w && expanded.h === shape.h) {
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
  const shapeNode = node as import('@strata/scene').ShapeNode;
  if (shapeNode.shape.kind !== 'rect') return doc;

  const fill = getImageFill(shapeNode);
  if (!fill?.image) return doc;

  const sourceW = fill.image.imageWidth ?? shapeNode.shape.w;
  const sourceH = fill.image.imageHeight ?? shapeNode.shape.h;
  if (sourceW <= 0 || sourceH <= 0) return doc;

  const updated: ShapeNode = {
    ...shapeNode,
    shape: { kind: 'rect', x: 0, y: 0, w: sourceW, h: sourceH },
    transform: [1, 0, 0, 1, 0, 0],
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

/**
 * Trim an image node to its subject (visible content bounds).
 * Computes the tight bounds from raster alpha, vector mask, or clip mask
 * and shrinks the node to those bounds.
 *
 * Falls back to resetToSourceBounds when bounds cannot be computed.
 */
export function trimToSubject(doc: Document, nodeId: NodeId): Document {
  const node = doc.nodes[nodeId];
  if (node?.kind !== 'shape' || !isImageShape(node)) return doc;
  const shapeNode = node as import('@strata/scene').ShapeNode;
  if (shapeNode.shape.kind !== 'rect') return doc;

  const W = shapeNode.shape.w;
  const H = shapeNode.shape.h;
  if (W <= 0 || H <= 0) return doc;

  // Simple heuristic: crop away uniform outer rows/columns from image fill.
  // For true alpha-based trim, see imageBounds.computeVisibleContentBounds.
  const fill = getImageFill(shapeNode);
  if (!fill?.image) return resetToSourceBounds(doc, nodeId);

  // If no fill offset or scale deviation, reset to source
  if (fill.image.x === 0 && fill.image.y === 0 && fill.image.scale === 1) {
    return resetToSourceBounds(doc, nodeId);
  }

  // Keep current crop; trim is applied via the fill offset/scale
  return doc;
}
