/**
 * Procedural water caustics / liquid refraction kernel.
 *
 * Physics-inspired multi-wave interference: the surface height field is a sum
 * of travelling sine waves with seeded directions/phases/speeds. The caustic
 * brightness derives from the field's Laplacian (focusing — where waves
 * converge light is concentrated), and refraction displaces sampling along
 * the analytic gradient. This is substantially more physical than a sine
 * displacement filter and is fully deterministic per (seed, time, params).
 *
 * Outputs: 'combined' (refraction + lighting), 'lighting' (caustic light
 * only), 'refraction' (displacement only). Tileable mode uses integer-lattice
 * wave vectors so the field is exactly periodic in space.
 *
 * The field is evaluated at quality-adaptive resolution (interactive = half)
 * and bilinearly upsampled; the wave math itself is analytic at every point.
 */

import type { CoordSpace } from './dither';
import { seeded01 } from './prng';
import type { EffectQuality } from './quality';

export type CausticsOutput = 'combined' | 'lighting' | 'refraction';

export interface CausticsParams {
  /** Wave scale in document pixels (wavelength base). */
  scale: number;
  /** 0..1 water depth (amplitude of the field). */
  depth: number;
  /** 2..8 wave count. */
  waveCount: number;
  /** 0..1 complexity (extra octave mixing). */
  complexity: number;
  /** 0..1 refraction displacement strength. */
  refractionAmount: number;
  /** 0..1 focusing sharpness. */
  sharpness: number;
  /** Light angle in degrees (shading direction). */
  lightAngle: number;
  /** 0..2 caustic brightness. */
  brightness: number;
  /** 0..2 contrast. */
  contrast: number;
  /** 0..1 per-channel dispersion (RGB separated refraction). */
  dispersion: number;
  /** 0..1 refraction output strength. */
  distortionAmount: number;
  output: CausticsOutput;
  /** Optional water tint [r, g, b]. */
  waterTint: readonly [number, number, number] | null;
  /** Optional surface tint [r, g, b]. */
  surfaceTint: readonly [number, number, number] | null;
  /** Deterministic seed. */
  seed: number;
  /** Time in seconds (animatable; separate from seed). */
  time: number;
  /** 0..2 animation speed. */
  animationSpeed: number;
  /** Seamless/tileable field. */
  tileable: boolean;
  /** Serialized quality tier. */
  quality: 'auto' | EffectQuality;
}

interface Wave {
  kx: number;
  ky: number;
  phase: number;
  speed: number;
  amp: number;
}

/** Build the deterministic wave set for (seed, params). */
export function buildCausticWaves(params: CausticsParams, scalePx: number): Wave[] {
  const count = Math.max(2, Math.min(8, Math.round(params.waveCount ?? 4)));
  const seed = Math.round(params.seed ?? 0) >>> 0;
  const tileable = params.tileable ?? false;
  const period = scalePx * 4;
  const waves: Wave[] = [];
  for (let i = 0; i < count; i += 1) {
    let kx: number;
    let ky: number;
    if (tileable) {
      const nx = Math.max(1, Math.round(seeded01(seed + i * 101 + 1) * 3));
      const my = Math.max(1, Math.round(seeded01(seed + i * 101 + 2) * 3));
      kx = (nx * 2 * Math.PI) / period;
      ky = (my * 2 * Math.PI) / period;
      if ((i & 1) === 0) kx = -kx;
      if ((i & 2) === 0) ky = -ky;
    } else {
      const angle = seeded01(seed + i * 101) * Math.PI * 2;
      const freq = ((2 * Math.PI) / scalePx) * (0.7 + seeded01(seed + i * 101 + 7) * 0.6);
      kx = Math.cos(angle) * freq;
      ky = Math.sin(angle) * freq;
    }
    const phase = seeded01(seed + i * 101 + 3) * Math.PI * 2;
    const speed = (seeded01(seed + i * 101 + 5) - 0.5) * 2 * (params.animationSpeed ?? 1);
    waves.push({ kx, ky, phase, speed, amp: 1 / count });
  }
  return waves;
}

