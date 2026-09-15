import type { ImageTreatmentSpace } from '../imageTreatments';
import { bounded, occupiedBounds, rasterVector } from './spatialSampling';

export interface MotionBlurParams {
  /** Full line length in object units, with transparent samples outside the surface. */
  distance: number;
  angle: number;
}

interface Tap {
  x: number;
  y: number;
  weight: number;
}

/** Bilinear, normalized line-integration stencil; duplicates share one tap. */
function lineTaps(dx: number, dy: number): Tap[] {
  const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2) + 1);
  if (count > 2049)
    throw new RangeError(
      'Directional Blur exceeds 1024 raster pixels; reduce distance or export scale.',
    );
  const taps = new Map<string, Tap>();
  for (let n = 0; n < count; n++) {
    const t = count === 1 ? 0 : n / (count - 1) - 0.5;
    const sx = dx * t;
    const sy = dy * t;
    const x = Math.floor(sx);
    const y = Math.floor(sy);
    const fx = sx - x;
    const fy = sy - y;
    for (let oy = 0; oy < 2; oy++) {
      for (let ox = 0; ox < 2; ox++) {
        const weight = ((ox ? fx : 1 - fx) * (oy ? fy : 1 - fy)) / count;
        if (weight === 0) continue;
        const key = `${x + ox},${y + oy}`;
        const existing = taps.get(key);
        if (existing) existing.weight += weight;
        else taps.set(key, { x: x + ox, y: y + oy, weight });
      }
    }
  }
  return [...taps.values()];
}

/**
 * Finite directional line blur in premultiplied, encoded sRGB. Unlike Gaussian
 * blur it spreads only along the authored direction. Alpha spreads with RGB;
 * hidden colours never contribute. Work is bounded to occupied pixels + support.
 */
export function applyMotionBlur(
  image: ImageData,
  params: MotionBlurParams,
  space?: ImageTreatmentSpace,
): ImageData {
  const distance = bounded(params.distance, 0, 128, 16);
  const bounds = occupiedBounds(image);
  if (distance === 0 || !bounds) return image;
  const angle = (bounded(params.angle, -180, 180, 0) * Math.PI) / 180;
  const [dx, dy] = rasterVector(Math.cos(angle) * distance, Math.sin(angle) * distance, space);
  const taps = lineTaps(dx, dy);
  const out = new ImageData(image.width, image.height);
  const padX = Math.ceil(Math.abs(dx) / 2 + 1);
  const padY = Math.ceil(Math.abs(dy) / 2 + 1);
  for (let y = Math.max(0, bounds[1] - padY); y < Math.min(image.height, bounds[3] + padY); y++) {
    for (let x = Math.max(0, bounds[0] - padX); x < Math.min(image.width, bounds[2] + padX); x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      for (const tap of taps) {
        const sx = x + tap.x;
        const sy = y + tap.y;
        if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
        const offset = (sy * image.width + sx) * 4;
        const weight = image.data[offset + 3]! * tap.weight;
        alpha += weight;
        r += image.data[offset]! * weight;
        g += image.data[offset + 1]! * weight;
        b += image.data[offset + 2]! * weight;
      }
      const offset = (y * image.width + x) * 4;
      if (alpha > 0) {
        out.data[offset] = Math.round(r / alpha);
        out.data[offset + 1] = Math.round(g / alpha);
        out.data[offset + 2] = Math.round(b / alpha);
        out.data[offset + 3] = Math.round(alpha);
      }
    }
  }
  return out;
}
