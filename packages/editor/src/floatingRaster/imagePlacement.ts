/**
 * Target-local image coordinates for pixel selections.
 *
 * The renderer owns image placement; this adapter derives its affine source
 * pixel → placed-document mapping from that same canonical placement instead
 * of assuming document units are source pixels.
 */
import { type ImagePlacement, sourcePixelToLocal } from '@varve/engine';
import { type Affine, multiplyAffine } from '@varve/shared';

export interface VisibleImageSourceMapping {
  sourceToDocument: Affine;
  visibleSourceRect: { x: number; y: number; w: number; h: number };
}

/**
 * Tile placement deliberately has no single affine source mapping. Callers
 * must refuse destructive pixel edits there until a tile-aware target exists.
 */
export function visibleImageSourceMapping(
  placement: ImagePlacement,
  worldTransform: Affine,
): VisibleImageSourceMapping | null {
  if (placement.fit === 'tile') return null;
  const { sourceRect } = placement;
  if (sourceRect.w <= 0 || sourceRect.h <= 0) return null;
  const origin = { x: sourceRect.x + 0.5, y: sourceRect.y + 0.5 };
  const p0 = sourcePixelToLocal(placement, origin);
  const px = sourcePixelToLocal(placement, {
    x: Math.min(sourceRect.x + sourceRect.w - 0.5, origin.x + 1),
    y: origin.y,
  });
  const py = sourcePixelToLocal(placement, {
    x: origin.x,
    y: Math.min(sourceRect.y + sourceRect.h - 0.5, origin.y + 1),
  });
  if (!p0 || !px || !py) return null;
  const ax = px.x - p0.x;
  const ay = px.y - p0.y;
  const bx = py.x - p0.x;
  const by = py.y - p0.y;
  const sourceToLocal: Affine = [
    ax,
    ay,
    bx,
    by,
    p0.x - ax * origin.x - bx * origin.y,
    p0.y - ay * origin.x - by * origin.y,
  ];
  return {
    sourceToDocument: multiplyAffine(worldTransform, sourceToLocal),
    visibleSourceRect: { ...sourceRect },
  };
}
