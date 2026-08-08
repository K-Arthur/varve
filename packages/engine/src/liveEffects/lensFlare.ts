/**
 * Procedural lens flare generator.
 *
 * Flare components are generated deterministically from parameters — no
 * bitmap assets, no Math.random(). Components: central halo, ghost circles
 * along the flare axis, aperture polygon (star with N blades), diffraction
 * streaks, and radial chromatic dispersion. A negative source position makes
 * the flare auto-track the brightest pixel in the surface (computed once,
 * deterministically — a fixed surface yields a fixed source).
 */

import { seeded01 } from './prng';
import type { EffectQuality } from './quality';

export interface LensFlareParams {
  /** Source position normalized 0..1; (-1, -1) = auto (brightest pixel). */
  sourceX: number;
  sourceY: number;
  /** 0..2 overall brightness. */
  brightness: number;
  /** 0..2 flare size scale. */
  scale: number;
  /** 0..8 ghost count. */
  ghostCount: number;
  /** 0..2 ghost spacing (multiples of flare radius). */
  ghostSpacing: number;
  /** 0..1 halo intensity. */
  halo: number;
  /** 0 = none, 3..12 aperture blades. */
  apertureBlades: number;
  /** Aperture rotation in degrees. */
  apertureRotation: number;
  /** 0..1 diffraction streak intensity. */
  streakIntensity: number;
  /** 0..1 anamorphic ratio (0 = circular, 1 = wide anamorphic). */
  anamorphicRatio: number;
  /** 0..1 radial chromatic dispersion. */
  chromaticDispersion: number;
  /** Deterministic seed. */
  seed: number;
  /** Serialized quality tier. */
  quality: 'auto' | EffectQuality;
}

/** Apply the lens flare in place. Returns the same ImageData. */
export function applyLensFlare(
  imageData: ImageData,
  params: LensFlareParams,
  options: { quality?: EffectQuality } = {},
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const brightness = Math.max(0, params.brightness ?? 1);
  if (brightness <= 0) return imageData;

  const seed = Math.round(params.seed ?? 0) >>> 0;
  const scale = Math.max(0.05, params.scale ?? 1);
  const baseRadius = Math.min(w, h) * 0.09 * scale;
  const ghostCount = Math.max(0, Math.min(8, Math.round(params.ghostCount ?? 4)));
  const ghostSpacing = Math.max(0, params.ghostSpacing ?? 0.8);
  const halo = clamp01(params.halo ?? 0.4);
  const blades = Math.round(params.apertureBlades ?? 0);
  const apertureRotation = ((params.apertureRotation ?? 0) * Math.PI) / 180;
  const streak = clamp01(params.streakIntensity ?? 0);
  const anamorphic = clamp01(params.anamorphicRatio ?? 0);
  const dispersion = clamp01(params.chromaticDispersion ?? 0);
  const quality: EffectQuality =
    params.quality && params.quality !== 'auto' ? params.quality : (options.quality ?? 'normal');
  void quality;

  // Source position: explicit or brightest pixel.
  let sx = params.sourceX ?? -1;
  let sy = params.sourceY ?? -1;
  if (sx < 0 || sy < 0 || sx > 1 || sy > 1) {
    const found = findBrightest(data, w, h);
    sx = found.x / w;
    sy = found.y / h;
  }
  const lx = w * clamp01(sx);
  const ly = h * clamp01(sy);

  const ax = w / 2 - lx;
  const ay = h / 2 - ly;
  const axisLen = Math.hypot(ax, ay) || 1;
  const ux = ax / axisLen;
  const uy = ay / axisLen;

  // Per-component drawing (additive accumulation on a float buffer).
  const acc = new Float32Array(w * h * 3);
  const brightnessFactor = brightness * (quality === 'interactive' ? 0.85 : 1);

  // Central halo.
  if (halo > 0) {
    const hr = baseRadius * 2.2;
    addGlow(acc, lx, ly, hr, halo * 0.5 * brightnessFactor, 1, w, h);
  }

  // Ghosts along the axis opposite the source.
  for (let i = 1; i <= ghostCount; i += 1) {
    const g = seeded01(seed + i * 7919);
    const dir = -1;
    const gx = lx + ux * dir * i * ghostSpacing * baseRadius * 1.6;
    const gy = ly + uy * dir * i * ghostSpacing * baseRadius * 1.6;
    const gr = baseRadius * (0.55 - i * 0.04) * (0.7 + g * 0.6);
    const intensity = brightnessFactor * (1 - i / (ghostCount + 1)) * 0.8;
    if (dispersion > 0) {
      const off = gr * dispersion;
      addGlowChannel(acc, gx + off * ux, gy + off * uy, gr, intensity, 0, w, h);
      addGlowChannel(acc, gx - off * ux, gy - off * uy, gr, intensity, 2, w, h);
      addGlowChannel(acc, gx, gy, gr, intensity * 0.7, 1, w, h);
    } else {
      addGlow(acc, gx, gy, gr, intensity, 1, w, h);
    }
  }

  // Diffraction streaks (anamorphic-weighted cross).
  if (streak > 0) {
    const sr = baseRadius * (4 + anamorphic * 6);
    const sw = Math.max(1, baseRadius * 0.045 * (1 - anamorphic * 0.6));
    addStreak(acc, lx, ly, ux, uy, sr, sw, streak * 0.9 * brightnessFactor, w, h);
    addStreak(
      acc,
      lx,
      ly,
      -uy,
      ux,
      sr * (1 + anamorphic),
      sw * (1 + anamorphic),
      streak * 0.5 * brightnessFactor,
      w,
      h,
    );
  }

  // Aperture polygon star.
  if (blades >= 3) {
    const ar = baseRadius * 1.5;
    addAperture(acc, lx, ly, blades, apertureRotation, ar, brightnessFactor * 0.55, w, h);
  }

  // Composite additively.
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    data[o] = clampByte(data[o]! + acc[i * 3]!);
    data[o + 1] = clampByte(data[o + 1]! + acc[i * 3 + 1]!);
    data[o + 2] = clampByte(data[o + 2]! + acc[i * 3 + 2]!);
  }
  return imageData;
}

