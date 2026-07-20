/**
 * Aspect-ratio math for presets and frame/document sizing: ratio
 * simplification, drift-free derivation of one dimension from the other, and
 * dimension validation.
 */
import type { PresetAspectRatio } from './presetTypes';

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/** GCD-reduced terms above this are not a "nice" recognizable ratio (e.g.
 *  210:297 GCD-reduces to 70:99 — technically correct, but not a ratio
 *  anyone recognizes) — fall back to decimal normalization instead. */
const MAX_NICE_RATIO_TERM = 64;

/**
 * Reduce a width/height pair to a simplified ratio. Integer pairs are
 * GCD-reduced when that yields small, recognizable terms (e.g. 1920x1080 ->
 * 16:9). Everything else — non-integer pairs, or integer pairs whose GCD-
 * reduced terms are still large (e.g. ISO 216's 210x297, which reduces to
 * 70:99) — is normalized by dividing by the smaller value, giving a decimal
 * ratio (e.g. ~1:1.4142 for ISO 216) without inventing false "nice" terms.
 */
export function simplifyRatio(width: number, height: number): PresetAspectRatio {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { w: 1, h: 1 };
  }
  if (Number.isInteger(width) && Number.isInteger(height)) {
    const divisor = gcd(width, height);
    const reducedW = width / divisor;
    const reducedH = height / divisor;
    if (reducedW <= MAX_NICE_RATIO_TERM && reducedH <= MAX_NICE_RATIO_TERM) {
      return { w: reducedW, h: reducedH };
    }
  }
  const smaller = Math.min(width, height);
  return { w: width / smaller, h: height / smaller };
}

export function ratioValue(ratio: PresetAspectRatio): number {
  return ratio.h === 0 ? 0 : ratio.w / ratio.h;
}

/** Single funnel point for dimension rounding, shared by both derive
 *  functions so behavior is centralized and testable. */
export function roundDimension(value: number): number {
  return Math.round(value);
}

/**
 * Derive the height for a given width at a fixed ratio. Always computes from
 * the ratio directly against the authoritative width — never from a
 * previously-rounded height — so repeated width edits don't accumulate
 * rounding drift.
 */
export function deriveHeight(width: number, ratio: PresetAspectRatio): number {
  const rv = ratioValue(ratio);
  return rv === 0 ? roundDimension(width) : roundDimension(width / rv);
}

/** Derive the width for a given height at a fixed ratio. Same no-drift
 *  guarantee as deriveHeight. */
export function deriveWidth(height: number, ratio: PresetAspectRatio): number {
  return roundDimension(height * ratioValue(ratio));
}

/** Swap width/height exactly (no rounding) — used for a portrait/landscape
 *  orientation toggle. */
export function swapDimensions(dims: { width: number; height: number }): {
  width: number;
  height: number;
} {
  return { width: dims.height, height: dims.width };
}

const MAX_DIMENSION = 1_000_000;

/**
 * Validate a width/height pair, rejecting zero, negative, non-finite, and
 * excessively large values. Returns an error message, or null when valid.
 */
export function validateDimensions(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return 'Width and height must be finite numbers.';
  }
  if (width <= 0 || height <= 0) {
    return 'Width and height must be greater than zero.';
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return `Width and height must not exceed ${MAX_DIMENSION}.`;
  }
  return null;
}
