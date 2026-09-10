/**
 * Canonical Color Balance reference kernel.
 *
 * The adjustment contract at the ImageData boundary is straight, sRGB-encoded
 * RGBA bytes. Calculations happen in linear sRGB, using Rec. 709 relative
 * luminance for the tonal weights and for Preserve Luminosity. The signed UI
 * domain is [-100, 100]: positive values move toward the axis' right-hand
 * label (red, green, blue), and negative values move toward its left-hand
 * label (cyan, magenta, yellow).
 *
 * This is intentionally a readable scalar implementation. Optimized backends
 * must compare their output to this module rather than implement a second
 * Color Balance interpretation.
 */

export const COLOR_BALANCE_ALGORITHM_VERSION = 1 as const;
export const COLOR_BALANCE_MAX = 100;

export interface ColorBalanceTriplet {
  cyanRed: number;
  magentaGreen: number;
  yellowBlue: number;
}

export interface ColorBalanceParams {
  shadows: ColorBalanceTriplet;
  midtones: ColorBalanceTriplet;
  highlights: ColorBalanceTriplet;
  preserveLuminosity: boolean;
  algorithmVersion?: typeof COLOR_BALANCE_ALGORITHM_VERSION;
}

export type ColorBalancePixel = readonly [number, number, number, number];

const REC709 = [0.2126, 0.7152, 0.0722] as const;
const EPSILON = 1e-12;
// A full-scale axis move is intentionally bounded in linear light. This
// keeps extreme controls useful without turning a one-pixel adjustment into
// an unbounded channel blowout before the compositor applies opacity.
const MAX_LINEAR_AXIS_DELTA = 0.35;

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function clampSigned(value: number): number {
  return Number.isFinite(value)
    ? Math.max(-COLOR_BALANCE_MAX, Math.min(COLOR_BALANCE_MAX, value))
    : 0;
}

function normalizeTriplet(value: Partial<ColorBalanceTriplet> | undefined): ColorBalanceTriplet {
  return {
    cyanRed: clampSigned(value?.cyanRed ?? 0),
    magentaGreen: clampSigned(value?.magentaGreen ?? 0),
    yellowBlue: clampSigned(value?.yellowBlue ?? 0),
  };
}

/** Normalize untrusted/persisted Color Balance values without mutating input. */
export function normalizeColorBalanceParams(
  value: Partial<ColorBalanceParams> | undefined,
): ColorBalanceParams {
  return {
    shadows: normalizeTriplet(value?.shadows),
    midtones: normalizeTriplet(value?.midtones),
    highlights: normalizeTriplet(value?.highlights),
    preserveLuminosity: value?.preserveLuminosity !== false,
    algorithmVersion: COLOR_BALANCE_ALGORITHM_VERSION,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const range = edge1 - edge0;
  if (range <= 0) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / range);
  return t * t * (3 - 2 * t);
}

/**
 * Return overlapping, normalized weights for shadows/midtones/highlights.
 * Each weight is continuous with a zero slope at the range boundaries and the
 * three weights sum to one for every in-gamut luminance.
 */
export function colorBalanceTonalWeights(luminance: number): {
  shadows: number;
  midtones: number;
  highlights: number;
} {
  const l = clamp01(luminance);
  const shadows = 1 - smoothstep(0, 0.5, l);
  const highlights = smoothstep(0.5, 1, l);
  return {
    shadows,
    midtones: Math.max(0, 1 - shadows - highlights),
    highlights,
  };
}

