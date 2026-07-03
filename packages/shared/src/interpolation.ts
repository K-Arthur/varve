/**
 * Type-safe interpolation engine for the motion system.
 *
 * Supports numeric, color (hex/RGBA), affine transform, path (bezier vertex),
 * array element-wise, and object key-wise interpolation. Used by the
 * TimelineSampler to compute animated property values at any progress point.
 *
 * Research basis: Lottie/Bodymovin interpolator, GSAP TweenLite, W3C
 * Web Animations §5 Animation model (keyframe effect value computation),
 * After Effects vertex interpolation.
 */
import type { Affine } from './affine';

export type InterpolationResult = number | string | number[] | Record<string, unknown> | unknown;

export interface PathPoint {
  x: number;
  y: number;
  handleIn: { x: number; y: number } | null;
  handleOut: { x: number; y: number } | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Interpolate between two values at progress t [0, 1].
 * Dispatches to type-specific handlers based on the types of `from` and `to`.
 */
export function interpolateValue(from: unknown, to: unknown, t: number): InterpolationResult {
  if (from === to) return from;

  // Both numbers: linear interpolation
  if (typeof from === 'number' && typeof to === 'number') {
    return from + (to - from) * t;
  }

  // Both arrays: element-wise interpolation
  if (Array.isArray(from) && Array.isArray(to)) {
    return interpolateArray(from, to, t);
  }

  // Both records: key-wise object interpolation
  if (isRecord(from) && isRecord(to)) {
    return interpolateObject(from, to, t);
  }

  // Fallback: discrete at midpoint
  return t < 0.5 ? from : to;
}

/**
 * Interpolate two arrays element-wise.
 * Shorter array's length is used; excess elements are dropped.
 */
export function interpolateArray(from: unknown[], to: unknown[], t: number): unknown[] {
  const len = Math.min(from.length, to.length);
  return Array.from({ length: len }, (_, i) => interpolateValue(from[i], to[i], t));
}

/**
 * Interpolate two objects key-wise.
 * Keys present in both objects are interpolated; keys in only one are
 * resolved discretely at the midpoint.
 */
export function interpolateObject(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  t: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    const hasFrom = key in from;
    const hasTo = key in to;
    if (hasFrom && hasTo) {
      result[key] = interpolateValue(from[key], to[key], t);
    } else if (hasFrom) {
      result[key] = t < 0.5 ? from[key] : (to[key] ?? from[key]);
    } else {
      result[key] = t < 0.5 ? (from[key] ?? to[key]) : to[key];
    }
  }
  return result;
}

/**
 * Interpolate between two color values.
 * Accepts hex strings (#RRGGBB or #RRGGBBAA) or RGBA tuples [r, g, b, a].
 * Returns the same format as the input.
 */
export function interpolateColor(
  from: string | number[],
  to: string | number[],
  t: number,
): string | number[] {
  const parseColor = (c: string | number[]): [number, number, number, number] => {
    if (Array.isArray(c)) {
      return [
        typeof c[0] === 'number' ? c[0] : 0,
        typeof c[1] === 'number' ? c[1] : 0,
        typeof c[2] === 'number' ? c[2] : 0,
        typeof c[3] === 'number' ? c[3] : 255,
      ];
    }
    const hex = c.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) : 255;
    return [
      Number.isNaN(r) ? 0 : r,
      Number.isNaN(g) ? 0 : g,
      Number.isNaN(b) ? 0 : b,
      Number.isNaN(a) ? 255 : a,
    ];
  };

  const hasAlpha = (c: string | number[]): boolean => {
    if (Array.isArray(c)) return c.length >= 4;
    return c.replace('#', '').length >= 8;
  };

  const [r1, g1, b1, a1] = parseColor(from);
  const [r2, g2, b2, a2] = parseColor(to);
  const result: [number, number, number, number] = [
    r1 + (r2 - r1) * t,
    g1 + (g2 - g1) * t,
    b1 + (b2 - b1) * t,
    a1 + (a2 - a1) * t,
  ];

  if (Array.isArray(from)) return result;
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  const includeAlpha = hasAlpha(from) || hasAlpha(to);
  return `#${toHex(result[0])}${toHex(result[1])}${toHex(result[2])}${includeAlpha ? toHex(result[3]) : ''}`;
}

/**
 * Interpolate between two affine transforms element-wise.
 */
export function interpolateAffine(from: Affine, to: Affine, t: number): Affine {
  return from.map((v, i) => v + (to[i] - v) * t) as Affine;
}

/**
 * Interpolate between two path vertex arrays.
 * Both arrays must have the same length (caller must normalize vertex count
 * before calling this function).
 */
export function interpolatePath(from: PathPoint[], to: PathPoint[], t: number): PathPoint[] {
  if (from.length !== to.length) {
    throw new Error(
      `Path vertex count mismatch: ${from.length} vs ${to.length}. ` +
        'Use ensureVertexMatch() before interpolation.',
    );
  }
  return from.map((pt, i) => ({
    x: pt.x + (to[i].x - pt.x) * t,
    y: pt.y + (to[i].y - pt.y) * t,
    handleIn:
      pt.handleIn && to[i].handleIn
        ? {
            x: pt.handleIn.x + (to[i].handleIn!.x - pt.handleIn.x) * t,
            y: pt.handleIn.y + (to[i].handleIn!.y - pt.handleIn.y) * t,
          }
        : null,
    handleOut:
      pt.handleOut && to[i].handleOut
        ? {
            x: pt.handleOut.x + (to[i].handleOut!.x - pt.handleOut.x) * t,
            y: pt.handleOut.y + (to[i].handleOut!.y - pt.handleOut.y) * t,
          }
        : null,
  }));
}
