/**
 * Optical bloom / high-key diffusion kernel.
 *
 * Pipeline: threshold+soft-knee on linearized luma → bright-pass extraction →
 * box-downsample pyramid → linear-light Gaussian blur per level (reusing the
 * engine's separable blur) → bilinear upsample + additive combine → tint →
 * optional anamorphic streak pass (directional smear in linear light).
 *
 * Colour semantics follow the repository's documented convention: blur and
 * brightness math in linear-light, final compositing in gamma space (see
 * docs/architecture/colour-management.md and the effects memory doc).
 *
 * Quality tiers: interactive renders the pyramid at half resolution; export
 * uses an extra pyramid level and full sample counts. Output is deterministic
 * per (params, quality, coordSpace).
 */

import { gaussianBlurLinearLight } from '../blur';
import type { CoordSpace } from './dither';
import { srgbToLinear01 } from './prng';
import type { EffectQuality } from './quality';
import { downsampleBox, qualityResolutionFactor, upsampleBilinear } from './quality';

export type BloomComposite = 'screen' | 'add';

export interface BloomParams {
  /** 0..1 luminance threshold for bright-pass extraction. */
  threshold: number;
  /** 0..1 soft-knee width around the threshold. */
  softKnee: number;
  /** Glow intensity multiplier (0..4). */
  intensity: number;
  /** Glow radius in document pixels. */
  radius: number;
  /** 0..1 — weight shift toward the wide (low-frequency) pyramid levels. */
  diffusion: number;
  /** Optional tint colour [r, g, b]; null/absent = white. */
  tint: readonly [number, number, number] | null;
  /** 0..1 tint mix. */
  tintAmount: number;
  composite: BloomComposite;
  /** Anamorphic streak mode. */
  streakEnabled: boolean;
  /** Streak angle in degrees. */
  streakAngle: number;
  /** Streak length in document pixels. */
  streakLength: number;
  /** 0..1 streak intensity. */
  streakIntensity: number;
  /** 1..8 — streak width anisotropy. */
  streakAspect: number;
  /** Serialized quality tier ('auto' resolves against the caller tier). */
  quality: 'auto' | EffectQuality;
}

interface ResolvedBloomParams {
  threshold: number;
  softKnee: number;
  intensity: number;
  radius: number;
  diffusion: number;
  tint: readonly [number, number, number] | null;
  tintAmount: number;
  composite: BloomComposite;
  streakEnabled: boolean;
  streakAngle: number;
  streakLength: number;
  streakIntensity: number;
  streakAspect: number;
  quality: EffectQuality;
}

/** Apply bloom in place. Returns the same ImageData. */
export function applyBloom(
  imageData: ImageData,
  params: BloomParams,
  options: { quality?: EffectQuality; coordSpace?: CoordSpace } = {},
): ImageData {
  const resolved: ResolvedBloomParams = {
    threshold: clamp01(params.threshold ?? 0.7),
    softKnee: clamp01(params.softKnee ?? 0.2),
    intensity: Math.max(0, params.intensity ?? 1),
    radius: Math.max(0, params.radius ?? 24),
    diffusion: clamp01(params.diffusion ?? 0.5),
    tint: params.tint ?? null,
    tintAmount: clamp01(params.tintAmount ?? 0),
    composite: params.composite ?? 'screen',
    streakEnabled: params.streakEnabled ?? false,
    streakAngle: params.streakAngle ?? 0,
    streakLength: Math.max(0, params.streakLength ?? 64),
    streakIntensity: clamp01(params.streakIntensity ?? 0.5),
    streakAspect: Math.max(1, params.streakAspect ?? 2),
    quality:
      params.quality && params.quality !== 'auto' ? params.quality : (options.quality ?? 'normal'),
  };
  if (resolved.intensity <= 0) return imageData;
  const scale = options.coordSpace && options.coordSpace.scale > 0 ? options.coordSpace.scale : 1;
  return applyBloomResolved(imageData, resolved, scale);
}

