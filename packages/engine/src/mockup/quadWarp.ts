/**
 * Quad warp — rasterize a source rectangle into a destination quad using a
 * true projective (homography) mapping.
 *
 * For every output pixel inside the destination quad, the inverse homography
 * locates the corresponding source coordinate; the pixel is sampled
 * bilinearly. Pixels outside the quad are left transparent. This is the
 * exact model for four-corner perspective placement (posters, screens,
 * cards, book covers photographed at an angle).
 *
 * The two-triangle barycentric warp used by `meshWarp` is a bilinear patch,
 * not a homography; quads that are not parallelograms need the projective
 * mapping implemented here to avoid visible kinks along the diagonal.
 *
 * Sampling foundation mirrors `meshWarp.ts` (bilinear interpolation, per-pixel
 * CPU) so both warps share one quality profile and test corpus.
 */

import {
  applyHomography,
  type Homography,
  invertHomography,
  type Quad,
  quadBounds,
  solveHomography,
} from './homography';

/** Bilinear sample of a single pixel at fractional source coordinates. */
export function sampleBilinear(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  sx: number,
  sy: number,
  out: Uint8ClampedArray,
  outIndex: number,
): void {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const x1 = Math.min(x0 + 1, srcW - 1);
  const y1 = Math.min(y0 + 1, srcH - 1);
  const ix0 = Math.max(0, Math.min(x0, srcW - 1));
  const iy0 = Math.max(0, Math.min(y0, srcH - 1));
  const p00 = (iy0 * srcW + ix0) * 4;
  const p10 = (iy0 * srcW + x1) * 4;
  const p01 = (y1 * srcW + ix0) * 4;
  const p11 = (y1 * srcW + x1) * 4;
  for (let c = 0; c < 4; c++) {
    const top = src[p00 + c]! * (1 - fx) + src[p10 + c]! * fx;
    const bottom = src[p01 + c]! * (1 - fx) + src[p11 + c]! * fx;
    out[outIndex + c] = top * (1 - fy) + bottom * fy;
  }
}

/**
 * Warp an ImageData source rect into the destination quad.
 *
 * @param src - source pixels (RGBA).
 * @param srcW - source width.
 * @param srcH - source height.
 * @param dstQuad - destination quad in target coordinates. Winding is
 *   normalized internally; degenerate quads return null.
 * @param outW - target width.
 * @param outH - target height.
 * @returns target ImageData (transparent outside the quad), or null when the
 *   quad is degenerate (callers must report invalid geometry, not draw
 *   corrupted output).
 */
export function warpImageToQuad(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstQuad: Quad,
  outW: number,
  outH: number,
): ImageData | null {
  if (srcW <= 0 || srcH <= 0 || outW <= 0 || outH <= 0) return null;
  if (src.length < srcW * srcH * 4) return null;

  const srcRect: Quad = [
    { x: 0, y: 0 },
    { x: srcW, y: 0 },
    { x: srcW, y: srcH },
    { x: 0, y: srcH },
  ];
  const H = solveHomography(srcRect, dstQuad);
  if (!H) return null;
  const HInv = invertHomography(H);
  if (!HInv) return null;

  const bounds = quadBounds(dstQuad);
  const out = new ImageData(outW, outH);
  const data = out.data;

  // Only pixels inside the destination quad (plus its bounding box) are
  // sampled; outside stays transparent.
  const quadX = bounds.x;
  const quadY = bounds.y;
  const quadX2 = bounds.x + bounds.width;
  const quadY2 = bounds.y + bounds.height;

  for (let y = 0; y < outH; y++) {
    if (y < quadY || y > quadY2) continue;
    for (let x = 0; x < outW; x++) {
      if (x < quadX || x > quadX2) continue;
      const mapped = applyHomography(HInv, { x, y });
      if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) continue;
      // Clamp-tolerant bounds: sampleBilinear clamps to the edge pixels, so
      // allowing [0, srcW] avoids a dark one-pixel rim on the far edges.
      if (mapped.x < 0 || mapped.y < 0 || mapped.x > srcW || mapped.y > srcH) continue;
      const outIndex = (y * outW + x) * 4;
      sampleBilinear(src, srcW, srcH, mapped.x, mapped.y, data, outIndex);
    }
  }
  return out;
}

/**
 * Map a source point through the quad transform (for handle math and tests):
 * the forward homography of the sampling rect onto the quad.
 */
export function mapQuadPoint(
  srcW: number,
  srcH: number,
  dstQuad: Quad,
  p: { x: number; y: number },
): { x: number; y: number } | null {
  const srcRect: Quad = [
    { x: 0, y: 0 },
    { x: srcW, y: 0 },
    { x: srcW, y: srcH },
    { x: 0, y: srcH },
  ];
  const H = solveHomography(srcRect, dstQuad);
  if (!H) return null;
  const mapped = applyHomography(H, p);
  return Number.isFinite(mapped.x) && Number.isFinite(mapped.y) ? mapped : null;
}
