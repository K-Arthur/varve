/**
 * Light leak generator — procedural camera/sensor light leaks.
 *
 * A deterministic seeded noise field (fBm) is oriented along a direction and
 * masked by a soft positional falloff, then composited as a screen blend with
 * an HSL-derived colour. No black layers required: the effect is entirely
 * self-contained. Same (seed, params, surface) ⇒ same output.
 */

import { fbm2 } from './prng';

export interface LightLeakParams {
  /** Deterministic seed. */
  seed: number;
  /** Position normalized 0..1. */
  x: number;
  y: number;
  /** Orientation in degrees (0 = along +x). */
  angle: number;
  /** 0..2 size (relative to surface diagonal). */
  size: number;
  /** 0..1 softness (higher = more diffuse). */
  softness: number;
  /** Hue 0..360. */
  hue: number;
  /** Saturation 0..1. */
  saturation: number;
  /** 0..1 colour lightness. */
  lightness: number;
  /** 0..2 intensity. */
  intensity: number;
  /** 0..1 noise scale (0 = flat falloff, 1 = fine grain). */
  noiseScale: number;
}

/** Apply the light leak in place. Returns the same ImageData. */
export function applyLightLeak(imageData: ImageData, params: LightLeakParams): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const intensity = Math.max(0, params.intensity ?? 0.6);
  if (intensity <= 0) return imageData;

  const seed = Math.round(params.seed ?? 0) >>> 0;
  const cx = w * clamp01(params.x ?? 0.5);
  const cy = h * clamp01(params.y ?? 0.5);
  const angle = ((params.angle ?? 0) * Math.PI) / 180;
  const diag = Math.hypot(w, h);
  const size = Math.max(0.05, params.size ?? 0.8);
  const sigma = diag * size * 0.14;
  const softness = clamp01(params.softness ?? 0.6);
  const noiseScale = clamp01(params.noiseScale ?? 0.5);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const noiseFreq = (1 / Math.max(1, diag * 0.02)) * (0.3 + noiseScale * 1.6);
  const octaves = 1 + Math.round(softness * 3);

  // HSL → RGB (deterministic, analytic).
  const [cr, cg, cb] = hslToRgb(
    params.hue ?? 0,
    clamp01(params.saturation ?? 0.7),
    clamp01(params.lightness ?? 0.6),
  );

  const sigma2 = 2 * sigma * sigma;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const a = data[o + 3]!;
      // Oriented noise coordinates.
      const dx = x - cx;
      const dy = y - cy;
      const nx = dx * cosA - dy * sinA;
      const ny = dx * sinA + dy * cosA;
      const n = fbm2(nx * noiseFreq, ny * noiseFreq, seed, octaves);
      const g = Math.exp(-(dx * dx + dy * dy) / sigma2);
      const leak = n * g * intensity;
      if (leak <= 0.004) continue;
      // Screen blend.
      const lr = cr * leak;
      const lg = cg * leak;
      const lb = cb * leak;
      data[o] = clampByte(255 - ((255 - data[o]!) * (255 - lr)) / 255);
      data[o + 1] = clampByte(255 - ((255 - data[o + 1]!) * (255 - lg)) / 255);
      data[o + 2] = clampByte(255 - ((255 - data[o + 2]!) * (255 - lb)) / 255);
      data[o + 3] = a;
    }
  }
  return imageData;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360;
  if (s <= 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, hue + 1 / 3);
  const g = hue2rgb(p, q, hue);
  const b = hue2rgb(p, q, hue - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