function applyBloomResolved(
  imageData: ImageData,
  p: ResolvedBloomParams,
  scale: number,
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const resFactor = qualityResolutionFactor(p.quality);
  const radius = Math.max(0.5, p.radius * scale);
  const streakLength = p.streakLength * scale;

  let src: Uint8ClampedArray<ArrayBuffer> = new Uint8ClampedArray(data);
  let sw = w;
  let sh = h;
  let work: Uint8ClampedArray<ArrayBuffer> | null = null;
  if (resFactor < 1) {
    const down = downsampleBox(data, w, h, 2);
    work = down.data;
    sw = down.width;
    sh = down.height;
    src = work;
  }

  // Linearized-luma LUT (256 entries) for the threshold test.
  const linLut = new Float32Array(256);
  for (let v = 0; v < 256; v += 1) linLut[v] = srgbToLinear01(v);

  // Bright pass. Threshold and knee are normalized 0..1; luminance is
  // linearized through the LUT so the comparison happens in linear-light.
  const bright = new Uint8ClampedArray(sw * sh * 4);
  const knee = p.softKnee;
  const thresh = p.threshold;
  for (let i = 0; i < sw * sh; i += 1) {
    const o = i * 4;
    const r = src[o]!;
    const g = src[o + 1]!;
    const b = src[o + 2]!;
    const a = src[o + 3]!;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const lin = linLut[Math.round(lum)]!;
    let m: number;
    if (knee <= 0) {
      m = lin >= thresh ? 1 : 0;
    } else {
      const d = (lin - thresh) / knee;
      m = d <= -1 ? 0 : d >= 1 ? 1 : d * 0.5 + 0.5;
    }
    const f = m * m;
    bright[o] = Math.round(r * f);
    bright[o + 1] = Math.round(g * f);
    bright[o + 2] = Math.round(b * f);
    bright[o + 3] = a;
  }

  // Pyramid: levels at 1/2^k, blurred in linear light.
  const levels: { data: Uint8ClampedArray; width: number; height: number; weight: number }[] = [];
  const levelCount = p.quality === 'export' ? 4 : 3;
  let lw = sw;
  let lh = sh;
  let lsrc = bright;
  for (let k = 0; k < levelCount; k += 1) {
    const f = 2;
    const down = downsampleBox(lsrc, lw, lh, f);
    lsrc = down.data;
    lw = down.width;
    lh = down.height;
    const blurRadius = Math.max(1, Math.round(radius / 2 ** k));
    const blurred = gaussianBlurLinearLight(
      new ImageData(down.data, lw, lh),
      Math.min(32, blurRadius),
    ).data;
    // Wider levels weigh more when diffusion is high.
    const weight = 1 + (levelCount - k) * p.diffusion * 0.35;
    levels.push({ data: blurred, width: lw, height: lh, weight });
    if (lw <= 1 || lh <= 1) break;
  }

  // Streak pass: directional smear on the widest level.
  if (p.streakEnabled && p.streakIntensity > 0 && levels.length > 0) {
    const top = levels[levels.length - 1]!;
    streakSmear(
      top.data,
      top.width,
      top.height,
      p.streakAngle,
      streakLength / 2 ** (levelCount - 1),
      p.streakIntensity,
      p.streakAspect,
      linLut,
    );
  }

  // Combine: upsample each level to full res and add.
  const glow = new Float32Array(w * h * 4);
  const glowCount = new Float32Array(w * h);
  const half = new Uint8ClampedArray(sw * sh * 4);
  for (const level of levels) {
    upsampleBilinear(level.data, level.width, level.height, half, sw, sh);
    const lwgt = level.weight;
    for (let i = 0; i < sw * sh; i += 1) {
      const o = i * 4;
      glow[o]! += half[o]! * lwgt;
      glow[o + 1]! += half[o + 1]! * lwgt;
      glow[o + 2]! += half[o + 2]! * lwgt;
      glowCount[i]! += lwgt;
    }
  }
  for (let i = 0; i < sw * sh; i += 1) {
    const o = i * 4;
    const n = glowCount[i] || 1;
    glow[o]! /= n;
    glow[o + 1]! /= n;
    glow[o + 2]! /= n;
  }

  // Composite glow over the source (with optional tint).
  const tr = p.tint ? p.tint[0] : 255;
  const tg = p.tint ? p.tint[1] : 255;
  const tb = p.tint ? p.tint[2] : 255;
  const tintMix = p.tint && p.tintAmount > 0 ? p.tintAmount : 0;
  const intensity = p.intensity;
  for (let i = 0; i < sw * sh; i += 1) {
    const o = i * 4;
    let gr = glow[o]!;
    let gg = glow[o + 1]!;
    let gb = glow[o + 2]!;
    if (tintMix > 0) {
      gr = gr + (gr * (tr / 255) - gr) * tintMix;
      gg = gg + (gg * (tg / 255) - gg) * tintMix;
      gb = gb + (gb * (tb / 255) - gb) * tintMix;
    }
    if (p.composite === 'add') {
      src[o] = clampByte(src[o]! + gr * intensity);
      src[o + 1] = clampByte(src[o + 1]! + gg * intensity);
      src[o + 2] = clampByte(src[o + 2]! + gb * intensity);
    } else {
      const invR = 255 - src[o]!;
      src[o] = clampByte(255 - (invR * (255 - gr * intensity)) / 255);
      src[o + 1] = clampByte(255 - ((255 - src[o + 1]!) * (255 - gg * intensity)) / 255);
      src[o + 2] = clampByte(255 - ((255 - src[o + 2]!) * (255 - gb * intensity)) / 255);
    }
  }

  // Upscale interactive-tier result back to full resolution, or write the
  // composed result back to the source buffer at full resolution.
  if (work && (sw !== w || sh !== h)) {
    const restored = new Uint8ClampedArray(w * h * 4);
    upsampleBilinear(src, sw, sh, restored, w, h);
    data.set(restored);
  } else {
    data.set(src);
  }
  return imageData;
}

