/**
 * Painting into a raster mask.
 *
 * A mask stores coverage, not colour, so it lives as a single 8-bit plane
 * rather than an RGBA layer. Keeping it one channel is what makes a mask stroke
 * cheap: a full-colour buffer would quadruple the memory and force every dab to
 * write three redundant bytes.
 *
 * Dabs come from the same brush engine the raster brush uses, so mask painting
 * inherits pressure dynamics, spacing, jitter, tip shape and selection
 * clipping instead of needing a second, simpler brush of its own.
 *
 * A mask stroke is committed once, at pointer-up. Encoding a PNG per dab would
 * be unusable, and one history entry per stroke is also the correct undo
 * granularity.
 */

import type { BrushDab } from './brush';
import { type CoverageMask, sampleCoverage } from './paintCoverage';
import { createBrushDabMask, rasterBoundsForDab, sampleBrushMask } from './rasterLayer';

export interface MaskPlane {
  width: number;
  height: number;
  /** Row-major 8-bit coverage. 255 = fully revealed, 0 = fully hidden. */
  data: Uint8Array;
}

export interface MaskDabOptions {
  /**
   * Target coverage the brush paints towards, 0-1.
   *
   * Masks are painted with value, not colour: white reveals, black conceals,
   * and grey lands in between. Expressing it as a target rather than an
   * additive amount is what lets a soft brush build up to exactly the value
   * the user picked instead of overshooting to full white.
   */
  value: number;
  /** Selection / clip coverage in mask pixel space. */
  coverage?: CoverageMask | null;
}

export function createMaskPlane(width: number, height: number, fill = 255): MaskPlane {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8Array(w * h);
  if (fill > 0) data.fill(Math.max(0, Math.min(255, Math.round(fill))));
  return { width: w, height: h, data };
}

/** Read an RGBA mask asset into a coverage plane, using its alpha channel. */
export function maskPlaneFromRgba(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): MaskPlane {
  const plane = createMaskPlane(width, height, 0);
  for (let i = 0, p = 3; i < plane.data.length; i++, p += 4) {
    plane.data[i] = rgba[p] ?? 0;
  }
  return plane;
}

/**
 * Expand a coverage plane back to RGBA for encoding.
 *
 * Coverage is written to all four channels so the payload reads correctly
 * whether a consumer samples alpha or luminance — the two conventions both
 * appear across mask formats, and matching only one silently breaks the other.
 */
export function maskPlaneToRgba(plane: MaskPlane): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(plane.width * plane.height * 4);
  for (let i = 0, p = 0; i < plane.data.length; i++, p += 4) {
    const v = plane.data[i]!;
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = v;
  }
  return rgba;
}

/**
 * Composite one brush dab into a mask plane.
 *
 * Returns the rectangle actually touched, so a caller can accumulate a dirty
 * region and re-encode only what changed.
 */
export function compositeMaskDab(
  plane: MaskPlane,
  dab: BrushDab,
  options: MaskDabOptions,
): { x: number; y: number; w: number; h: number } | null {
  const mask = createBrushDabMask(dab);
  const size = Math.ceil(dab.radius * 2);
  const { minX: startX, minY: startY, maxX: endX, maxY: endY } = rasterBoundsForDab(dab);
  const target = Math.max(0, Math.min(1, options.value)) * 255;
  const coverage = options.coverage ?? null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let py = startY; py < endY; py++) {
    if (py < 0 || py >= plane.height) continue;
    for (let px = startX; px < endX; px++) {
      if (px < 0 || px >= plane.width) continue;
      const maskValue = sampleBrushMask(
        mask,
        size,
        px - (dab.x - dab.radius),
        py - (dab.y - dab.radius),
        dab,
      );
      if (maskValue <= 0) continue;

      const selection = coverage ? sampleCoverage(coverage, px, py) : 1;
      if (selection <= 0) continue;

      const strength = maskValue * dab.opacity * dab.flow * selection;
      if (strength <= 0) continue;

      const index = py * plane.width + px;
      const current = plane.data[index]!;
      // Move towards the target rather than adding to it, so repeated dabs
      // converge on the chosen value instead of saturating.
      plane.data[index] = Math.round(current + (target - current) * Math.min(1, strength));

      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }

  if (minX > maxX) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Mask value a paint colour represents.
 *
 * Mask painting uses the foreground's luminance: white reveals, black conceals,
 * and any grey in between lands where its brightness says it should. This is
 * why the colour controls stay meaningful in spirit while the swatch itself is
 * disabled — the artist still picks "how much", just not "which hue".
 */
export function maskValueFromColor(color: readonly [number, number, number, number]): number {
  const luma = (color[0] * 299 + color[1] * 587 + color[2] * 114) / 1000;
  return Math.max(0, Math.min(1, luma / 255));
}

/** Union of two dirty rectangles, either of which may be absent. */
export function unionRect(
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.w, b.x + b.w);
  const bottom = Math.max(a.y + a.h, b.y + b.h);
  return { x, y, w: right - x, h: bottom - y };
}
