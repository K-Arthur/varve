/**
 * Gradient map filter — maps rendered tonal value to a color ramp.
 *
 * A gradient map converts each source pixel to a scalar tonal value and uses
 * that value to sample a color gradient (an ordered LUT). It is intentionally
 * distinct from a spatial `GradientFill`: the ramp position is derived from
 * luminance/tonal content, not from object coordinates.
 *
 * Architecture:
 *   Pre-computes a bounded LUT (256/1024/4096 samples) mapping each tonal
 *   value to an interpolated color from the gradient stops. Interpolation
 *   reuses the shared color-interpolation primitives (`@strata/shared`
 *   `sampleGradientColor` / `applyMidpointBias`), so gradient-map stops
 *   blend identically to fill-gradient stops in the same space. Supports
 *   optional ordered dithering (Bayer) for banding reduction.
 *
 * Alpha handling (premultiplied-safe):
 *   - `preserveSourceAlpha` (default true) keeps the source alpha untouched,
 *     so transparent pixels never develop dark/colored fringes.
 *   - When disabled, the gradient's opacity stops modulate the source alpha.
 *   - Fully transparent pixels are skipped entirely.
 *
 * Research basis: Adobe Photoshop Gradient Map adjustment layer, Affinity
 *   Photo Gradient Map, photographic split-toning concepts.
 */

import type { GradientInterpolationSpace } from '@strata/shared';
import { applyMidpointBias, interpolateManagedColor } from '@strata/shared';
import type { Color } from './types';

export interface GradientMapStop {
  position: number;
  color: Color;
  /** Per-stop opacity (0-1, default 1). Folded into the alpha LUT when no
   *  explicit `opacityStops` ramp is supplied. */
  opacity?: number;
  /** Midpoint position (0-1, default 0.5) between this stop and the next. */
  midpoint?: number;
}

export interface GradientMapOpacityStop {
  position: number;
  /** Midpoint position (0-1, default 0.5). */
  midpoint?: number;
  /** Normalized opacity 0-1. */
  opacity: number;
}

/**
 * Tonal source for the 0-1 ramp input. Only `relative-luminance`
 * (default), `perceptual-lightness`, `average-rgb`, and `max-channel` are
 * exposed in the UI; the rest exist for compatibility with imported assets.
 */
export type GradientMapLuminanceMode =
  | 'relative-luminance'
  | 'perceptual-lightness'
  | 'average-rgb'
  | 'max-channel'
  | 'alpha'
  | 'red'
  | 'green'
  | 'blue'
  | 'compatibility';

export interface GradientMapParams {
  stops: readonly GradientMapStop[];
  dither: boolean;
  preserveLuminosity: boolean;
  /** Bayer matrix size: 4 or 8. 8×8 = 64 levels, smoother but coarser grain. Default 8. */
  ditherSize?: 4 | 8;
  /** Mapping mode: 'luminance' (default) maps tonal value through one gradient;
   *  'channel' maps R, G, B independently through channelStops. */
  mode?: 'luminance' | 'channel';
  /** Per-channel gradient stops for channel-aware mode. */
  channelStops?: {
    r?: readonly GradientMapStop[];
    g?: readonly GradientMapStop[];
    b?: readonly GradientMapStop[];
  };
  /** Independent opacity ramp (defaults to full opacity). */
  opacityStops?: readonly GradientMapOpacityStop[];
  /** Reverse the ramp (shadows sample the last stop). Default false. */
  reverse?: boolean;
  /** Mix with the source: 0 = unchanged, 1 = fully mapped. Default 1. */
  intensity?: number;
  /** Tonal source. Default 'relative-luminance'. */
  luminanceMode?: GradientMapLuminanceMode;
  /** Keep source alpha untouched. Default true. */
  preserveSourceAlpha?: boolean;
  /** Interpolation space for stop blending. Legacy default: 'srgb'. */
  interpolation?: GradientInterpolationSpace;
  /** LUT resolution. Default 256. */
  lutSize?: number;
}