function findBrightest(data: Uint8ClampedArray, w: number, h: number): { x: number; y: number } {
  let best = -1;
  let bestLum = -1;
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const lum = 0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!;
    if (lum > bestLum) {
      bestLum = lum;
      best = i;
    }
  }
  return { x: best % w, y: Math.floor(best / w) };
}

function addGlow(
  acc: Float32Array,
  cx: number,
  cy: number,
  radius: number,
  intensity: number,
  channelScale: number,
  w: number,
  h: number,
): void {
  addGlowChannel(acc, cx, cy, radius, intensity, -1, w, h, channelScale);
}

function addGlowChannel(
  acc: Float32Array,
  cx: number,
  cy: number,
  radius: number,
  intensity: number,
  channel: number,
  ww: number,
  hh: number,
  channelScale = 1,
): void {
  const r2 = radius * radius;
  if (r2 <= 0) return;
  const x0 = Math.max(0, Math.floor(cx - radius * 2));
  const y0 = Math.max(0, Math.floor(cy - radius * 2));
  const x1 = Math.min(ww - 1, Math.ceil(cx + radius * 2));
  const y1 = Math.min(hh - 1, Math.ceil(cy + radius * 2));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      const v = Math.exp(-d2 / (2 * r2)) * intensity;
      if (v < 0.004) continue;
      const o = (y * ww + x) * 3;
      if (channel === -1) {
        acc[o]! += v * channelScale;
        acc[o + 1]! += v * channelScale;
        acc[o + 2]! += v * channelScale;
      } else {
        acc[o + channel]! += v;
      }
    }
  }
}

function addStreak(
  acc: Float32Array,
  cx: number,
  cy: number,
  ux: number,
  uy: number,
  length: number,
  width: number,
  intensity: number,
  ww: number,
  hh: number,
): void {
  const a = Math.atan2(uy, ux);
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  const halfLen = length;
  const w2 = Math.max(0.6, width * width);
  const x0 = Math.max(0, Math.floor(cx - Math.abs(cosA) * halfLen - width));
  const y0 = Math.max(0, Math.floor(cy - Math.abs(sinA) * halfLen - width));
  const x1 = Math.min(ww - 1, Math.ceil(cx + Math.abs(cosA) * halfLen + width));
  const y1 = Math.min(hh - 1, Math.ceil(cy + Math.abs(sinA) * halfLen + width));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const along = dx * cosA + dy * sinA;
      const perp = -dx * sinA + dy * cosA;
      const lenFalloff = Math.exp(-(along * along) / (2 * (halfLen * halfLen)));
      const perpFalloff = Math.exp(-(perp * perp) / (2 * w2));
      const v = lenFalloff * perpFalloff * intensity;
      if (v < 0.004) continue;
      const o = (y * ww + x) * 3;
      acc[o]! += v;
      acc[o + 1]! += v;
      acc[o + 2]! += v;
    }
  }
}

function addAperture(
  acc: Float32Array,
  cx: number,
  cy: number,
  blades: number,
  rotation: number,
  radius: number,
  intensity: number,
  ww: number,
  hh: number,
): void {
  // Regular polygon with `blades` vertices; sample a soft falloff inside the
  // polygon so the aperture reads as a star-shaped glow.
  const outer = radius;
  const inner = radius * 0.82;
  const x0 = Math.max(0, Math.floor(cx - outer));
  const y0 = Math.max(0, Math.floor(cy - outer));
  const x1 = Math.min(ww - 1, Math.ceil(cx + outer));
  const y1 = Math.min(hh - 1, Math.ceil(cy + outer));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > outer) continue;
      const ang = Math.atan2(dy, dx) + rotation;
      const sector = (ang / Math.PI) * blades;
      const f = Math.abs(sector - Math.round(sector));
      const radAtAngle = lerp(inner, outer, 1 - f);
      const inside = dist <= radAtAngle ? 1 : Math.exp(-((dist - radAtAngle) ** 2) / (2 * 0.8));
      const v = inside * intensity * 0.6;
      if (v < 0.004) continue;
      const o = (y * ww + x) * 3;
      acc[o]! += v;
      acc[o + 1]! += v;
      acc[o + 2]! += v;
    }
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
