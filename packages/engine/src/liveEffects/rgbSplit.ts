/**
 * RGB Split / chromatic aberration kernel.
 *
 * Modes:
 *   offset — independent per-channel displacement (doc pixels)
 *   radial — channels separate with distance from an optical centre
 *
 * Border modes: transparent / clamp / mirror / wrap. Sampling is done on a
 * premultiplied copy so displaced channels never produce dark or white halos
 * at semi-transparent edges; the result is unpremultiplied before return.
 *
 * Offsets are expressed in document pixels and scaled by the caller-provided
 * coordSpace, so a 4px split stays a 4px split at any zoom.
 */

import type { CoordSpace } from './dither';

export type RgbSplitMode = 'offset' | 'radial';

export type BorderMode = 'transparent' | 'clamp' | 'mirror' | 'wrap';

export interface RgbSplitParams {
  mode: RgbSplitMode;
  /** Offset mode: per-channel displacement in document px. */
  redX: number;
  redY: number;
  greenX: number;
  greenY: number;
  blueX: number;
  blueY: number;
  /** Radial mode: separation amount in document px at the max radius. */
  amount: number;
  /** Radial optical centre, normalized 0..1 within the surface. */
  centerX: number;
  centerY: number;
  /** 0..1 radial falloff exponent (0 = uniform, 1 = linear, >1 = edge-weighted). */
  falloff: number;
  /** Fringe direction bias in degrees (rotates the channel separation axis). */
  fringeAngle: number;
  borderMode: BorderMode;
  /** 0..1 global intensity scaling. */
  intensity: number;
}

/** Apply RGB split in place. Returns the same ImageData. */
export function applyRgbSplit(
  imageData: ImageData,
  params: RgbSplitParams,
  coordSpace?: CoordSpace,
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;
  const scale = coordSpace && coordSpace.scale > 0 ? coordSpace.scale : 1;
  const intensity = clamp01(params.intensity ?? 1);
  if (intensity <= 0) return imageData;

  const src = new Uint8ClampedArray(data);
  premultiply(src);

  const mode = params.mode ?? 'offset';
  let redX = 0;
  let redY = 0;
  let greenX = 0;
  let greenY = 0;
  let blueX = 0;
  let blueY = 0;
  if (mode === 'offset') {
    redX = (params.redX ?? 0) * scale * intensity;
    redY = (params.redY ?? 0) * scale * intensity;
    greenX = (params.greenX ?? 0) * scale * intensity;
    greenY = (params.greenY ?? 0) * scale * intensity;
    blueX = (params.blueX ?? 0) * scale * intensity;
    blueY = (params.blueY ?? 0) * scale * intensity;
  } else {
    const amount = (params.amount ?? 4) * scale * intensity;
    const falloff = Math.max(0, params.falloff ?? 1);
    const angle = ((params.fringeAngle ?? 0) * Math.PI) / 180;
    const cx = (params.centerX ?? 0.5) * w;
    const cy = (params.centerY ?? 0.5) * h;
    const maxR = Math.max(1, Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)));
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        const r = Math.hypot(x - cx, y - cy) / maxR;
        const t = r ** falloff * amount;
        const dx = t * Math.cos(angle);
        const dy = t * Math.sin(angle);
        const n = interpolate(src, w, h, x, y, 0, dx, dy, params.borderMode);
        const ng = interpolate(src, w, h, x, y, 1, 0, 0, params.borderMode);
        const nb = interpolate(src, w, h, x, y, 2, -dx, -dy, params.borderMode);
        data[o] = n;
        data[o + 1] = ng;
        data[o + 2] = nb;
      }
    }
  }

  if (mode === 'offset') {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        data[o] = interpolate(src, w, h, x, y, 0, redX, redY, params.borderMode);
        data[o + 1] = interpolate(src, w, h, x, y, 1, greenX, greenY, params.borderMode);
        data[o + 2] = interpolate(src, w, h, x, y, 2, blueX, blueY, params.borderMode);
      }
    }
  }

  unpremultiply(data);
  return imageData;
}

/** Bilinear sample of channel c at (x + dx, y + dy) with border policy. */
function interpolate(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: number,
  dx: number,
  dy: number,
  border: BorderMode,
): number {
  const sx = x + dx;
  const sy = y + dy;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const a = sampleClamped(src, w, h, x0, y0, c, border);
  const b = sampleClamped(src, w, h, x0 + 1, y0, c, border);
  const d = sampleClamped(src, w, h, x0, y0 + 1, c, border);
  const e = sampleClamped(src, w, h, x0 + 1, y0 + 1, c, border);
  return Math.round(a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy);
}

function sampleClamped(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: number,
  border: BorderMode,
): number {
  let ix = x;
  let iy = y;
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) {
    switch (border) {
      case 'transparent':
        return 0;
      case 'clamp':
        ix = Math.max(0, Math.min(w - 1, ix));
        iy = Math.max(0, Math.min(h - 1, iy));
        break;
      case 'wrap':
        ix = ((ix % w) + w) % w;
        iy = ((iy % h) + h) % h;
        break;
      case 'mirror': {
        const period = 2 * w;
        ix = ((ix % period) + period) % period;
        if (ix >= w) ix = period - ix - 1;
        const periodY = 2 * h;
        iy = ((iy % periodY) + periodY) % periodY;
        if (iy >= h) iy = periodY - iy - 1;
        break;
      }
    }
  }
  return src[(iy * w + ix) * 4 + c]!;
}

function premultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 255) continue;
    if (a === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = Math.round((data[i]! * a) / 255);
    data[i + 1] = Math.round((data[i + 1]! * a) / 255);
    data[i + 2] = Math.round((data[i + 2]! * a) / 255);
  }
}

function unpremultiply(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0 || a === 255) continue;
    const inv = 255 / a;
    data[i] = clampByte(data[i]! * inv);
    data[i + 1] = clampByte(data[i + 1]! * inv);
    data[i + 2] = clampByte(data[i + 2]! * inv);
  }
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
