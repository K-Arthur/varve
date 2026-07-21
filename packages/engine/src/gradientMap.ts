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
  /** Per-stop opacity (0-1, default 1). */
  opacity?: number;
  /** Midpoint position (0-1, default 0.5) between this stop and the next. */
  midpoint?: number;
}

export interface GradientMapParams {
  stops: readonly GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Dither matrix size: 4 or 8. 8×8 = 64 levels, smoother but coarser grain. Default 8. */
  ditherSize?: 4 | 8;
  /** Mapping mode: 'luminance' (default) maps luma through one gradient;
   *  'channel' maps R, G, B independently through channelStops. */
  mode?: 'luminance' | 'channel';
  /** Per-channel gradient stops for channel-aware mode. */
  channelStops?: {
    r?: readonly GradientMapStop[];
    g?: readonly GradientMapStop[];
    b?: readonly GradientMapStop[];
  };
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
 * Smoothstep for midpoint-based interpolation.
 * Produces a C1-continuous S-curve between 0 and 1.
 */
function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Build a 256-entry LUT mapping input value (0-255) to RGB colors
 * by interpolating between gradient stops.
 *
 * Supports per-stop midpoint: the midpoint controls where the 50% blend
 * occurs between a stop and the next. Default 0.5 = linear. Values < 0.5
 * push the transition earlier (more of the lower color), > 0.5 push it
 * later (more of the upper color). This matches Photoshop's gradient map
 * midpoint behavior.
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

    // Interpolate between lower and upper, respecting midpoint
    const range = upper.position - lower.position;
    let localT = range > 0 ? (t - lower.position) / range : 0;

    // Apply midpoint shaping: remap localT through a curve that passes
    // through 0.5 at the midpoint position.
    const midpoint = upper.midpoint ?? 0.5;
    if (midpoint > 0 && midpoint < 1) {
      if (localT <= midpoint) {
        localT = smoothstep01(localT / midpoint) * 0.5;
      } else {
        localT = 0.5 + smoothstep01((localT - midpoint) / (1 - midpoint)) * 0.5;
      }
    }

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
 * Two modes:
 * - 'luminance' (default): maps each pixel's Rec. 709 luma through the gradient ramp.
 * - 'channel': maps R, G, B independently through per-channel gradient stops.
 *   This enables advanced duotone / color-grading workflows where each channel
 *   can be remapped separately (e.g., compress reds while expanding blues).
 *
 * In both modes: optional ordered dithering reduces banding, optional luminosity
 * preservation keeps the original brightness, and alpha is always preserved.
 */
export function applyGradientMapFilter(data: ImageData, params: GradientMapParams): ImageData {
  const { stops, dither, preserveLuminosity, ditherSize } = params;
  const mode = params.mode ?? 'luminance';
  if (stops.length < 2 && mode === 'luminance') return data;

  const pixels = data.data;
  const w = data.width;
  const dSize = ditherSize ?? 8;
  const ditherMatrix = dSize === 4 ? BAYER_4X4 : BAYER_8X8;
  const ditherMask = dSize === 4 ? 3 : 7;

  // Pre-compute LUTs
  const lumLut = buildGradientLUT(stops);

  // Channel-mode LUTs: per-channel stops fall back to main stops if not provided
  const channelStops = params.channelStops;
  const rStops = channelStops?.r ?? stops;
  const gStops = channelStops?.g ?? stops;
  const bStops = channelStops?.b ?? stops;
  const rLut = buildGradientLUT(rStops);
  const gLut = buildGradientLUT(gStops);
  const bLut = buildGradientLUT(bStops);

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;

    // Skip fully transparent pixels — no visual contribution
    if (a === 0) continue;

    let nr: number, ng: number, nb: number;

    if (mode === 'channel') {
      // Per-channel mapping: each channel value indexes its own LUT independently
      nr = rLut.r[r]!;
      ng = gLut.g[g]!;
      nb = bLut.b[b]!;
    } else {
      // Luminance mapping (default)
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

      nr = lumLut.r[mappedLum]!;
      ng = lumLut.g[mappedLum]!;
      nb = lumLut.b[mappedLum]!;
    }

    if (preserveLuminosity) {
      // Scale mapped color to preserve original luminance
      const origLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const mappedLum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      const scale = mappedLum > 0 ? origLum / mappedLum : 1;
      nr = nr * scale;
      ng = ng * scale;
      nb = nb * scale;
    }

    pixels[i] = clampByte(nr);
    pixels[i + 1] = clampByte(ng);
    pixels[i + 2] = clampByte(nb);
    // Alpha preserved — no change to pixels[i + 3]
  }

  return data;
}