/** Directional smear (streak) in linear light along an angle. */
function streakSmear(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  angleDeg: number,
  lengthPx: number,
  intensity: number,
  aspect: number,
  linLut: Float32Array,
): void {
  if (lengthPx < 1) return;
  const angle = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Pre-linearize (blur-like: work in linear light).
  const linear = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    linear[i * 3] = linLut[data[o]!]!;
    linear[i * 3 + 1] = linLut[data[o + 1]!]!;
    linear[i * 3 + 2] = linLut[data[o + 2]!]!;
  }
  const out = new Float32Array(w * h * 3);
  const steps = Math.max(3, Math.min(32, Math.round(lengthPx / 3)));
  const stepPx = lengthPx / steps;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let n = 0;
      for (let s = -steps; s <= steps; s += 1) {
        const sx = x + dx * s * stepPx;
        const sy = y + dy * s * stepPx;
        const xi = Math.round(sx);
        const yi = Math.round(sy);
        if (xi < 0 || xi >= w || yi < 0 || yi >= h) continue;
        const o = (yi * w + xi) * 3;
        ar += linear[o]!;
        ag += linear[o + 1]!;
        ab += linear[o + 2]!;
        n += 1;
      }
      if (n === 0) continue;
      const o = (y * w + x) * 3;
      out[o] = ar / n;
      out[o + 1] = ag / n;
      out[o + 2] = ab / n;
    }
  }
  // Blend streak (which is linear-light) back, width-weighted by aspect:
  // horizontal-ish streaks keep vertical extent thin.
  const aspectScale = Math.max(1, aspect);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const s = intensity * 0.5;
      const lr = out[(y * w + x) * 3]!;
      const lg = out[(y * w + x) * 3 + 1]!;
      const lb = out[(y * w + x) * 3 + 2]!;
      const mix = s / Math.max(1, aspectScale * 0.5);
      const nr = (data[o]! / 255) * (1 - mix) + lr * mix;
      data[o] = clampByte(srgbBack(nr));
      const ng = (data[o + 1]! / 255) * (1 - mix) + lg * mix;
      data[o + 1] = clampByte(srgbBack(ng));
      const nb = (data[o + 2]! / 255) * (1 - mix) + lb * mix;
      data[o + 2] = clampByte(srgbBack(nb));
    }
  }
}

function srgbBack(linear: number): number {
  const v = Math.max(0, Math.min(1, linear));
  return (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055) * 255;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
