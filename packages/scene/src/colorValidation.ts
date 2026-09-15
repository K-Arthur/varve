/**
 * ManagedColor validation and normalization — the single enforcement point
 * for the canonical color-model invariants.
 *
 * Invariants:
 * - Channel values are normalized per-space; NaN and Infinity are rejected.
 * - Alpha has one canonical storage scale: the color's `bitDepth`
 *   (default uint8 → 0-255). Normalized 0-1 is a boundary convention.
 * - LCH hue wraps deterministically to [0, 360); chroma is always ≥ 0.
 * - Spot tints are within [0, 100].
 * - `UnresolvedColor.fallback` is display-only, never authoritative.
 * - Conversions never mutate their source object (callers must treat
 *   results as new objects).
 *
 * Validation is pure and never depends on installed ICC profile sets, so
 * migration paths can rely on it.
 */

import { DEFAULT_BIT_DEPTH } from '@varve/shared';
import type { BitDepth, LabColor, LchColor, ManagedColor } from './colorManagement';

/** Spot tint bounds (percent). */
export const SPOT_TINT_MIN = 0;
export const SPOT_TINT_MAX = 100;

/** LCH hue range in degrees. */
export const LCH_HUE_MIN = 0;
export const LCH_HUE_MAX = 360;

/** CIE Lab lightness range (float percent). */
export const LAB_L_MIN = 0;
export const LAB_L_MAX = 100;

/** Wrap a hue in degrees to [0, 360) deterministically. NaN → 0. */
export function wrapHueDegrees(h: number): number {
  if (Number.isNaN(h) || !Number.isFinite(h)) return 0;
  let v = h % 360;
  if (v < 0) v += 360;
  return v;
}

/** Reject NaN/Infinity with a stable issue message. */
function finiteIssue(name: string, value: number): string | null {
  if (Number.isNaN(value)) return `${name} is NaN`;
  if (!Number.isFinite(value)) return `${name} is infinite`;
  return null;
}

/** Validate a ManagedColor. Returns a list of issues (empty = valid). */
export function validateManagedColor(color: ManagedColor): string[] {
  const issues: string[] = [];

  switch (color.space) {
    case 'rgb':
    case 'cmyk':
    case 'gray': {
      const channelTuples: Array<[string, number]> =
        color.space === 'rgb'
          ? [
              ['r', color.r],
              ['g', color.g],
              ['b', color.b],
              ['a', color.a],
            ]
          : color.space === 'cmyk'
            ? [
                ['c', color.c],
                ['m', color.m],
                ['y', color.y],
                ['k', color.k],
                ['a', color.a],
              ]
            : [
                ['v', color.v],
                ['a', color.a],
              ];
      const channels: number[] = [];
      for (const [name, value] of channelTuples) {
        const issue = finiteIssue(name, value);
        if (issue) issues.push(issue);
        channels.push(value);
      }
      // Alpha must fit the canonical bit-depth scale for integer depths.
      const bitDepth: BitDepth = color.bitDepth ?? DEFAULT_BIT_DEPTH;
      if (bitDepth === 'uint8') {
        for (const v of channels) {
          if (v < 0 || v > 255 || Math.round(v) !== v) {
            issues.push('uint8 channels must be integers in [0, 255]');
            break;
          }
        }
      } else if (bitDepth === 'uint16') {
        for (const v of channels) {
          if (v < 0 || v > 65535 || Math.round(v) !== v) {
            issues.push('uint16 channels must be integers in [0, 65535]');
            break;
          }
        }
      }
      break;
    }
    case 'lab': {
      const issue =
        finiteIssue('l', color.l) ?? finiteIssue('a', color.av) ?? finiteIssue('b', color.b);
      if (issue) issues.push(issue);
      if (!Number.isNaN(color.l) && (color.l < LAB_L_MIN || color.l > LAB_L_MAX)) {
        issues.push('lab lightness must be in [0, 100]');
      }
      break;
    }
    case 'lch': {
      const issue =
        finiteIssue('l', color.l) ?? finiteIssue('c', color.c) ?? finiteIssue('h', color.h);
      if (issue) issues.push(issue);
      if (!Number.isNaN(color.c) && color.c < 0) {
        issues.push('lch chroma must be >= 0');
      }
      if (!Number.isNaN(color.l) && (color.l < LAB_L_MIN || color.l > LAB_L_MAX)) {
        issues.push('lch lightness must be in [0, 100]');
      }
      const wrapped = wrapHueDegrees(color.h);
      if (wrapped !== color.h) {
        issues.push('lch hue must be wrapped to [0, 360)');
      }
      break;
    }
    case 'registration':
      break;
    case 'spot': {
      if (Number.isNaN(color.tint) || !Number.isFinite(color.tint)) {
        issues.push('spot tint must be finite');
      } else if (color.tint < SPOT_TINT_MIN || color.tint > SPOT_TINT_MAX) {
        issues.push(`spot tint must be in [${SPOT_TINT_MIN}, ${SPOT_TINT_MAX}]`);
      }
      if (!color.name || color.name.length === 0) {
        issues.push('spot color requires a name');
      }
      if (color.processFallback) {
        for (const [n, v] of Object.entries(color.processFallback)) {
          if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 255) {
            issues.push(`spot fallback channel ${n} must be in [0, 255]`);
          }
        }
      }
      break;
    }
    case 'unresolved': {
      if (!color.source || color.source.length === 0) {
        issues.push('unresolved color requires a source');
      }
      if (color.fallback) {
        for (const [n, v] of Object.entries(color.fallback)) {
          if (typeof v !== 'number' || Number.isNaN(v)) {
            issues.push(`unresolved fallback channel ${n} must be a number`);
          }
        }
      }
      break;
    }
  }

  // Alpha finite check across all variants (a is alpha on every member).
  if (typeof color.a === 'number' && (Number.isNaN(color.a) || !Number.isFinite(color.a))) {
    issues.push('alpha must be finite');
  }

  return issues;
}

