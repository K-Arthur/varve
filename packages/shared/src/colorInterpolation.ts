/**
 * Perceptually uniform gradient color interpolation.
 *
 * Supports sRGB, Oklab, Oklch, and HSL interpolation spaces for gradient
 * stop blending. Handles midpoint bias (Figma-style) and premultiplied alpha.
 *
 * Research basis: Björn Ottosson Oklab (2020), CSS Color Level 4 color-mix(),
 * Figma gradient midpoint controls, Porter-Duff premultiplied alpha compositing.
 */
import {
  gamutMapToSrgb,
  gamutMapToSrgbUnit,
  linearSrgbToOklab,
  linearToSrgbUnit,
  managedColorToNormalized,
  oklabToLinearSrgb,
  oklabToOkLch,
  oklchToOkLab,
  srgbToLinear,
} from './colorConversion';

/** Color space used for gradient stop interpolation. */
export type GradientInterpolationSpace = 'srgb' | 'oklab' | 'oklch' | 'hsl';

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

/** Convert sRGB 0-255 to HSL (h: 0-360, s/l: 0-1). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

/** Convert HSL to sRGB 0-255. */
function hslToRgb(
  h: number,
  s: number,
  l: number,
  precision: 'display' | 'working' = 'display',
): [number, number, number] {
  if (s === 0) {
    const v = toRgbColor(l * 255, l * 255, l * 255, 255, precision).r;
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hn = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    toRgbColor(hue2rgb(p, q, hn + 1 / 3) * 255, 0, 0, 255, precision).r,
    toRgbColor(hue2rgb(p, q, hn) * 255, 0, 0, 255, precision).r,
    toRgbColor(hue2rgb(p, q, hn - 1 / 3) * 255, 0, 0, 255, precision).r,
  ];
}

/** Shortest-path hue interpolation in degrees. */
function lerpHue(h1: number, h2: number, t: number): number {
  let diff = h2 - h1;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
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

  const premultiplied = opts.premultiplied !== false;
  const precision = opts.precision ?? 'display';

  if (premultiplied && (from.a < 255 || to.a < 255)) {
    const af = from.a / 255;
    const at = to.a / 255;
    const pmFrom = toRgbColor(from.r * af, from.g * af, from.b * af, from.a, precision);
    const pmTo = toRgbColor(to.r * at, to.g * at, to.b * at, to.a, precision);
    const pmResult = interpolateManagedColor(pmFrom, pmTo, t, space, { premultiplied: false });
    const outA = clamp255(from.a + (to.a - from.a) * t);
    if (outA === 0) return toRgbColor(0, 0, 0, 0);
    const outAf = outA / 255;
    return toRgbColor(pmResult.r / outAf, pmResult.g / outAf, pmResult.b / outAf, outA, precision);
  }

  switch (space) {
    case 'srgb':
      return toRgbColor(
        from.r + (to.r - from.r) * t,
        from.g + (to.g - from.g) * t,
        from.b + (to.b - from.b) * t,
        from.a + (to.a - from.a) * t,
        precision,
      );

    case 'oklab': {
      const lerp = (a: number, b: number) => a + (b - a) * t;
      const toLinear = (c: RgbColor): [number, number, number] => [
        srgbToLinear(c.r),
        srgbToLinear(c.g),
        srgbToLinear(c.b),
      ];
      const [l1, a1, b1] = linearSrgbToOklab(toLinear(from));
      const [l2, a2, b2] = linearSrgbToOklab(toLinear(to));
      const lab: [number, number, number] = [lerp(l1, l2), lerp(a1, a2), lerp(b1, b2)];
      const [lr, lg, lb] = oklabToLinearSrgb(lab);
      return toRgbColor(
        linearToSrgbUnit(lr) * 255,
        linearToSrgbUnit(lg) * 255,
        linearToSrgbUnit(lb) * 255,
        from.a + (to.a - from.a) * t,
        precision,
      );
    }

    case 'oklch': {
      const toLinear = (c: RgbColor): [number, number, number] => [
        srgbToLinear(c.r),
        srgbToLinear(c.g),
        srgbToLinear(c.b),
      ];
      const [l1, a1, b1] = linearSrgbToOklab(toLinear(from));
      const [l2, a2, b2] = linearSrgbToOklab(toLinear(to));
      const [L1, C1, H1] = oklabToOkLch([l1, a1, b1]);
      const [L2, C2, H2] = oklabToOkLch([l2, a2, b2]);
      // When either endpoint has near-zero chroma, the hue is undefined
      // (oklabToOkLch returns H=0 from atan2(0,0)). Interpolating from
      // the arbitrary 0 to a real hue produces visible hue shift through
      // gray. Fall back to OKLab, which has no undefined-hue problem.
      if (C1 < 0.001 || C2 < 0.001) {
        return interpolateManagedColor(from, to, t, 'oklab', { ...opts, premultiplied: false });
      }
      const lerp = (a: number, b: number) => a + (b - a) * t;
      let h2 = H2;
      const h1 = H1;
      const diff = h2 - h1;
      if (diff > Math.PI) h2 -= 2 * Math.PI;
      else if (diff < -Math.PI) h2 += 2 * Math.PI;
      const H = h1 + (h2 - h1) * t;
      const oklab = oklchToOkLab([lerp(L1, L2), lerp(C1, C2), H]);
      const [lr, lg, lb] = oklabToLinearSrgb(oklab);
      const [r, g, b] = (precision === 'working' ? gamutMapToSrgbUnit : gamutMapToSrgb)([
        lerp(L1, L2),
        lerp(C1, C2),
        H,
      ]);
      void lr;
      void lg;
      void lb;
      return toRgbColor(r, g, b, from.a + (to.a - from.a) * t, precision);
    }

    case 'hsl': {
      const [h1, s1, l1] = rgbToHsl(from.r, from.g, from.b);
      const [h2, s2, l2] = rgbToHsl(to.r, to.g, to.b);
      const lerp = (a: number, b: number) => a + (b - a) * t;
      const [r, g, b] = hslToRgb(lerpHue(h1, h2, t), lerp(s1, s2), lerp(l1, l2), precision);
      return toRgbColor(r, g, b, from.a + (to.a - from.a) * t, precision);
    }
  }
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

/**
 * Sample a gradient at position p (0-1) with interpolation space and midpoint bias.
 */
export function sampleGradientColor(
  stops: GradientStopInput[],
  position: number,
  space: GradientInterpolationSpace = 'oklab',
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
  space: GradientInterpolationSpace = 'oklab',
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
