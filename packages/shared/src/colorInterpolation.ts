/**
 * Perceptually uniform gradient color interpolation.
 *
 * Supports sRGB, linear-sRGB, Oklab, Oklch, and HSL interpolation spaces for
 * gradient stop blending. Handles midpoint bias (Figma-style), premultiplied
 * alpha, and configurable hue interpolation for cylindrical spaces.
 *
 * Research basis: Björn Ottosson Oklab (2020), CSS Color Level 4 color-mix(),
 * Figma gradient midpoint controls, Porter-Duff premultiplied alpha compositing.
 */
import {
  gamutMapToSrgbUnit,
  linearSrgbToOklab,
  linearToSrgbUnit,
  managedColorToNormalized,
  oklabToLinearSrgb,
  oklabToOkLch,
  srgbToLinearUnit,
} from './colorConversion';

/** Color space used for gradient stop interpolation. */
export type GradientInterpolationSpace = 'srgb' | 'linear-srgb' | 'oklab' | 'oklch' | 'hsl';

/**
 * Hue interpolation direction for cylindrical spaces (OKLCH, HSL).
 * Default: 'shorter'.
 */
export type HueInterpolation = 'shorter' | 'longer' | 'increasing' | 'decreasing';

/** Minimal gradient stop input for interpolation (decoupled from scene types). */
export interface GradientStopInput {
  position: number;
  color: {
    space: 'rgb';
    r: number;
    g: number;
    b: number;
    a: number;
  };
  /** Bias for 50% blend point between this stop and the next (0-1, default 0.5). */
  midpoint?: number;
}

export interface InterpolateOptions {
  /** Interpolate RGB channels in premultiplied alpha space. Default true. */
  premultiplied?: boolean;
  /** Keep fractional working channels instead of rounding to display bytes. */
  precision?: 'display' | 'working';
  /** Hue interpolation direction for cylindrical spaces. Default: 'shorter'. */
  hueInterpolation?: HueInterpolation;
}

type RgbColor = GradientStopInput['color'];

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function toRgbColor(
  r: number,
  g: number,
  b: number,
  a: number,
  precision: 'display' | 'working' = 'display',
): RgbColor {
  const channel = precision === 'working' ? (v: number) => Math.max(0, Math.min(255, v)) : clamp255;
  return { space: 'rgb', r: channel(r), g: channel(g), b: channel(b), a: channel(a) };
}

/**
 * Interpolate hue in degrees with configurable direction.
 *
 * - shorter: take the shorter arc (default)
 * - longer: take the longer arc
 * - increasing: always interpolate in the positive (CW) direction
 * - decreasing: always interpolate in the negative (CCW) direction
 *
 * Hue values must be in [0, 360). Achromatic endpoints (where chroma is
 * near-zero) should not reach this function; callers fall back to OKLab
 * when either endpoint is achromatic.
 */
export function lerpHue(
  h1: number,
  h2: number,
  t: number,
  direction: HueInterpolation = 'shorter',
): number {
  // Normalise both hues into [0, 360)
  h1 = ((h1 % 360) + 360) % 360;
  h2 = ((h2 % 360) + 360) % 360;

  // Compute raw difference in (-360, 360]
  let diff = h2 - h1;
  if (diff > 360) diff -= 360;
  if (diff <= -360) diff += 360;

  switch (direction) {
    case 'shorter': {
      // Take the shorter arc: if |diff| > 180, flip direction
      if (diff > 180) diff -= 360;
      else if (diff < -180) diff += 360;
      break;
    }
    case 'longer': {
      // Take the longer arc: if |diff| ≤ 180, flip direction
      if (diff > 0 && diff <= 180) diff -= 360;
      else if (diff < 0 && diff >= -180) diff += 360;
      break;
    }
    case 'increasing': {
      // Always go positive: if diff < 0, add 360
      if (diff < 0) diff += 360;
      break;
    }
    case 'decreasing': {
      // Always go negative: if diff > 0, subtract 360
      if (diff > 0) diff -= 360;
      break;
    }
  }

  return (((h1 + diff * t) % 360) + 360) % 360;
}

/**
 * Apply Figma-style midpoint bias.
 * When linear t equals `midpoint`, the blend factor is 0.5.
 */
export function applyMidpointBias(t: number, midpoint: number): number {
  const m = midpoint <= 0 || midpoint >= 1 ? 0.5 : midpoint;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (m === 0.5) return t;
  if (t <= m) return 0.5 * (t / m);
  return 0.5 + 0.5 * ((t - m) / (1 - m));
}

/**
 * Interpolate two RGB ManagedColors at factor t in the given color space.
 */