/** True when the color satisfies every invariant. */
export function isValidManagedColor(color: ManagedColor): boolean {
  return validateManagedColor(color).length === 0;
}

/**
 * Normalize a copy of the color: wrap LCH hue, take |chroma|, reject
 * NaN/Infinity. Returns null when the value cannot be normalized.
 */
export function normalizeManagedColor(color: ManagedColor): ManagedColor | null {
  if (color.space === 'lch') {
    if (Number.isNaN(color.h) || !Number.isFinite(color.h)) return null;
    if (Number.isNaN(color.c) || !Number.isFinite(color.c)) return null;
    if (Number.isNaN(color.l) || !Number.isFinite(color.l)) return null;
    return {
      ...color,
      c: Math.abs(color.c),
      h: wrapHueDegrees(color.h),
    } as LchColor;
  }
  if (color.space === 'lab') {
    if (
      Number.isNaN(color.l) ||
      !Number.isFinite(color.l) ||
      Number.isNaN(color.av) ||
      !Number.isFinite(color.av) ||
      Number.isNaN(color.b) ||
      !Number.isFinite(color.b)
    ) {
      return null;
    }
    return { ...color, l: Math.max(LAB_L_MIN, Math.min(LAB_L_MAX, color.l)) } as LabColor;
  }
  if (color.space === 'rgb') {
    if (channelInvalid(color)) return null;
    return { ...color };
  }
  return { ...color };
}

function channelInvalid(color: { r?: number; g?: number; b?: number; a?: number }): boolean {
  return [color.r, color.g, color.b, color.a].some(
    (v) => v === undefined || Number.isNaN(v) || !Number.isFinite(v),
  );
}

/**
 * Structural equality within an optional per-channel tolerance.
 * NaN never equals NaN. Undefined vs missing are treated as equal.
 */
export function managedColorEquals(a: ManagedColor, b: ManagedColor, tolerance = 1e-9): boolean {
  if (a.space !== b.space) return false;
  const definedKeys = (o: ManagedColor): string[] =>
    Object.keys(o)
      .filter((k) => (o as unknown as Record<string, unknown>)[k] !== undefined)
      .sort();
  const keys = definedKeys(a);
  const otherKeys = definedKeys(b);
  if (keys.length !== otherKeys.length) return false;
  for (const k of keys) {
    if (k === 'space') continue;
    const av = (a as unknown as Record<string, unknown>)[k];
    const bv = (b as unknown as Record<string, unknown>)[k];
    if (av === undefined && bv === undefined) continue;
    if (typeof av === 'number' && typeof bv === 'number') {
      if (Math.abs(av - bv) > tolerance) return false;
      continue;
    }
    if (typeof av === 'object' && typeof bv === 'object' && av !== null && bv !== null) {
      if (JSON.stringify(av) !== JSON.stringify(bv)) return false;
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}

/** Normalize a spot tint into [0, 100], rejecting NaN/Infinity. */
export function clampSpotTint(tint: number): number {
  if (Number.isNaN(tint) || !Number.isFinite(tint)) return 0;
  return Math.max(SPOT_TINT_MIN, Math.min(SPOT_TINT_MAX, tint));
}
