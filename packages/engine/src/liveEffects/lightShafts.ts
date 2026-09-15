/**
 * Volumetric light shafts — screen-space radial light scattering.
 *
 * Technique (named accurately): this is NOT ray tracing. It is a screen-space
 * approximation that marches a small number of steps along each pixel's ray
 * toward the light source, accumulating luminance-weighted scattering. It is
 * the classic "god rays" radial-blur trick used by real-time engines, and
 * matches how the effect is documented in the UI.
 *
 * Occlusion source: 'luminance' treats bright content as light-emitting;
 * 'alpha' treats opaque content as scattering surfaces.
 *
 * Quality tiers scale the step count (interactive 12, normal 24, export 48).
 * Deterministic for a fixed (params, quality, surface size).
 */

import { srgbToLinear01 } from './prng';
import type { EffectQuality } from './quality';

export type LightShaftOcclusion = 'luminance' | 'alpha';

export interface LightShaftsParams {
  /** Light position, normalized 0..1. */
  lightX: number;
  lightY: number;
  lightType: 'point' | 'directional';
  /** Directional light angle in degrees. */
  direction: number;
  /** 0..3 scattering intensity. */
  intensity: number;
  /** -1..1 exposure shift (pre-scatter gain). */
  exposure: number;
  /** 0..1 ray energy decay per step. */
  decay: number;
  /** 0..1 per-step scattering opacity. */
  density: number;
  /** 0..1 occlusion weight (how strongly bright content scatters). */
  weight: number;
  /** 8..96 ray-march steps. */
  sampleCount: number;
  /** 0..1 radial scattering spread (0 = sharp shaft, 1 = diffuse). */
  scattering: number;
  /** Optional tint [r, g, b]. */
  tint: readonly [number, number, number] | null;
  occlusionSource: LightShaftOcclusion;
  /** Serialized quality tier. */
  quality: 'auto' | EffectQuality;
}

/** Apply light shafts in place. Returns the same ImageData. */
export function applyLightShafts(
  imageData: ImageData,
  params: LightShaftsParams,
  options: { quality?: EffectQuality } = {},
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const quality: EffectQuality =
    params.quality && params.quality !== 'auto' ? params.quality : (options.quality ?? 'normal');
  const intensity = Math.max(0, params.intensity ?? 1);
  if (intensity <= 0) return imageData;

  const exposure = clampRange(params.exposure ?? 0, -1, 1);
  const decay = clamp01(params.decay ?? 0.9);
  const density = clamp01(params.density ?? 0.15);
  const weight = clamp01(params.weight ?? 0.8);
  const scattering = clamp01(params.scattering ?? 0.5);
  const occlusion = params.occlusionSource ?? 'luminance';
  const steps = Math.max(
    4,
    Math.min(
      96,
      Math.round(params.sampleCount ?? 24) *
        (quality === 'interactive' ? 0.5 : quality === 'export' ? 2 : 1),
    ),
  );

  const linLut = new Float32Array(256);
  for (let v = 0; v < 256; v += 1) linLut[v] = srgbToLinear01(v);

  // Precompute the occlusion mask (0..1): how strongly each pixel scatters.
  const occ = new Float32Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    if (occlusion === 'alpha') {
      occ[i] = data[o + 3]! / 255;
    } else {
      const lum =
        linLut[Math.round(0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!)]!;
      occ[i] = Math.max(0, lum - 0.12) * weight;
    }
  }

  const lightX = w * clamp01(params.lightX ?? 0.5);
  const lightY = h * clamp01(params.lightY ?? 0.5);
  const isDirectional = params.lightType === 'directional';
  const angle = ((params.direction ?? 0) * Math.PI) / 180;
  const dirX = -Math.cos(angle);
  const dirY = -Math.sin(angle);
  const maxDist = Math.hypot(w, h);

  const tr = params.tint ? params.tint[0] : 255;
  const tg = params.tint ? params.tint[1] : 255;
  const tb = params.tint ? params.tint[2] : 255;
  const tintMix = params.tint ? 1 : 0;

  // Scatter buffer (Float32, gamma-space accumulation like the rest of the
  // compositor; luminance is linearized for the mask only).
  const scatter = new Float32Array(w * h * 3);

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const px = x + 0.5;
      const py = y + 0.5;
      let rayX: number;
      let rayY: number;
      if (isDirectional) {
        rayX = dirX;
        rayY = dirY;
      } else {
        const ddx = lightX - px;
        const ddy = lightY - py;
        const d = Math.hypot(ddx, ddy) || 1;
        rayX = ddx / d;
        rayY = ddy / d;
      }
      const distToLight = isDirectional ? maxDist : Math.hypot(lightX - px, lightY - py);
      const stepLen = Math.max(1, distToLight / steps);
      let acc = 0;
      let sampleX = px;
      let sampleY = py;
      let e = 1;
      for (let s = 0; s < steps; s += 1) {
        sampleX += rayX * stepLen;
        sampleY += rayY * stepLen;
        const si =
          Math.min(w - 1, Math.max(0, Math.floor(sampleX))) +
          Math.min(h - 1, Math.max(0, Math.floor(sampleY))) * w;
        acc += occ[si]! * e * density;
        e *= decay;
        if (sampleX < 0 || sampleX >= w || sampleY < 0 || sampleY >= h) break;
      }
      scatter[i * 3] = acc;
      scatter[i * 3 + 1] = acc;
      scatter[i * 3 + 2] = acc;
    }
  }

  // Optional diffuse pass: blur the scatter map by the scattering amount.
  if (scattering > 0) {
    blurScatter(scatter, w, h, Math.max(1, Math.round(scattering * 6)));
  }

  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    const a = data[o + 3]!;
    const s = scatter[i * 3]!;
    const gain = intensity * 2 ** exposure;
    let lr = s * gain;
    let lg = s * gain;
    let lb = s * gain;
    if (tintMix > 0) {
      lr *= tr / 255;
      lg *= tg / 255;
      lb *= tb / 255;
    }
    data[o] = clampByte(data[o]! + lr);
    data[o + 1] = clampByte(data[o + 1]! + lg);
    data[o + 2] = clampByte(data[o + 2]! + lb);
    data[o + 3] = a;
  }

  return imageData;
}

function blurScatter(scatter: Float32Array, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const o = (ny * w + nx) * 3;
          r += scatter[o]!;
          g += scatter[o + 1]!;
          b += scatter[o + 2]!;
          n += 1;
        }
      }
      const o = (y * w + x) * 3;
      tmp[o] = r / n;
      tmp[o + 1] = g / n;
      tmp[o + 2] = b / n;
    }
  }
  scatter.set(tmp);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampRange(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