export interface GradientLut {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  /** Number of LUT entries. */
  lutSize: number;
}

/** Default LUT resolution. 256 entries matches 8-bit input precision. */
export const DEFAULT_GRADIENT_LUT_SIZE = 256;

/** 4x4 Bayer ordered dither matrix for banding reduction. */
const BAYER_4X4: number[][] = [
  [0.0625, 0.5625, 0.1875, 0.6875],
  [0.8125, 0.3125, 0.9375, 0.4375],
  [0.1875, 0.6875, 0.0625, 0.5625],
  [0.9375, 0.4375, 0.8125, 0.3125],
];

/** 8x8 Bayer ordered dither matrix (64 distinct threshold levels). */
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

function clamp01(v: number): number {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

/** Map a stop list to the shared interpolation input shape (sRGB RGBA). */
function toInterpolationStops(stops: readonly GradientMapStop[]): {
  position: number;
  color: { space: 'rgb'; r: number; g: number; b: number; a: number };
  midpoint?: number;
}[] {
  return stops.map((s) => ({
    position: s.position,
    color: {
      space: 'rgb' as const,
      r: s.color[0],
      g: s.color[1],
      b: s.color[2],
      a: 255,
    },
    midpoint: s.midpoint ?? 0.5,
  }));
}

export interface GradientColorLutOptions {
  size?: number;
  interpolation?: GradientInterpolationSpace;
  reverse?: boolean;
}

/**
 * Build a color LUT mapping tonal value (0..size-1) to an interpolated color.
 *
 * - `reverse` flips the ramp (t = 1 - t).
 * - Midpoint semantics follow Photoshop's gradient format: a stop's midpoint
 *   governs the segment between it and the previous stop (the upper stop of
 *   the segment). This matches how `.grd` files store per-stop midpoints and
 *   differs from fill gradients (`@strata/shared`), which attach the midpoint
 *   to the lower stop. The color math itself reuses the shared
 *   `interpolateManagedColor`, so blending matches fill gradients in the
 *   same interpolation space.
 */
export function buildGradientColorLut(
  stops: readonly GradientMapStop[],
  opts: GradientColorLutOptions = {},
): GradientLut {
  const size = opts.size ?? DEFAULT_GRADIENT_LUT_SIZE;
  const lutR = new Uint8Array(size);
  const lutG = new Uint8Array(size);
  const lutB = new Uint8Array(size);

  if (stops.length < 2) return { r: lutR, g: lutG, b: lutB, lutSize: size };

  const space = opts.interpolation ?? 'srgb';
  const sorted = [...stops]
    .map((s) => ({ ...s, position: Math.max(0, Math.min(1, s.position)) }))
    .sort((a, b) => a.position - b.position);
  const inputs = toInterpolationStops(sorted);

  for (let i = 0; i < size; i++) {
    let t = size > 1 ? i / (size - 1) : 0;
    if (opts.reverse) t = 1 - t;

    const c = interpolateGradientMapColor(inputs, t, space);
    lutR[i] = c.r;
    lutG[i] = c.g;
    lutB[i] = c.b;
  }

  return { r: lutR, g: lutG, b: lutB, lutSize: size };
}

/**
 * Sample the ramp at `t` using Photoshop-style midpoint attachment
 * (the upper stop of each segment provides the midpoint bias).
 */
export function interpolateGradientMapColor(
  stops: ReturnType<typeof toInterpolationStops>,
  t: number,
  space: GradientInterpolationSpace,
): { space: 'rgb'; r: number; g: number; b: number; a: number } {
  if (stops.length === 0) return { space: 'rgb', r: 0, g: 0, b: 0, a: 0 };
  if (stops.length === 1)
    return {
      space: 'rgb',
      r: stops[0]!.color.r,
      g: stops[0]!.color.g,
      b: stops[0]!.color.b,
      a: 255,
    };
  const p = Math.max(0, Math.min(1, t));
  if (p <= stops[0]!.position) return stops[0]!.color;
  const last = stops[stops.length - 1]!;
  if (p >= last.position) return last.color;

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (p >= a.position && p <= b.position) {
      const span = b.position - a.position;
      const linearT = span === 0 ? 0 : (p - a.position) / span;
      const midpoint = b.midpoint ?? 0.5;
      const blendT = applyMidpointBias(linearT, midpoint);
      return interpolateManagedColor(a.color, b.color, blendT, space);
    }
  }
  return last.color;
}