function srgbToLinear(value: number): number {
  const v = clamp01(value);
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const v = clamp01(value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

function luminance(rgb: readonly [number, number, number]): number {
  return REC709[0] * rgb[0] + REC709[1] * rgb[1] + REC709[2] * rgb[2];
}

function mixTriplets(
  weights: ReturnType<typeof colorBalanceTonalWeights>,
  params: ColorBalanceParams,
): ColorBalanceTriplet {
  return {
    cyanRed:
      weights.shadows * params.shadows.cyanRed +
      weights.midtones * params.midtones.cyanRed +
      weights.highlights * params.highlights.cyanRed,
    magentaGreen:
      weights.shadows * params.shadows.magentaGreen +
      weights.midtones * params.midtones.magentaGreen +
      weights.highlights * params.highlights.magentaGreen,
    yellowBlue:
      weights.shadows * params.shadows.yellowBlue +
      weights.midtones * params.midtones.yellowBlue +
      weights.highlights * params.highlights.yellowBlue,
  };
}

function applyOpponentAxes(
  rgb: readonly [number, number, number],
  triplet: ColorBalanceTriplet,
): [number, number, number] {
  const cyanRed = (triplet.cyanRed / COLOR_BALANCE_MAX) * MAX_LINEAR_AXIS_DELTA;
  const magentaGreen = (triplet.magentaGreen / COLOR_BALANCE_MAX) * MAX_LINEAR_AXIS_DELTA;
  const yellowBlue = (triplet.yellowBlue / COLOR_BALANCE_MAX) * MAX_LINEAR_AXIS_DELTA;

  return [
    rgb[0] + cyanRed - magentaGreen * 0.5 - yellowBlue * 0.5,
    rgb[1] - cyanRed * 0.5 + magentaGreen - yellowBlue * 0.5,
    rgb[2] - cyanRed * 0.5 - magentaGreen * 0.5 + yellowBlue,
  ];
}

function preserveLuminance(
  original: readonly [number, number, number],
  adjusted: readonly [number, number, number],
): [number, number, number] {
  const originalLum = luminance(original);
  if (originalLum <= EPSILON) return [0, 0, 0];

  const nonNegative: [number, number, number] = [
    Math.max(0, adjusted[0]),
    Math.max(0, adjusted[1]),
    Math.max(0, adjusted[2]),
  ];
  const adjustedLum = luminance(nonNegative);
  if (adjustedLum <= EPSILON) return [0, 0, 0];

  let scale = originalLum / adjustedLum;
  const maxScaled = Math.max(nonNegative[0], nonNegative[1], nonNegative[2]) * scale;
  // Preserve luminance whenever the result fits. If it does not, scale to
  // the display gamut boundary; this is the least destructive deterministic
  // fallback available for an RGB-only output.
  if (maxScaled > 1) scale /= maxScaled;
  return [nonNegative[0] * scale, nonNegative[1] * scale, nonNegative[2] * scale];
}

function hasAnyAdjustment(params: ColorBalanceParams): boolean {
  return (
    params.shadows.cyanRed !== 0 ||
    params.shadows.magentaGreen !== 0 ||
    params.shadows.yellowBlue !== 0 ||
    params.midtones.cyanRed !== 0 ||
    params.midtones.magentaGreen !== 0 ||
    params.midtones.yellowBlue !== 0 ||
    params.highlights.cyanRed !== 0 ||
    params.highlights.magentaGreen !== 0 ||
    params.highlights.yellowBlue !== 0
  );
}

/** Evaluate one straight-alpha sRGB byte pixel through Color Balance. */
export function applyColorBalancePixel(
  pixel: ColorBalancePixel,
  input: Partial<ColorBalanceParams> | ColorBalanceParams,
): [number, number, number, number] {
  const params = normalizeColorBalanceParams(input);
  if (!hasAnyAdjustment(params) || pixel[3] === 0) return [pixel[0], pixel[1], pixel[2], pixel[3]];

  const original: [number, number, number] = [
    srgbToLinear(pixel[0] / 255),
    srgbToLinear(pixel[1] / 255),
    srgbToLinear(pixel[2] / 255),
  ];
  const weights = colorBalanceTonalWeights(luminance(original));
  const adjusted = applyOpponentAxes(original, mixTriplets(weights, params));
  const output: [number, number, number] = params.preserveLuminosity
    ? preserveLuminance(original, adjusted)
    : [Math.max(0, adjusted[0]), Math.max(0, adjusted[1]), Math.max(0, adjusted[2])];

  return [
    Math.round(linearToSrgb(output[0]) * 255),
    Math.round(linearToSrgb(output[1]) * 255),
    Math.round(linearToSrgb(output[2]) * 255),
    pixel[3],
  ];
}

/** Apply Color Balance in place. Identity returns without touching the buffer. */
export function applyColorBalance(
  data: ImageData,
  input: Partial<ColorBalanceParams> | ColorBalanceParams,
): ImageData {
  const params = normalizeColorBalanceParams(input);
  if (!hasAnyAdjustment(params)) return data;

  const pixels = data.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const result = applyColorBalancePixel(
      [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!, pixels[i + 3]!],
      params,
    );
    pixels[i] = result[0];
    pixels[i + 1] = result[1];
    pixels[i + 2] = result[2];
    pixels[i + 3] = result[3];
  }
  return data;
}
