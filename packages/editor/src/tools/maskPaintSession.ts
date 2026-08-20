/**
 * Painting a layer mask with the raster brush.
 *
 * A mask asset is stored as an encoded PNG, which is the right shape for
 * persistence and the wrong shape for painting: re-encoding per dab would be
 * unusable. A session decodes the mask once at pointer-down, accumulates dabs
 * into an 8-bit coverage plane, and encodes once at pointer-up. That is also
 * the correct undo granularity — one stroke, one history entry.
 *
 * The plane is separate from the layer's colour tiles, so undoing a mask stroke
 * restores mask pixels and never touches the content underneath.
 */
import type { BrushDab, CoverageMask, MaskPlane } from '@varve/scene';
import {
  compositeMaskDab,
  createMaskPlane,
  getOwnRasterMaskAsset,
  maskPlaneFromRgba,
  maskPlaneToRgba,
  unionRect,
} from '@varve/scene';
import type { ToolContext } from './types';

/** Cap on a painted container mask, matching RefineMaskTool's limit. */
export const MAX_CONTAINER_MASK_DIMENSION = 2048;

export interface MaskPaintSession {
  nodeId: string;
  plane: MaskPlane;
  coordinateSpace: 'container-local-pixels' | 'source-image-pixels';
  /** Maps a world point into mask pixel coordinates. */
  toMaskPixel: (world: { x: number; y: number }) => { x: number; y: number };
  /** Union of every dab's footprint, for reporting what changed. */
  dirty: { x: number; y: number; w: number; h: number } | null;
}

interface MaskTargetNode {
  id: string;
  kind?: string;
  w?: number;
  h?: number;
  mask?: { rasterMask?: { assetId?: string; coordinateSpace?: string } };
}

/**
 * Open a mask paint session for a node.
 *
 * Returns null when the node cannot host a painted mask — the caller should
 * report that rather than silently painting the content layer instead.
 */
export function beginMaskPaintSession(
  ctx: ToolContext,
  nodeId: string,
  decode: (dataUrl: string) => { data: Uint8ClampedArray; width: number; height: number } | null,
): MaskPaintSession | null {
  const node = ctx.getNode(nodeId) as unknown as MaskTargetNode | undefined;
  if (!node) return null;

  const width = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(node.w ?? 256)));
  const height = Math.min(MAX_CONTAINER_MASK_DIMENSION, Math.max(1, Math.ceil(node.h ?? 256)));

  const assetId = node.mask?.rasterMask?.assetId;
  const asset = assetId ? getOwnRasterMaskAsset(ctx.document, assetId) : undefined;

  let plane: MaskPlane;
  if (asset?.dataUrl) {
    const decoded = decode(asset.dataUrl);
    // A mask that will not decode is a data problem, not a reason to start from
    // a blank one — that would silently discard the user's existing mask.
    if (!decoded) return null;
    plane = maskPlaneFromRgba(decoded.data, decoded.width, decoded.height);
  } else {
    // No mask yet: start fully revealed, so the first stroke subtracts.
    plane = createMaskPlane(width, height, 255);
  }

  const scaleX = plane.width / Math.max(1, node.w ?? plane.width);
  const scaleY = plane.height / Math.max(1, node.h ?? plane.height);
  const worldTransform = ctx.getWorldTransform?.(nodeId);

  return {
    nodeId,
    plane,
    coordinateSpace: 'container-local-pixels',
    toMaskPixel: (world) => {
      const local = worldTransform ? inverseApply(worldTransform, world) : world;
      return { x: local.x * scaleX, y: local.y * scaleY };
    },
    dirty: null,
  };
}

function inverseApply(
  transform: import('@varve/shared').Affine,
  world: { x: number; y: number },
): { x: number; y: number } {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (det === 0) return world;
  const x = world.x - e;
  const y = world.y - f;
  return { x: (x * d - y * c) / det, y: (y * a - x * b) / det };
}

/** Paint one dab into the session's plane. Coordinates are already mask pixels. */
export function paintMaskDab(
  session: MaskPaintSession,
  dab: BrushDab,
  value: number,
  coverage: CoverageMask | null,
): void {
  const rect = compositeMaskDab(session.plane, dab, { value, coverage });
  session.dirty = unionRect(session.dirty, rect);
}

/**
 * Encode and commit the session's plane.
 *
 * Returns false when nothing was painted, so the caller can abort its
 * transaction rather than record an empty history entry.
 */
export function commitMaskPaintSession(
  ctx: ToolContext,
  session: MaskPaintSession,
  encode: (rgba: Uint8ClampedArray, width: number, height: number) => string | null,
): boolean {
  if (!session.dirty) return false;
  const dataUrl = encode(maskPlaneToRgba(session.plane), session.plane.width, session.plane.height);
  if (!dataUrl) return false;
  ctx.commitRasterMask?.(
    session.nodeId,
    dataUrl,
    session.plane.width,
    session.plane.height,
    session.coordinateSpace,
  );
  return true;
}

/**
 * Read an already-loaded mask image into pixels.
 *
 * Takes the decoded image rather than the data URL: decoding is asynchronous
 * and a stroke cannot wait for it at pointer-down, so the caller is responsible
 * for having the image ready.
 */
export function decodeMaskImage(
  image: HTMLImageElement | null,
): { data: Uint8ClampedArray; width: number; height: number } | null {
  if (!image || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width === 0 || canvas.height === 0) return null;
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data, width, height };
  } catch {
    return null;
  }
}

/** Encode a coverage plane as a PNG data URL. */
export function encodeMaskRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.toDataURL !== 'function') return null;
    const imageData = ctx.createImageData(width, height);
    imageData.data.set(rgba);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
