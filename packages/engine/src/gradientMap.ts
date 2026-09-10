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
 *   reuses the shared color-interpolation primitives (`@varve/shared`
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

import type { GradientInterpolationSpace } from '@varve/shared';
import { applyMidpointBias, interpolateManagedColor } from '@varve/shared';
import type { Color } from './types';

export interface GradientMapStop {
  /** Stable identity for editor/persistence operations. */
  id?: string;
  position: number;
  color: Color;
  /** Per-stop opacity (0-1, default 1). Folded into the alpha LUT when no
   *  explicit `opacityStops` ramp is supplied. */
  opacity?: number;
  /** Midpoint position (0-1, default 0.5) between this stop and the next. */
  midpoint?: number;
}

export interface GradientMapOpacityStop {
  /** Stable identity for editor/persistence operations. */
  id?: string;
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
  /** Version of the documented gradient-map algorithm. v1 preserves the
   * legacy encoded-channel luma; v2 uses linear-sRGB relative luminance. */
  algorithmVersion?: 1 | 2;
  /** Stable image-space anchor for ordered dither. Defaults to (0, 0). */
  ditherOriginX?: number;
  ditherOriginY?: number;
}

export interface GradientLut {
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  /** Interpolated stop alpha, retained for consumers that need the ramp alpha. */
  a: Uint8Array;
  /** Number of LUT entries. */
  lutSize: number;
}

/** Default LUT resolution. 256 entries matches 8-bit input precision. */
export const DEFAULT_GRADIENT_LUT_SIZE = 256;
export const GRADIENT_MAP_ALGORITHM_VERSION = 1 as const;

/** 4x4 Bayer ordered dither matrix for banding reduction. */
const BAYER_4X4: number[][] = [
  [0.0625, 0.5625, 0.1875, 0.6875],
  [0.8125, 0.3125, 0.9375, 0.4375],
  [0.1875, 0.6875, 0.0625, 0.5625],
  [0.9375, 0.4375, 0.8125, 0.3125],
];

/** Standard 8x8 Bayer ordered dither matrix (64 unique, zero-mean levels). */
const BAYER_8X8: number[][] = [
  [0.0078125, 0.5078125, 0.1328125, 0.6328125, 0.0390625, 0.5390625, 0.1640625, 0.6640625],
  [0.7578125, 0.2578125, 0.8828125, 0.3828125, 0.7890625, 0.2890625, 0.9140625, 0.4140625],
  [0.1953125, 0.6953125, 0.0703125, 0.5703125, 0.2265625, 0.7265625, 0.1015625, 0.6015625],
  [0.9453125, 0.4453125, 0.8203125, 0.3203125, 0.9765625, 0.4765625, 0.8515625, 0.3515625],
  [0.0546875, 0.5546875, 0.1796875, 0.6796875, 0.0234375, 0.5234375, 0.1484375, 0.6484375],
  [0.8046875, 0.3046875, 0.9296875, 0.4296875, 0.7734375, 0.2734375, 0.8984375, 0.3984375],
  [0.2421875, 0.7421875, 0.1171875, 0.6171875, 0.2109375, 0.7109375, 0.0859375, 0.5859375],
  [0.9921875, 0.4921875, 0.8671875, 0.3671875, 0.9609375, 0.4609375, 0.8359375, 0.3359375],
];

/** Expose a copy for deterministic quality tests without allowing mutation. */
export function getGradientMapDitherMatrix(size: 4 | 8 = 8): readonly (readonly number[])[] {
  const matrix = size === 4 ? BAYER_4X4 : BAYER_8X8;
  return matrix.map((row) => [...row]);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number, fallback = 1): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function clampByteWithFallback(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clampByte(v) : fallback;
}

function normalizeGradientStop(
  stop: GradientMapStop,
  index: number,
  count: number,
): GradientMapStop {
  const fallbackPosition = count > 1 ? index / (count - 1) : 0;
  return {
    ...stop,
    position: Number.isFinite(stop.position)
      ? Math.max(0, Math.min(1, stop.position))
      : fallbackPosition,
    color: [
      clampByteWithFallback(stop.color?.[0], 0),
      clampByteWithFallback(stop.color?.[1], 0),
      clampByteWithFallback(stop.color?.[2], 0),
      clampByteWithFallback(stop.color?.[3], 255),
    ],
    ...(stop.opacity === undefined ? {} : { opacity: clamp01(stop.opacity) }),
    ...(stop.midpoint === undefined ? {} : { midpoint: clamp01(stop.midpoint, 0.5) }),
  };
}

function normalizeLutSize(value: number | undefined, fallback: number): number {
  const raw = Number.isFinite(value) ? Math.round(value!) : fallback;
  return Math.max(2, Math.min(4096, raw));
}

/** Map a stop list to the shared interpolation input shape (sRGB RGBA). */
function toInterpolationStops(stops: readonly GradientMapStop[]): {
  position: number;
  color: { space: 'rgb'; r: number; g: number; b: number; a: number };
  midpoint?: number;
}[] {
  return stops
    .map((stop, index) => ({
      stop: normalizeGradientStop(stop, index, stops.length),
      order: index,
    }))
    .sort((a, b) => a.stop.position - b.stop.position || a.order - b.order)
    .map(({ stop }) => ({
      position: stop.position,
      color: {
        space: 'rgb' as const,
        r: stop.color[0],
        g: stop.color[1],
        b: stop.color[2],
        a: stop.color[3] ?? 255,
      },
      midpoint: stop.midpoint ?? 0.5,
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
 *   differs from fill gradients (`@varve/shared`), which attach the midpoint
 *   to the lower stop. The color math itself reuses the shared
 *   `interpolateManagedColor`, so blending matches fill gradients in the
 *   same interpolation space.
 */
export function buildGradientColorLut(
  stops: readonly GradientMapStop[],
  opts: GradientColorLutOptions = {},
): GradientLut {
  const size = normalizeLutSize(opts.size, DEFAULT_GRADIENT_LUT_SIZE);
  const lutR = new Uint8Array(size);
  const lutG = new Uint8Array(size);
  const lutB = new Uint8Array(size);
  const lutA = new Uint8Array(size);

  if (stops.length < 2) return { r: lutR, g: lutG, b: lutB, a: lutA, lutSize: size };

  const space = opts.interpolation ?? 'srgb';
  const inputs = toInterpolationStops(stops);

  for (let i = 0; i < size; i++) {
    let t = size > 1 ? i / (size - 1) : 0;
    if (opts.reverse) t = 1 - t;

    const c = interpolateGradientMapColor(inputs, t, space);
    lutR[i] = c.r;
    lutG[i] = c.g;
    lutB[i] = c.b;
    lutA[i] = c.a;
  }

  return { r: lutR, g: lutG, b: lutB, a: lutA, lutSize: size };
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
      a: stops[0]!.color.a,
    };
  const p = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length; i++) {
    if (p !== stops[i]!.position) continue;
    let lastAtPosition = i;
    while (
      lastAtPosition + 1 < stops.length &&
      stops[lastAtPosition + 1]!.position === stops[i]!.position
    ) {
      lastAtPosition += 1;
    }
    return stops[lastAtPosition]!.color;
  }
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

/** Sample a gradient-map ramp using the exact engine midpoint/reverse rules. */
export function sampleGradientMapColor(
  stops: readonly GradientMapStop[],
  position: number,
  opts: Pick<GradientColorLutOptions, 'interpolation' | 'reverse'> = {},
): Color {
  if (stops.length < 1) return [0, 0, 0, 255];
  if (stops.length < 2) return normalizeGradientStop(stops[0]!, 0, 1).color;
  const p = opts.reverse ? 1 - clamp01(position, 0) : clamp01(position, 0);
  const c = interpolateGradientMapColor(
    toInterpolationStops(stops),
    p,
    opts.interpolation ?? 'srgb',
  );
  return [c.r, c.g, c.b, c.a];
}

/** Legacy 256-entry sRGB LUT builder (backward-compatible surface). */
export function buildGradientLUT(stops: readonly GradientMapStop[]): GradientLut {
  return buildGradientColorLut(stops, { size: DEFAULT_GRADIENT_LUT_SIZE, interpolation: 'srgb' });
}

/** Normalize scalar opacity stops while retaining intentional hard stops. */
function normalizeOpacityStops(
  stops: ReadonlyArray<{ position: number; midpoint?: number; opacity: number }>,
): {
  position: number;
  midpoint: number;
  opacity: number;
}[] {
  return stops
    .map((s, order) => ({
      position: clamp01(s.position, 0),
      midpoint: clamp01(s.midpoint ?? 0.5, 0.5),
      opacity: clamp01(s.opacity, 1),
      order,
    }))
    .sort((a, b) => a.position - b.position || a.order - b.order)
    .map(({ order: _order, ...stop }) => stop);
}

type ScalarOpacityStop = { position: number; midpoint: number; opacity: number };

/** Evaluate sorted scalar stops with last-wins hard transitions. */
function sampleOpacityStops(stops: readonly ScalarOpacityStop[], t: number): number {
  if (stops.length === 0) return 1;
  if (stops.length === 1) return stops[0]!.opacity;
  const p = clamp01(t, 0);

  let lastAtPosition: ScalarOpacityStop | undefined;
  for (const stop of stops) {
    if (stop.position > p) break;
    if (stop.position === p) lastAtPosition = stop;
  }
  if (lastAtPosition) return lastAtPosition.opacity;
  if (p <= stops[0]!.position) return stops[0]!.opacity;
  const last = stops[stops.length - 1]!;
  if (p >= last.position) return last.opacity;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const lo = stops[i]!;
    const hi = stops[i + 1]!;
    if (p < lo.position || p > hi.position || hi.position === lo.position) continue;
    const linearT = (p - lo.position) / (hi.position - lo.position);
    const blendT = applyMidpointBias(linearT, hi.midpoint);
    return lo.opacity + (hi.opacity - lo.opacity) * blendT;
  }
  return last.opacity;
}

/**
 * Build an alpha LUT from opacity stops (per-stop opacities + explicit ramp).
 * Uses the same midpoint-bias formula as the color path.
 */
export function buildGradientAlphaLut(
  stops: readonly GradientMapStop[],
  opacityStops: readonly GradientMapOpacityStop[] | undefined,
  size: number,
  opts: { reverse?: boolean } = {},
): Uint8Array {
  const normalizedSize = normalizeLutSize(size, DEFAULT_GRADIENT_LUT_SIZE);
  const lut = new Uint8Array(normalizedSize);
  const normalizedColors: ScalarOpacityStop[] = toInterpolationStops(stops).map((stop) => ({
    position: stop.position,
    midpoint: stop.midpoint ?? 0.5,
    opacity: clamp01(stop.color.a / 255, 1),
  }));
  const normalizedExplicit: ScalarOpacityStop[] = normalizeOpacityStops(
    (opacityStops ?? []).map((stop) => ({
      position: stop.position,
      midpoint: stop.midpoint,
      opacity: stop.opacity,
    })),
  );
  const normalizedPerStop: ScalarOpacityStop[] = normalizeOpacityStops(
    stops.map((stop) => ({
      position: stop.position,
      midpoint: stop.midpoint,
      opacity: clamp01(stop.opacity ?? 1),
    })),
  );

  for (let i = 0; i < normalizedSize; i++) {
    const t = normalizedSize > 1 ? i / (normalizedSize - 1) : 0;
    const sampleT = opts.reverse ? 1 - t : t;
    const colorAlpha = sampleOpacityStops(normalizedColors, sampleT);
    const perStopOpacity = sampleOpacityStops(normalizedPerStop, sampleT);
    const explicitOpacity = sampleOpacityStops(normalizedExplicit, sampleT);
    lut[i] = clampByte(colorAlpha * perStopOpacity * explicitOpacity * 255);
  }
  return lut;
}

/** Sample the effective gradient alpha using the same evaluator as the LUT. */
export function sampleGradientMapAlpha(
  stops: readonly GradientMapStop[],
  opacityStops: readonly GradientMapOpacityStop[] | undefined,
  position: number,
  opts: { reverse?: boolean } = {},
): number {
  const normalizedColors: ScalarOpacityStop[] = toInterpolationStops(stops).map((stop) => ({
    position: stop.position,
    midpoint: stop.midpoint ?? 0.5,
    opacity: clamp01(stop.color.a / 255, 1),
  }));
  const normalizedExplicit = normalizeOpacityStops(
    (opacityStops ?? []).map((stop) => ({
      position: stop.position,
      midpoint: stop.midpoint,
      opacity: stop.opacity,
    })),
  );
  const normalizedPerStop = normalizeOpacityStops(
    stops.map((stop) => ({
      position: stop.position,
      midpoint: stop.midpoint,
      opacity: clamp01(stop.opacity ?? 1),
    })),
  );
  const p = opts.reverse ? 1 - clamp01(position, 0) : clamp01(position, 0);
  return clamp01(
    sampleOpacityStops(normalizedColors, p) *
      sampleOpacityStops(normalizedPerStop, p) *
      sampleOpacityStops(normalizedExplicit, p),
  );
}

interface CompiledGradientMapLuts {
  color: GradientLut;
  alpha: Uint8Array;
  red?: GradientLut;
  green?: GradientLut;
  blue?: GradientLut;
}

const MAX_GRADIENT_MAP_LUT_CACHE_ENTRIES = 32;
const gradientMapLutCache = new Map<string, CompiledGradientMapLuts>();

function cacheStop(stop: GradientMapStop): unknown[] {
  return [
    stop.id ?? null,
    stop.position,
    stop.color?.[0],
    stop.color?.[1],
    stop.color?.[2],
    stop.color?.[3],
    stop.opacity ?? null,
    stop.midpoint ?? null,
  ];
}

function gradientMapCacheKey(params: GradientMapParams, lutSize: number): string {
  return JSON.stringify({
    algorithmVersion: params.algorithmVersion ?? 1,
    dither: params.dither,
    ditherSize: params.ditherSize ?? 8,
    ditherOriginX: params.ditherOriginX ?? 0,
    ditherOriginY: params.ditherOriginY ?? 0,
    preserveLuminosity: params.preserveLuminosity,
    mode: params.mode ?? 'luminance',
    reverse: params.reverse ?? false,
    intensity: params.intensity ?? 1,
    luminanceMode: params.luminanceMode ?? 'relative-luminance',
    preserveSourceAlpha: params.preserveSourceAlpha ?? true,
    interpolation: params.interpolation ?? 'srgb',
    lutSize,
    stops: params.stops.map(cacheStop),
    opacityStops: (params.opacityStops ?? []).map((stop) => [
      stop.id ?? null,
      stop.position,
      stop.midpoint ?? null,
      stop.opacity,
    ]),
    channelStops: {
      r: params.channelStops?.r?.map(cacheStop) ?? null,
      g: params.channelStops?.g?.map(cacheStop) ?? null,
      b: params.channelStops?.b?.map(cacheStop) ?? null,
    },
  });
}

function compileGradientMapLuts(
  params: GradientMapParams,
  lutSize: number,
): CompiledGradientMapLuts {
  const lutOpts: GradientColorLutOptions = {
    size: lutSize,
    interpolation: params.interpolation ?? 'srgb',
    reverse: params.reverse,
  };
  const color = buildGradientColorLut(params.stops, lutOpts);
  const alpha = buildGradientAlphaLut(params.stops, params.opacityStops, lutSize, {
    reverse: params.reverse,
  });
  if ((params.mode ?? 'luminance') !== 'channel') return { color, alpha };
  return {
    color,
    alpha,
    red: buildGradientColorLut(params.channelStops?.r ?? params.stops, lutOpts),
    green: buildGradientColorLut(params.channelStops?.g ?? params.stops, lutOpts),
    blue: buildGradientColorLut(params.channelStops?.b ?? params.stops, lutOpts),
  };
}

function getCompiledGradientMapLuts(
  params: GradientMapParams,
  lutSize: number,
): CompiledGradientMapLuts {
  const key = gradientMapCacheKey(params, lutSize);
  const cached = gradientMapLutCache.get(key);
  if (cached) {
    gradientMapLutCache.delete(key);
    gradientMapLutCache.set(key, cached);
    return cached;
  }
  const compiled = compileGradientMapLuts(params, lutSize);
  gradientMapLutCache.set(key, compiled);
  if (gradientMapLutCache.size > MAX_GRADIENT_MAP_LUT_CACHE_ENTRIES) {
    const oldest = gradientMapLutCache.keys().next().value;
    if (oldest) gradientMapLutCache.delete(oldest);
  }
  return compiled;
}

/** Clear compiled gradient-map LUTs (used after memory-pressure events/tests). */
export function clearGradientMapLutCache(): void {
  gradientMapLutCache.clear();
}

/**
 * sRGB-encoded byte -> linear-light, precomputed for all 256 inputs.
 *
 * The transfer function is a pure function of an 8-bit channel, so the
 * `** 2.4` it would otherwise cost per channel per pixel is hoisted into this
 * table once at module load. This is the dominant cost of the
 * `perceptual-lightness` tonal mode on large images.
 */
const SRGB_TO_LINEAR: Float64Array = (() => {
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    const v = i / 255;
    table[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }
  return table;
})();

/**
 * Map an 8-bit tonal value onto a ramp of `size` entries.
 *
 * Tonal values are always computed in 0-255 space (that is the domain of the
 * source pixels and of the dither matrix), but the colour/alpha ramps are
 * built at `lutSize`, which callers may set anywhere in [64, 4096]. Indexing a
 * ramp directly with the 8-bit value would sample only its first 256 entries
 * when `size > 256`, and read past the end when `size < 256`.
 */
function rampIndex(tonal: number, size: number): number {
  if (size <= 1) return 0;
  const scaled = Math.round((tonal / 255) * (size - 1));
  return scaled < 0 ? 0 : scaled > size - 1 ? size - 1 : scaled;
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
  algorithmVersion: 1 | 2 = 1,
): number {
  switch (mode) {
    case 'relative-luminance':
      return relativeLuminance(r, g, b, algorithmVersion);
    case 'compatibility':
      return encodedLuma(r, g, b);
    case 'perceptual-lightness': {
      const lr = SRGB_TO_LINEAR[r]!;
      const lg = SRGB_TO_LINEAR[g]!;
      const lb = SRGB_TO_LINEAR[b]!;
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

function encodedLuma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG/W3C relative luminance, expressed in the engine's 0-255 domain. */
function relativeLuminance(r: number, g: number, b: number, algorithmVersion: 1 | 2): number {
  if (algorithmVersion === 1) return encodedLuma(r, g, b);
  return (
    (0.2126 * SRGB_TO_LINEAR[Math.round(r)]! +
      0.7152 * SRGB_TO_LINEAR[Math.round(g)]! +
      0.0722 * SRGB_TO_LINEAR[Math.round(b)]!) *
    255
  );
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
  const channelStops = params.channelStops;
  const hasChannelRamp = [channelStops?.r, channelStops?.g, channelStops?.b].some(
    (channel) => (channel ?? stops).length >= 2,
  );
  if ((mode === 'luminance' && stops.length < 2) || (mode === 'channel' && !hasChannelRamp))
    return data;

  const pixels = data.data;
  const w = data.width;
  const dSize = ditherSize ?? 8;
  const ditherMatrix = dSize === 4 ? BAYER_4X4 : BAYER_8X8;
  const ditherMask = dSize === 4 ? 3 : 7;

  const rawLutSize = params.lutSize ?? DEFAULT_GRADIENT_LUT_SIZE;
  const lutSize = Math.min(
    4096,
    Math.max(64, normalizeLutSize(rawLutSize, DEFAULT_GRADIENT_LUT_SIZE)),
  );
  const intensity = clamp01(params.intensity ?? 1);
  const preserveSourceAlpha = params.preserveSourceAlpha ?? true;
  const luminanceMode = params.luminanceMode ?? 'relative-luminance';

  const compiled = getCompiledGradientMapLuts(params, lutSize);
  const { color: lut, alpha: alphaLut } = compiled;

  const algorithmVersion = params.algorithmVersion ?? 1;
  const originX = Number.isFinite(params.ditherOriginX) ? params.ditherOriginX! : 0;
  const originY = Number.isFinite(params.ditherOriginY) ? params.ditherOriginY! : 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;

    // Skip fully transparent pixels — no visual contribution
    if (a === 0) continue;

    let nr: number, ng: number, nb: number;

    let tonal = tonalValue(luminanceMode, r, g, b, a, algorithmVersion);
    if (mode === 'channel') {
      // Per-channel mapping: each channel value indexes its own LUT independently
      nr = compiled.red!.r[rampIndex(r, lutSize)]!;
      ng = compiled.green!.g[rampIndex(g, lutSize)]!;
      nb = compiled.blue!.b[rampIndex(b, lutSize)]!;
    } else {
      // Optional ordered dithering for banding reduction (deterministic).
      if (dither) {
        const pixel = i / 4;
        const x = Math.floor(originX + (pixel % w));
        const y = Math.floor(originY + pixel / w);
        const ditherVal = ((ditherMatrix[y & ditherMask]?.[x & ditherMask] ?? 0.5) - 0.5) * 1.5;
        tonal = Math.max(0, Math.min(255, tonal + ditherVal));
      }

      const idx = rampIndex(tonal, lutSize);
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
      const origLum = relativeLuminance(r, g, b, algorithmVersion);
      const mappedLum = relativeLuminance(nr, ng, nb, algorithmVersion);
      const scale = mappedLum > 0 ? origLum / mappedLum : 1;
      nr = nr * scale;
      ng = ng * scale;
      nb = nb * scale;
    }

    pixels[i] = clampByte(nr);
    pixels[i + 1] = clampByte(ng);
    pixels[i + 2] = clampByte(nb);

    // Alpha is mixed with the same intensity as RGB. This makes intensity 0
    // a complete RGBA identity, including when an opacity ramp is present.
    if (!preserveSourceAlpha) {
      const rampIdx = rampIndex(tonal, lutSize);
      const rampAlpha = alphaLut[rampIdx] ?? 255;
      const mappedAlpha = (a * rampAlpha) / 255;
      pixels[i + 3] = clampByte(a + (mappedAlpha - a) * intensity);
    }
  }

  return data;
}