/** Legacy 256-entry sRGB LUT builder (backward-compatible surface). */
export function buildGradientLUT(stops: readonly GradientMapStop[]): GradientLut {
  return buildGradientColorLut(stops, { size: DEFAULT_GRADIENT_LUT_SIZE, interpolation: 'srgb' });
}

/** Normalize combined opacity stops (dedupe by position, first wins). */
function normalizeOpacityStops(
  stops: ReadonlyArray<{ position: number; midpoint?: number; opacity: number }>,
): {
  position: number;
  midpoint: number;
  opacity: number;
}[] {
  const seen = new Map<number, { position: number; midpoint: number; opacity: number }>();
  for (const s of stops) {
    const position = clamp01(s.position);
    if (seen.has(position)) continue;
    seen.set(position, {
      position,
      midpoint: clamp01(s.midpoint ?? 0.5),
      opacity: clamp01(s.opacity),
    });
  }
  return [...seen.values()].sort((a, b) => a.position - b.position);
}

/**
 * Build an alpha LUT from opacity stops (per-stop opacities + explicit ramp).
 * Uses the same midpoint-bias formula as the color path.
 */
export function buildGradientAlphaLut(
  stops: readonly GradientMapStop[],
  opacityStops: readonly GradientMapOpacityStop[] | undefined,
  size: number,
): Uint8Array {
  const lut = new Uint8Array(size);
  if (size === 0) return lut;

  let combined: { position: number; midpoint?: number; opacity: number }[] = [];
  if (opacityStops && opacityStops.length > 0) {
    combined = opacityStops.map((s) => ({
      position: s.position,
      midpoint: s.midpoint,
      opacity: s.opacity,
    }));
  } else {
    const fromStops = stops
      .filter((s) => s.opacity !== undefined && s.opacity !== 1)
      .map((s) => ({ position: s.position, midpoint: s.midpoint, opacity: s.opacity ?? 1 }));
    if (fromStops.length === 0) {
      lut.fill(255);
      return lut;
    }
    combined = fromStops;
  }

  const normalized = normalizeOpacityStops(combined);
  if (normalized.length === 0) {
    lut.fill(255);
    return lut;
  }

  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0;
    let opacity: number;
    if (t <= normalized[0]!.position) {
      opacity = normalized[0]!.opacity;
    } else if (t >= normalized[normalized.length - 1]!.position) {
      opacity = normalized[normalized.length - 1]!.opacity;
    } else {
      let lo = normalized[0]!;
      let hi = normalized[normalized.length - 1]!;
      for (let j = 0; j < normalized.length - 1; j++) {
        if (t >= normalized[j]!.position && t <= normalized[j + 1]!.position) {
          lo = normalized[j]!;
          hi = normalized[j + 1]!;
          break;
        }
      }
      const span = hi.position - lo.position;
      const linearT = span === 0 ? 0 : (t - lo.position) / span;
      const blendT = applyMidpointBias(linearT, hi.midpoint);
      opacity = lo.opacity + (hi.opacity - lo.opacity) * blendT;
    }
    lut[i] = clampByte(opacity * 255);
  }
  return lut;
}

/**
 * Compute the tonal value (0-255) that samples the ramp.
 * Fast path inlines Rec.709 relative luminance for the default mode.
 */
