/**
 * Paint coverage masks — the canonical way every paint tool is clipped.
 *
 * A `CoverageMask` is an 8-bit alpha rectangle in *layer pixel space*. Anything
 * that restricts where paint may land expresses itself as one of these:
 * a pixel selection (including feathered ones), a clipping region, or a
 * tool-specific restriction. The compositor multiplies dab coverage by the mask
 * value, so soft selections attenuate paint instead of hard-clipping it, and
 * every tool that goes through the compositor inherits the same behaviour for
 * free rather than reimplementing containment tests.
 *
 * Outside the mask rectangle the value is 0 — a mask is a positive statement of
 * where painting is allowed, so "no mask" (null/undefined) means unrestricted
 * and an *empty* mask means nothing may be painted.
 */

export interface CoverageMask {
  /** Left edge in layer pixels. */
  x: number;
  /** Top edge in layer pixels. */
  y: number;
  width: number;
  height: number;
  /** Row-major 8-bit alpha, length = width * height. */
  data: Uint8Array;
}

export function makeCoverageMask(
  x: number,
  y: number,
  width: number,
  height: number,
  fill = 0,
): CoverageMask {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  const data = new Uint8Array(w * h);
  if (fill > 0) data.fill(Math.max(0, Math.min(255, Math.round(fill))));
  return { x: Math.floor(x), y: Math.floor(y), width: w, height: h, data };
}

/** Coverage at a layer pixel, 0-1. Returns 0 outside the mask rectangle. */
export function sampleCoverage(mask: CoverageMask, px: number, py: number): number {
  const lx = px - mask.x;
  const ly = py - mask.y;
  if (lx < 0 || ly < 0 || lx >= mask.width || ly >= mask.height) return 0;
  return mask.data[ly * mask.width + lx]! / 255;
}

/** True when no pixel in the mask allows any paint. */
export function isCoverageEmpty(mask: CoverageMask): boolean {
  if (mask.width === 0 || mask.height === 0) return true;
  return !mask.data.some((v) => v > 0);
}

/** Invert a mask in place over its own rectangle (for inverted selections). */
export function invertCoverage(mask: CoverageMask): CoverageMask {
  const data = new Uint8Array(mask.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 255 - mask.data[i]!;
  return { ...mask, data };
}

/**
 * Rectangular coverage with a feathered border, in layer pixels.
 * `feather` is the radius over which coverage ramps 0→1 inside the rectangle.
 */
export function featheredRectCoverage(
  x: number,
  y: number,
  width: number,
  height: number,
  feather = 0,
): CoverageMask {
  const mask = makeCoverageMask(x, y, width, height);
  const f = Math.max(0, feather);
  for (let row = 0; row < mask.height; row++) {
    for (let col = 0; col < mask.width; col++) {
      const distX = Math.min(col + 0.5, mask.width - col - 0.5);
      const distY = Math.min(row + 0.5, mask.height - row - 0.5);
      const dist = Math.min(distX, distY);
      const v = f <= 0 ? 1 : Math.max(0, Math.min(1, dist / f));
      mask.data[row * mask.width + col] = Math.round(v * 255);
    }
  }
  return mask;
}

/** Intersect two coverage masks (multiply). The result spans the overlap. */
export function intersectCoverage(a: CoverageMask, b: CoverageMask): CoverageMask {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = makeCoverageMask(x0, y0, w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const av = sampleCoverage(a, x0 + col, y0 + row);
      const bv = sampleCoverage(b, x0 + col, y0 + row);
      out.data[row * w + col] = Math.round(av * bv * 255);
    }
  }
  return out;
}