export function interpolateManagedColor(
  from: RgbColor,
  to: RgbColor,
  t: number,
  space: GradientInterpolationSpace,
  opts: InterpolateOptions = {},
): RgbColor {
  if (t <= 0) return { ...from };
  if (t >= 1) return { ...to };
  const precision = opts.precision ?? 'display';
  const result = interpolateNormalizedColor(
    { r: from.r / 255, g: from.g / 255, b: from.b / 255, a: from.a / 255 },
    { r: to.r / 255, g: to.g / 255, b: to.b / 255, a: to.a / 255 },
    t,
    space,
    opts,
  );
  return toRgbColor(result.r * 255, result.g * 255, result.b * 255, result.a * 255, precision);
}

/** Normalize any color to RGB for interpolation. */
function normalizeStopColor(
  color: GradientStopInput['color'] | Parameters<typeof managedColorToNormalized>[0],
): RgbColor {
  const [r, g, b, a] = managedColorToNormalized(
    color as Parameters<typeof managedColorToNormalized>[0],
  );
  return { space: 'rgb', r: r * 255, g: g * 255, b: b * 255, a: a * 255 };
}

// ── Normalized (0-1) interpolation ───────────────────────────────────────────
// The byte-space interpolator above is a display boundary. Authoring paths
// (gradient stop creation, stop expansion in high-precision documents) must
// interpolate in normalized 0-1 space so uint16/float channel values survive.

/** Normalized RGBA channels, 0-1, straight (unassociated) alpha. */
export interface InterpolationRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function rgbToHslUnit(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToRgbUnit(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, hh + 1 / 3), hue2rgb(p, q, hh), hue2rgb(p, q, hh - 1 / 3)];
}

/**
 * Interpolate two normalized (0-1) RGBA colors at factor t.
 *
 * No 8-bit quantization anywhere in the working path: the result is exact
 * at the caller's storage precision (uint16/float denormalization is the
 * caller's single quantization boundary).
 */
export function interpolateNormalizedColor(
  from: InterpolationRgba,
  to: InterpolationRgba,
  t: number,
  space: GradientInterpolationSpace,
  opts: { premultiplied?: boolean; hueInterpolation?: HueInterpolation } = {},
): InterpolationRgba {
  if (t <= 0) return { ...from };
  if (t >= 1) return { ...to };

  const premultiplied = opts.premultiplied !== false;
  const hueDir = opts.hueInterpolation ?? 'shorter';
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const af = Number.isFinite(from.a) ? Math.max(0, Math.min(1, from.a)) : 0;
  const at = Number.isFinite(to.a) ? Math.max(0, Math.min(1, to.a)) : 0;
  const outA = lerp(af, at);
  if (outA <= 0) return { r: 0, g: 0, b: 0, a: 0 };

  const finiteUnit = (value: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const toOklab = (color: InterpolationRgba): [number, number, number] =>
    linearSrgbToOklab([
      srgbToLinearUnit(color.r),
      srgbToLinearUnit(color.g),
      srgbToLinearUnit(color.b),
    ]);
  const toCoordinates = (
    color: InterpolationRgba,
    basis: 'srgb' | 'linear-srgb' | 'oklab',
  ): [number, number, number] => {
    if (basis === 'srgb') return [color.r, color.g, color.b];
    if (basis === 'linear-srgb') {
      return [srgbToLinearUnit(color.r), srgbToLinearUnit(color.g), srgbToLinearUnit(color.b)];
    }
    return toOklab(color);
  };
  const fromCoordinates = (
    coords: readonly [number, number, number],
    basis: 'srgb' | 'linear-srgb' | 'oklab',
  ): [number, number, number] => {
    if (basis === 'srgb')
      return [finiteUnit(coords[0]), finiteUnit(coords[1]), finiteUnit(coords[2])];
    if (basis === 'linear-srgb') {
      return [
        finiteUnit(linearToSrgbUnit(coords[0])),
        finiteUnit(linearToSrgbUnit(coords[1])),
        finiteUnit(linearToSrgbUnit(coords[2])),
      ];
    }
    const [r, g, b] = oklabToLinearSrgb([coords[0], coords[1], coords[2]]);
    return [
      finiteUnit(linearToSrgbUnit(r)),
      finiteUnit(linearToSrgbUnit(g)),
      finiteUnit(linearToSrgbUnit(b)),
    ];
  };
  const rectangular = (basis: 'srgb' | 'linear-srgb' | 'oklab'): [number, number, number] => {
    const a = toCoordinates(from, basis);
    const b = toCoordinates(to, basis);
    const coords: [number, number, number] = premultiplied
      ? [
          (a[0] * af + (b[0] * at - a[0] * af) * t) / outA,
          (a[1] * af + (b[1] * at - a[1] * af) * t) / outA,
          (a[2] * af + (b[2] * at - a[2] * af) * t) / outA,
        ]
      : [lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2])];
    return fromCoordinates(coords, basis);
  };

  // Premultiplication is defined in rectangular coordinates. For polar
  // spaces, use their rectangular companion whenever transparency is present
  // so hue is never multiplied as if it were a linear channel.
  if (space === 'srgb') {
    const [r, g, b] = rectangular('srgb');
    return { r, g, b, a: outA };
  }
  if (space === 'linear-srgb') {
    const [r, g, b] = rectangular('linear-srgb');
    return { r, g, b, a: outA };
  }
  if (space === 'oklab' || (premultiplied && (af < 1 || at < 1))) {
    const [r, g, b] = rectangular(space === 'hsl' ? 'srgb' : 'oklab');
    return { r, g, b, a: outA };
  }
  if (space === 'oklch') {
    const [L1, C1, H1] = oklabToOkLch(toOklab(from));
    const [L2, C2, H2] = oklabToOkLch(toOklab(to));
    if (C1 < 0.001 || C2 < 0.001) {
      const [r, g, b] = rectangular('oklab');
      return { r, g, b, a: outA };
    }
    const hue = lerpHue((H1 * 180) / Math.PI, (H2 * 180) / Math.PI, t, hueDir);
    const [r, g, b] = gamutMapToSrgbUnit([lerp(L1, L2), lerp(C1, C2), (hue * Math.PI) / 180]).map(
      (value) => finiteUnit(value / 255),
    ) as [number, number, number];
    return { r, g, b, a: outA };
  }

  const [h1, s1, l1] = rgbToHslUnit(from.r, from.g, from.b);
  const [h2, s2, l2] = rgbToHslUnit(to.r, to.g, to.b);
  if (s1 < 0.001 || s2 < 0.001) {
    const [r, g, b] = rectangular('srgb');
    return { r, g, b, a: outA };
  }
  const [r, g, b] = hslToRgbUnit(lerpHue(h1, h2, t, hueDir), lerp(s1, s2), lerp(l1, l2));
  return { r: finiteUnit(r), g: finiteUnit(g), b: finiteUnit(b), a: outA };
}