function tonalValue(
  mode: GradientMapLuminanceMode,
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  switch (mode) {
    case 'relative-luminance':
    case 'compatibility':
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    case 'perceptual-lightness': {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
      const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
      const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
      const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
      const l1 = Math.cbrt(l);
      const m1 = Math.cbrt(m);
      const s1 = Math.cbrt(s);
      const L = 0.2104542553 * l1 + 0.793617785 * m1 - 0.0040720468 * s1;
      return Math.max(0, Math.min(1, L)) * 255;
    }
    case 'average-rgb':
      return (r + g + b) / 3;
    case 'max-channel':
      return Math.max(r, g, b);
    case 'alpha':
      return a;
    case 'red':
      return r;
    case 'green':
      return g;
    case 'blue':
      return b;
  }
}

/**
 * Apply gradient map to ImageData in-place.
 *
 * Two modes:
 * - 'luminance' (default): maps each pixel's tonal value through the ramp.
 * - 'channel': maps R, G, B independently through per-channel stops.
 *
 * Options: ordered dithering (deterministic Bayer, disableable), luminosity
 * preservation, intensity mixing, reverse, independent opacity ramp, and
 * configurable tonal source. Alpha is premultiplied-safe.
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

  const rawLutSize = params.lutSize ?? DEFAULT_GRADIENT_LUT_SIZE;
  const lutSize = Math.min(4096, Math.max(64, Math.round(rawLutSize)));
  const intensity = clamp01(params.intensity ?? 1);
  const preserveSourceAlpha = params.preserveSourceAlpha ?? true;
  const luminanceMode = params.luminanceMode ?? 'relative-luminance';

  const lutOpts: GradientColorLutOptions = {
    size: lutSize,
    interpolation: params.interpolation ?? 'srgb',
    reverse: params.reverse,
  };
  const lut = buildGradientColorLut(stops, lutOpts);
  const alphaLut = buildGradientAlphaLut(stops, params.opacityStops, lutSize);

  // Channel-mode LUTs: per-channel stops fall back to main stops if not provided
  const channelStops = params.channelStops;
  const rLut = mode === 'channel' ? buildGradientColorLut(channelStops?.r ?? stops, lutOpts) : null;
  const gLut = mode === 'channel' ? buildGradientColorLut(channelStops?.g ?? stops, lutOpts) : null;
  const bLut = mode === 'channel' ? buildGradientColorLut(channelStops?.b ?? stops, lutOpts) : null;

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
      nr = rLut!.r[r]!;
      ng = gLut!.g[g]!;
      nb = bLut!.b[b]!;
    } else {
      let tonal = tonalValue(luminanceMode, r, g, b, a);

      // Optional ordered dithering for banding reduction (deterministic).
      if (dither) {
        const x = Math.round((i / 4) % w);
        const y = Math.floor(i / 4 / w);
        const ditherVal = ((ditherMatrix[y & ditherMask]?.[x & ditherMask] ?? 0.5) - 0.5) * 1.5;
        tonal = clampByte(tonal + ditherVal);
      }

      const idx = clampByte(tonal);
      nr = lut.r[idx]!;
      ng = lut.g[idx]!;
      nb = lut.b[idx]!;
    }

    // Intensity: mix the mapped color back toward the source.
    if (intensity < 1) {
      nr = r + (nr - r) * intensity;
      ng = g + (ng - g) * intensity;
      nb = b + (nb - b) * intensity;
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

    // Alpha: source alpha by default; gradient opacity ramp when opted out.
    if (!preserveSourceAlpha) {
      const rampIdx = clampByte(tonalValue(luminanceMode, r, g, b, a));
      const rampAlpha = alphaLut[rampIdx] ?? 255;
      pixels[i + 3] = clampByte((a * rampAlpha) / 255);
    }
  }

  return data;
}
