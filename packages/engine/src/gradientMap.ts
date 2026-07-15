/**
 * Gradient map filter — maps image luminance to a configurable gradient ramp.
 *
 * Architecture:
 *   Pre-computes a 256-entry LUT mapping each luminance level to an interpolated
 *   color from the gradient stops. Supports optional ordered dithering for
 *   banding reduction and luminosity preservation.
 *
 * Alpha channel is preserved — transparent pixels are skipped, semi-transparent
 * pixels are mapped proportionally. This ensures correct compositing with masks,
 * clipping, and layer opacity.
 *
 * Research basis: Adobe Photoshop Gradient Map adjustment layer, Affinity Photo
 *   Gradient Map, photographic split-toning concepts.
 */

import type { Color } from './types';

export interface GradientMapStop {
  position: number;
  color: Color;
}

export interface GradientMapParams {
  stops: readonly GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Dither matrix size: 4 or 8. 8×8 = 64 levels, smoother but coarser grain. Default 8. */
  ditherSize?: 4 | 8;
}

/** 4x4 Bayer ordered dither matrix for banding reduction. */
const BAYER_4X4: number[][] = [
  [0.0625, 0.5625, 0.1875, 0.6875],
  [0.8125, 0.3125, 0.9375, 0.4375],
  [0.1875, 0.6875, 0.0625, 0.5625],
  [0.9375, 0.4375, 0.8125, 0.3125],
];

/** 8x8 Bayer ordered dither matrix for higher-quality banding reduction.
 *  Produces 64 distinct threshold levels vs 16 for 4x4, resulting in
 *  smoother tonal transitions at the cost of a slightly coarser grain.
 */
const BAYER_8X8: number[][] = [
  [0.0156, 0.4531, 0.0469, 0.4844, 0.1406, 0.5781, 0.1719, 0.6094],
  [0.7656, 0.2969, 0.7969, 0.3281, 0.8906, 0.4219, 0.9219, 0.4531],
  [0.0469, 0.4844, 0.0156, 0.4531, 0.1719, 0.6094, 0.1406, 0.5781],
  [0.7969, 0.3281, 0.7656, 0.2969, 0.9219, 0.4531, 0.8906, 0.4219],
  [0.1406, 0.5781, 0.1719, 0.6094, 0.0156, 0.4531, 0.0469, 0.4844],
  [0.8906, 0.4219, 0.9219, 0.4531, 0.7656, 0.2969, 0.7969, 0.3281],
  [0.1719, 0.6094, 0.1406, 0.5781, 0.0469, 0.4844, 0.0156, 0.4531],
  [0.9219, 0.4531, 0.8906, 0.4219, 0.7969, 0.3281, 0.7656, 0.2969],
];

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Build a 256-entry LUT mapping luminance (0-255) to RGB colors
 * by interpolating between gradient stops.
 */
export function buildGradientLUT(stops: readonly GradientMapStop[]): {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
} {
  const lutR = new Uint8Array(256);
  const lutG = new Uint8Array(256);
  const lutB = new Uint8Array(256);

  if (stops.length < 2) return { r: lutR, g: lutG, b: lutB };

  // Sort stops by position
  const sorted = [...stops].sort((a, b) => a.position - b.position);

  for (let lum = 0; lum < 256; lum++) {
    const t = lum / 255;

    // Find the two surrounding stops
    let lower = sorted[0]!;
    let upper = sorted[sorted.length - 1]!;

    for (let i = 0; i < sorted.length - 1; i++) {
      if (t >= sorted[i]!.position && t <= sorted[i + 1]!.position) {
        lower = sorted[i]!;
        upper = sorted[i + 1]!;
        break;
      }
    }

    // Interpolate between lower and upper
    const range = upper.position - lower.position;
    const localT = range > 0 ? (t - lower.position) / range : 0;

    const lc = lower.color;
    const uc = upper.color;
    lutR[lum] = Math.round(lc[0] + (uc[0] - lc[0]) * localT);
    lutG[lum] = Math.round(lc[1] + (uc[1] - lc[1]) * localT);
    lutB[lum] = Math.round(lc[2] + (uc[2] - lc[2]) * localT);
  }

  return { r: lutR, g: lutG, b: lutB };
}

/**
 * Apply gradient map to ImageData in-place.
 *
 * - Maps each pixel's luminance (Rec. 709) through the gradient stop ramp
 * - Optionally applies ordered dithering to reduce banding
 * - Optionally preserves original luminance
 * - Preserves alpha channel (skips fully transparent pixels)
 */
export function applyGradientMapFilter(data: ImageData, params: GradientMapParams): ImageData {
  const { stops, dither, preserveLuminosity, ditherSize } = params;
  if (stops.length < 2) return data;

  const pixels = data.data;
  const w = data.width;
  const dSize = ditherSize ?? 8;
  const ditherMatrix = dSize === 4 ? BAYER_4X4 : BAYER_8X8;
  const ditherMask = dSize === 4 ? 3 : 7;

  // Pre-compute LUT
  const { r: lutR, g: lutG, b: lutB } = buildGradientLUT(stops);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;

    // Skip fully transparent pixels — no visual contribution
    if (a === 0) continue;

    // Luminance (Rec. 709 luma coefficients)
    const lum = clampByte(0.2126 * r + 0.7152 * g + 0.0722 * b);

    let mappedLum = lum;

    // Optional ordered dithering for banding reduction
    // Uses document-relative coordinates for viewport-stable dither
    if (dither) {
      const x = Math.round((i / 4) % w);
      const y = Math.floor(i / 4 / w);
      const ditherVal = ((ditherMatrix[y & ditherMask]?.[x & ditherMask] ?? 0.5) - 0.5) * 1.5;
      mappedLum = clampByte(lum + Math.round(ditherVal));
    }

    const nr = lutR[mappedLum]!;
    const ng = lutG[mappedLum]!;
    const nb = lutB[mappedLum]!;

    if (preserveLuminosity) {
      // Scale mapped color to preserve original luminance
      const mappedLum2 = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      const scale = mappedLum > 0 && mappedLum2 > 0 ? lum / mappedLum2 : 1;
      pixels[i] = clampByte(nr * scale);
      pixels[i + 1] = clampByte(ng * scale);
      pixels[i + 2] = clampByte(nb * scale);
    } else {
      pixels[i] = clampByte(nr);
      pixels[i + 1] = clampByte(ng);
      pixels[i + 2] = clampByte(nb);
    }
    // Alpha preserved — no change to pixels[i + 3]
  }

  return data;
}