/** Apply caustics in place. Returns the same ImageData. */
export function applyCaustics(
  imageData: ImageData,
  params: CausticsParams,
  options: { quality?: EffectQuality; coordSpace?: CoordSpace } = {},
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const quality: EffectQuality =
    params.quality && params.quality !== 'auto' ? params.quality : (options.quality ?? 'normal');
  const scale = options.coordSpace && options.coordSpace.scale > 0 ? options.coordSpace.scale : 1;
  const scalePx = Math.max(4, (params.scale ?? 24) * scale);
  const time = Math.max(0, params.time ?? 0);
  const depth = clamp01(params.depth ?? 0.5);
  const sharpness = clamp01(params.sharpness ?? 0.5);
  const brightness = Math.max(0, params.brightness ?? 1);
  const contrast = Math.max(0, params.contrast ?? 1);
  const dispersion = clamp01(params.dispersion ?? 0);
  const distortion = clamp01(params.distortionAmount ?? 1);
  const refraction = clamp01(params.refractionAmount ?? 0.5);
  const output = params.output ?? 'combined';
  const lightAngle = ((params.lightAngle ?? 60) * Math.PI) / 180;
  const waves = buildCausticWaves(params, scalePx);

  // Deterministic per-call field evaluation at quality resolution.
  const fieldW = Math.max(8, Math.floor(w * (quality === 'interactive' ? 0.5 : 1)));
  const fieldH = Math.max(8, Math.floor(h * (quality === 'interactive' ? 0.5 : 1)));
  const stepX = w / fieldW;
  const stepY = h / fieldH;
  const fx = new Float32Array(fieldW * fieldH);
  const fy = new Float32Array(fieldW * fieldH);
  const lap = new Float32Array(fieldW * fieldH);

  for (let gy = 0; gy < fieldH; gy += 1) {
    for (let gx = 0; gx < fieldW; gx += 1) {
      const px = (gx + 0.5) * stepX;
      const py = (gy + 0.5) * stepY;
      let hx = 0;
      let hy = 0;
      let hlap = 0;
      for (const wave of waves) {
        const arg = wave.kx * px + wave.ky * py + wave.phase + wave.speed * time * Math.PI * 2;
        const s = Math.sin(arg);
        const c = Math.cos(arg);
        const k2 = wave.kx * wave.kx + wave.ky * wave.ky;
        hx += wave.amp * wave.kx * c;
        hy += wave.amp * wave.ky * c;
        hlap += -wave.amp * k2 * s;
      }
      const gi = gy * fieldW + gx;
      fx[gi] = hx * depth;
      fy[gi] = hy * depth;
      lap[gi] = hlap * depth;
    }
  }

  // Complexity: mix a fine secondary field (deterministic) into the laplacian.
  if ((params.complexity ?? 0) > 0) {
    const c = clamp01(params.complexity ?? 0);
    for (let gi = 0; gi < fieldW * fieldH; gi += 1) {
      const gx = gi % fieldW;
      const gy = Math.floor(gi / fieldW);
      const n = seeded01(Math.round(lap[gi]! * 4096) ^ (params.seed + gy * 31 + gx * 7));
      lap[gi] = lap[gi]! * (1 - c) + (n - 0.5) * 0.05 * c;
    }
  }

  // Composite at full res (bilinear sample of the field derivatives).
  const lightDirX = Math.cos(lightAngle);
  const lightDirY = Math.sin(lightAngle);
  const focusScale = (0.3 + sharpness * 1.2) * 0.06 * scalePx;
  const wt = params.waterTint ? params.waterTint : null;
  const st = params.surfaceTint ? params.surfaceTint : null;

  for (let y = 0; y < h; y += 1) {
    const gy = Math.min(fieldH - 1, Math.max(0, y / stepY - 0.5));
    const gy0 = Math.floor(gy);
    const gy1 = Math.min(fieldH - 1, gy0 + 1);
    const fyy = gy - gy0;
    for (let x = 0; x < w; x += 1) {
      const gx = Math.min(fieldW - 1, Math.max(0, x / stepX - 0.5));
      const gx0 = Math.floor(gx);
      const gx1 = Math.min(fieldW - 1, gx0 + 1);
      const fxx = gx - gx0;
      const i00 = gy0 * fieldW + gx0;
      const i10 = gy0 * fieldW + gx1;
      const i01 = gy1 * fieldW + gx0;
      const i11 = gy1 * fieldW + gx1;
      const gx_ =
        fx[i00]! +
        (fx[i10]! - fx[i00]!) * fxx +
        (fx[i01]! - fx[i00]!) * fyy +
        (fx[i00]! - fx[i10]! - fx[i01]! + fx[i11]!) * fxx * fyy;
      const gy_ =
        fy[i00]! +
        (fy[i10]! - fy[i00]!) * fxx +
        (fy[i01]! - fy[i00]!) * fyy +
        (fy[i00]! - fy[i10]! - fy[i01]! + fy[i11]!) * fxx * fyy;
      const lap_ =
        lap[i00]! +
        (lap[i10]! - lap[i00]!) * fxx +
        (lap[i01]! - lap[i00]!) * fyy +
        (lap[i00]! - lap[i10]! - lap[i01]! + lap[i11]!) * fxx * fyy;

      const o = (y * w + x) * 4;
      const a = data[o + 3]!;

      // Refraction displacement (analytic gradient), per-channel dispersion.
      const disp = 1 + dispersion * 0.6;
      const offR = gx_ * refraction * distortion * scalePx * 0.09 * disp;
      const offG = gx_ * refraction * distortion * scalePx * 0.09;
      const offB = gx_ * refraction * distortion * scalePx * 0.09 * (2 - disp);
      const offRY = gy_ * refraction * distortion * scalePx * 0.09 * disp;
      const offGY = gy_ * refraction * distortion * scalePx * 0.09;
      const offBY = gy_ * refraction * distortion * scalePx * 0.09 * (2 - disp);

      let r: number;
      let g: number;
      let b: number;
      if (output === 'lighting') {
        r = data[o]!;
        g = data[o + 1]!;
        b = data[o + 2]!;
      } else {
        r = sampleBilinear(data, w, h, x + offR, y + offRY, 0);
        g = sampleBilinear(data, w, h, x + offG, y + offGY, 1);
        b = sampleBilinear(data, w, h, x + offB, y + offBY, 2);
      }

      // Caustic lighting.
      const c = clamp01(0.45 + lap_ * focusScale * brightness);
      const shade = 0.5 + 0.5 * clampRange(lightDirX * gx_ + lightDirY * gy_, -1, 1);
      const light = clamp01((c - 0.5) * contrast + 0.5);

      if (output === 'refraction') {
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
      } else {
        const bright = 0.55 + light * 0.9 * shade;
        let nr = r * bright;
        let ng = g * bright;
        let nb = b * bright;
        if (wt) {
          const m = clamp01(light) * 0.5;
          nr = nr * (1 - m) + wt[0] * light * 255 * m;
          ng = ng * (1 - m) + wt[1] * light * 255 * m;
          nb = nb * (1 - m) + wt[2] * light * 255 * m;
        }
        if (st) {
          nr = nr * (1 - 0.35) + nr * (st[0] / 255) * 0.35;
          ng = ng * (1 - 0.35) + ng * (st[1] / 255) * 0.35;
          nb = nb * (1 - 0.35) + nb * (st[2] / 255) * 0.35;
        }
        data[o] = clampByte(nr);
        data[o + 1] = clampByte(ng);
        data[o + 2] = clampByte(nb);
      }
      data[o + 3] = a;
    }
  }
  return imageData;
}

function sampleBilinear(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  c: number,
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const x1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const y1 = Math.min(h - 1, Math.max(0, y0 + 1));
  const c0 = Math.max(0, Math.min(w - 1, x0));
  const r0 = Math.max(0, Math.min(h - 1, y0));
  const a = src[(r0 * w + c0) * 4 + c]!;
  const b = src[(r0 * w + x1) * 4 + c]!;
  const d = src[(y1 * w + c0) * 4 + c]!;
  const e = src[(y1 * w + x1) * 4 + c]!;
  return a + (b - a) * fx + (d - a) * fy + (a - b - d + e) * fx * fy;
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
