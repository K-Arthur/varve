/**
 * Bounded front-facing cylindrical remap for mockup surfaces.
 *
 * This is intentionally a 2.5D operation: it maps a source rectangle across
 * a visible cylinder arc with an orthographic camera. It does not infer a
 * radius, camera perspective, backside, lighting, or hidden content. The
 * destination-to-source mapping is evaluated from the destination pixel
 * footprint, so a drag never accumulates resampling error.
 */

export interface CylindricalWarpOptions {
  /** Cylinder axis in the destination plane. */
  axis: 'vertical' | 'horizontal';
  /** Visible arc in degrees. Validation keeps this in [5, 180]. */
  wrapDegrees: number;
  /** Normalized source phase at the left/top edge of the visible arc. */
  seam: number;
  /** Keep the natural projected arc bounds or fit the arc to the slot. */
  crop: 'visible' | 'slot';
}

const MIN_WRAP_DEGREES = 5;
const MAX_WRAP_DEGREES = 180;
const MAX_OUTPUT_PIXELS = 64_000_000;
const EPSILON = 1e-8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapUnit(value: number): number {
  const wrapped = value - Math.floor(value);
  return wrapped >= 1 ? 0 : wrapped;
}

/**
 * Bilinear source sample with premultiplied-alpha interpolation. Interpolating
 * straight RGB through transparent pixels creates dark or bright fringes on
 * logos with transparent margins; premultiplication keeps the edge color
 * stable before converting back to straight RGBA output.
 */
function sampleBilinearPremultiplied(
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
  const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
  const pixels = [p00, p10, p01, p11];
  let alpha = 0;
  const rgb = [0, 0, 0];
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i]!;
    const weight = weights[i]!;
    const pixelAlpha = src[pixel + 3]! / 255;
    alpha += pixelAlpha * weight;
    for (let channel = 0; channel < 3; channel++) {
      rgb[channel] = rgb[channel]! + src[pixel + channel]! * pixelAlpha * weight;
    }
  }
  if (alpha <= EPSILON) {
    out[outIndex] = 0;
    out[outIndex + 1] = 0;
    out[outIndex + 2] = 0;
    out[outIndex + 3] = 0;
    return;
  }
  out[outIndex] = rgb[0]! / alpha;
  out[outIndex + 1] = rgb[1]! / alpha;
  out[outIndex + 2] = rgb[2]! / alpha;
  out[outIndex + 3] = alpha * 255;
}

function isValidOptions(options: CylindricalWarpOptions): boolean {
  return (
    (options.axis === 'vertical' || options.axis === 'horizontal') &&
    Number.isFinite(options.wrapDegrees) &&
    options.wrapDegrees >= MIN_WRAP_DEGREES &&
    options.wrapDegrees <= MAX_WRAP_DEGREES &&
    Number.isFinite(options.seam) &&
    options.seam >= 0 &&
    options.seam <= 1 &&
    (options.crop === 'visible' || options.crop === 'slot')
  );
}

/**
 * Map an RGBA source image across a bounded cylindrical surface.
 *
 * For a vertical axis, the source X coordinate travels around the visible
 * arc and source Y follows the cylinder axis. For a horizontal axis the
 * equivalent operation uses source Y around the arc. `crop: 'visible'`
 * leaves transparent margins outside the natural orthographic projection;
 * `crop: 'slot'` scales that projected arc to fill the destination slot.
 *
 * Returns null for malformed input or an output that exceeds the bounded
 * CPU allocation budget. Callers must preserve their last-good preview when
 * this happens rather than silently substituting a rectangle.
 */
export function warpImageToCylinder(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  options: CylindricalWarpOptions,
): ImageData | null {
  if (
    !Number.isInteger(srcW) ||
    !Number.isInteger(srcH) ||
    !Number.isInteger(dstW) ||
    !Number.isInteger(dstH) ||
    srcW <= 0 ||
    srcH <= 0 ||
    dstW <= 0 ||
    dstH <= 0 ||
    src.length < srcW * srcH * 4 ||
    dstW * dstH > MAX_OUTPUT_PIXELS ||
    !isValidOptions(options)
  ) {
    return null;
  }

  const arc = (options.wrapDegrees * Math.PI) / 180;
  const halfProjectedWidth = Math.sin(arc / 2);
  if (!Number.isFinite(halfProjectedWidth) || halfProjectedWidth <= EPSILON) return null;

  const out = new ImageData(dstW, dstH);
  const data = out.data;
  const curvedWidth = options.axis === 'vertical' ? dstW : dstH;
  const axisWidth = options.axis === 'vertical' ? dstH : dstW;

  for (let curveIndex = 0; curveIndex < curvedWidth; curveIndex++) {
    // Pixel centers are used for both destination and source coordinates.
    const normalizedPosition = ((curveIndex + 0.5) / curvedWidth) * 2 - 1;
    if (options.crop === 'visible' && Math.abs(normalizedPosition) > halfProjectedWidth) {
      continue;
    }
    const projectedPosition =
      options.crop === 'slot' ? normalizedPosition * halfProjectedWidth : normalizedPosition;
    const theta = Math.asin(clamp(projectedPosition, -1, 1));
    const sourcePhase = wrapUnit(theta / arc + 0.5 + options.seam);
    const sourceCurve = sourcePhase;

    for (let axisIndex = 0; axisIndex < axisWidth; axisIndex++) {
      const axisPhase = (axisIndex + 0.5) / axisWidth;
      const sourceU = options.axis === 'vertical' ? sourceCurve : axisPhase;
      const sourceV = options.axis === 'vertical' ? axisPhase : sourceCurve;
      // Convert normalized center coordinates into the sample convention
      // used by ImageData (pixel centers at n + 0.5).
      const sx = sourceU * srcW - 0.5;
      const sy = sourceV * srcH - 0.5;
      const x = options.axis === 'vertical' ? curveIndex : axisIndex;
      const y = options.axis === 'vertical' ? axisIndex : curveIndex;
      sampleBilinearPremultiplied(src, srcW, srcH, sx, sy, data, (y * dstW + x) * 4);
    }
  }
  return out;
}
