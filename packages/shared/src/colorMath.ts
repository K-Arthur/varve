/**
 * Statistical color helpers and accessible-color search.
 *
 * These are used by the editor intelligence modules (spacing harmonizer,
 * WCAG auto-fix, palette extraction) and are kept framework-agnostic so
 * they can run in workers, WASM glue, and React alike.
 */

import {
  linearSrgbToOklab,
  linearToSrgb,
  oklabToLinearSrgb,
  oklabToOkLch,
  oklchToOkLab,
  srgbToLinear,
} from './colorConversion';
import {
  autoFixContrast,
  contrastRatio as contrastRatioFromLuminance,
  relativeLuminance as relativeLuminanceScalar,
} from './contrast';

/** RGB triplet, 0-255. */
export type Rgb = readonly [number, number, number];

/** OKLCH color — perceptually uniform color representation. */
export interface Oklch {
  /** Perceived lightness 0–1. */
  L: number;
  /** Chroma (saturation). */
  C: number;
  /** Hue angle 0–360. */
  H: number;
}

/**
 * Convert sRGB (0-255) to OKLCH.
 */
export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const linear: [number, number, number] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const [L, a, bVal] = linearSrgbToOklab(linear);
  const [, C, Hrad] = oklabToOkLch([L, a, bVal]);
  let H = (Hrad * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

/**
 * Convert OKLCH back to sRGB (0-255), clamped to displayable range.
 */
export function oklchToRgb({ L, C, H }: Oklch): Rgb {
  const Hrad = (H * Math.PI) / 180;
  const [l, a, bVal] = oklchToOkLab([L, C, Hrad]);
  const linear = oklabToLinearSrgb([l, a, bVal]);
  return [
    Math.max(0, Math.min(255, linearToSrgb(linear[0]!))),
    Math.max(0, Math.min(255, linearToSrgb(linear[1]!))),
    Math.max(0, Math.min(255, linearToSrgb(linear[2]!))),
  ];
}

/** WCAG relative luminance of an sRGB color. */
export function relativeLuminance(rgb: Rgb): number {
  return relativeLuminanceScalar(rgb[0]!, rgb[1]!, rgb[2]!);
}

/** WCAG contrast ratio between two sRGB colors. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  return contrastRatioFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/** Delta E in OKLab (perceptual distance) between two OKLCH colors. */
export function deltaEOK(a: Oklch, b: Oklch): number {
  const aLab = oklchToOkLab([a.L, a.C, (a.H * Math.PI) / 180]);
  const bLab = oklchToOkLab([b.L, b.C, (b.H * Math.PI) / 180]);
  const dL = aLab[0]! - bLab[0]!;
  const da = aLab[1]! - bLab[1]!;
  const db = aLab[2]! - bLab[2]!;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** Arithmetic mean of an array of numbers. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation of an array of numbers. */
export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** Median of an array of numbers. */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Mode with binning tolerance.
 *
 * Values are grouped into fixed-width bins of size `binSize` starting at 0.
 * Returns the lower bound of the most frequent bin, or null for empty input.
 */
export function binnedMode(values: number[], binSize: number): number | null {
  if (values.length === 0 || binSize <= 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) {
    const bin = Math.floor(v / binSize) * binSize;
    counts.set(bin, (counts.get(bin) ?? 0) + 1);
  }
  let bestBin: number | null = null;
  let bestCount = 0;
  for (const [bin, count] of counts) {
    if (count > bestCount || (count === bestCount && (bestBin === null || bin > bestBin))) {
      bestBin = bin;
      bestCount = count;
    }
  }
  return bestBin;
}

/**
 * Find the nearest accessible color via OKLCH lightness binary search.
 *
 * Wraps the existing `autoFixContrast` helper, constrained by a perceptual
 * `maxDeltaE` bound. If the input already passes, or no acceptable fix can be
 * found, the original foreground color is returned.
 */
export function findAccessibleColor(
  fg: Rgb,
  bg: Rgb,
  targetRatio: number,
  maxDeltaE: number = 5.0,
): Rgb {
  const fixed = autoFixContrast(fg[0]!, fg[1]!, fg[2]!, bg[0]!, bg[1]!, bg[2]!, targetRatio);
  if (!fixed || fixed.deltaEOK >= maxDeltaE) return fg;
  return [fixed.r, fixed.g, fixed.b];
}