/**
 * Sample a gradient at position p (0-1) with interpolation space and midpoint bias.
 */
export function sampleGradientColor(
  stops: GradientStopInput[],
  position: number,
  space: GradientInterpolationSpace = 'srgb',
  opts: InterpolateOptions = {},
): RgbColor {
  if (stops.length === 0) return { space: 'rgb', r: 0, g: 0, b: 0, a: 0 };
  if (stops.length === 1) return normalizeStopColor(stops[0]!.color);

  const clamped = stops.map((s) => ({
    ...s,
    position: Math.max(0, Math.min(1, s.position)),
  }));
  const sorted = [...clamped].sort((a, b) => a.position - b.position);
  const p = Math.max(0, Math.min(1, position));

  if (p <= sorted[0]!.position) return normalizeStopColor(sorted[0]!.color);
  const last = sorted[sorted.length - 1]!;
  if (p >= last.position) return normalizeStopColor(last.color);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (p >= a.position && p <= b.position) {
      const span = b.position - a.position;
      const linearT = span === 0 ? 0 : (p - a.position) / span;
      const midpoint = a.midpoint ?? 0.5;
      const blendT = applyMidpointBias(linearT, midpoint);
      return interpolateManagedColor(
        normalizeStopColor(a.color),
        normalizeStopColor(b.color),
        blendT,
        space,
        opts,
      );
    }
  }

  return normalizeStopColor(last.color);
}

/**
 * Expand gradient stops into a denser list for canvas gradient APIs
 * (which only interpolate in sRGB). Samples `subdivisions` points per segment.
 */
export function expandGradientStops(
  stops: GradientStopInput[],
  space: GradientInterpolationSpace = 'srgb',
  subdivisions: number = 16,
  opts: InterpolateOptions = {},
): { position: number; color: RgbColor }[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) {
    const c = normalizeStopColor(stops[0]!.color);
    return [
      { position: 0, color: c },
      { position: 1, color: c },
    ];
  }

  const clamped = stops.map((s) => ({
    ...s,
    position: Math.max(0, Math.min(1, s.position)),
  }));
  const sorted = [...clamped].sort((a, b) => a.position - b.position);
  const result: { position: number; color: RgbColor }[] = [];
  const seen = new Set<string>();

  const add = (position: number, color: RgbColor) => {
    const key = position.toFixed(6);
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ position, color });
  };

  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]!.position;
    const segEnd = sorted[i + 1]!.position;
    const steps = Math.max(2, subdivisions);
    for (let s = 0; s < steps; s++) {
      const frac = s / (steps - 1);
      const pos = segStart + (segEnd - segStart) * frac;
      if (i > 0 && s === 0) continue; // avoid duplicate at segment boundary
      add(pos, sampleGradientColor(sorted, pos, space, opts));
    }
  }

  return result.sort((a, b) => a.position - b.position);
}
