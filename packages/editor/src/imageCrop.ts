/**
 * Non-destructive image crop — shrink the node frame and re-offset the image fill.
 *
 * Research basis: Figma image crop (viewport crop keeps source + mask intact).
 */
import type { Affine } from '@strata/engine';
import type { Document, NodeId, ShapeNode } from '@strata/scene';
import { getImageFill, isImageShape } from '@strata/scene';

export interface LocalCropRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
 * Commit a viewport crop on an image shape.
 * Keeps src / backgroundRemoval / alpha masks; adjusts bounds + fill offsets.
 */
export function commitImageCrop(doc: Document, nodeId: NodeId, crop: LocalCropRect): Document {
  const node = doc.nodes[nodeId];
  if (!node || node.kind !== 'shape' || !isImageShape(node)) return doc;
  if (node.shape.kind !== 'rect') return doc;

  const W = node.shape.w;
  const H = node.shape.h;
  if (W <= 0 || H <= 0) return doc;

  const x = clamp(crop.x, 0, Math.max(0, W - 1));
  const y = clamp(crop.y, 0, Math.max(0, H - 1));
  const w = clamp(crop.w, 1, W - x);
  const h = clamp(crop.h, 1, H - y);

  // No-op full-frame crop
  if (
    Math.abs(x) < 1e-9 &&
    Math.abs(y) < 1e-9 &&
    Math.abs(w - W) < 1e-9 &&
    Math.abs(h - H) < 1e-9
  ) {
    return doc;
  }

  const fill = getImageFill(node);
  const fills = (node.fills ?? []).map((f) => {
    if (f.type !== 'image' || !f.image) return f;
    return {
      ...f,
      image: {
        ...f.image,
        // Compensate for (1) origin shift by (x,y) and (2) new centered fit box size
        x: f.image.x + (W - w) / 2 - x,
        y: f.image.y + (H - h) / 2 - y,
      },
    };
  });

  const updated: ShapeNode = {
    ...node,
    shape: { kind: 'rect', x: 0, y: 0, w, h },
    transform: translateAffine(node.transform, x, y),
    fills,
    // Retain backgroundRemoval / other fields via spread
  };

  // Ensure image fill still present if somehow emptied
  if (!getImageFill(updated) && fill) {
    updated.fills = [fill];
  }

  return {
    ...doc,
    nodes: { ...doc.nodes, [nodeId]: updated },
  };
}
