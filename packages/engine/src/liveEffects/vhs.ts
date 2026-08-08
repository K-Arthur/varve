/**
 * VHS / analog tape artifact kernel.
 *
 * Every artifact derives from a deterministic field hash keyed on
 * (seed, frame, artifact channel) — never Math.random(). The same
 * (seed, time, frameRate, params) triple always reproduces the same frame,
 * and `time` is deliberately separate from `seed` so animation can advance
 * without changing the pattern identity.
 *
 * Artifacts: luma noise, chroma noise, chroma bleed, per-line horizontal
 * jitter, tracking roll band, dropout lines, head-switching offset, tearing
 * slices, signal blur, and slow time instability.
 */

import { hash3, mulberry32, seeded01 } from './prng';
import type { EffectQuality } from './quality';

export interface VhsParams {
  /** 0..1 luma noise depth. */
  lumaNoise: number;
  /** 0..1 chroma noise depth. */
  chromaNoise: number;
  /** 0..1 chroma bleed (horizontal smear of the colour channels). */
  chromaBleed: number;
  /** 0..1 horizontal jitter amplitude. */
  jitter: number;
  /** 0..1 tracking-error band presence. */
  tracking: number;
  /** 0..1 dropout line density. */
  dropouts: number;
  /** 0..1 head-switching distortion (bottom band). */
  headSwitching: number;
  /** 0..1 horizontal tearing slices. */
  tearing: number;
  /** 0..1 signal blur (small box blur). */
  signalBlur: number;
  /** 0..1 slow time instability drift. */
  timeInstability: number;
  /** Deterministic seed. */
  seed: number;
  /** Time in seconds (animatable). */
  time: number;
  /** Frame rate for frame-locked noise (fps). */
  frameRate: number;
  /** Serialized quality tier. */
  quality: 'auto' | EffectQuality;
}

/** Apply VHS artifacts in place. Returns the same ImageData. */
export function applyVhs(
  imageData: ImageData,
  params: VhsParams,
  options: { quality?: EffectQuality } = {},
): ImageData {
  const { data, width: w, height: h } = imageData;
  if (w === 0 || h === 0) return imageData;

  const seed = Math.round(params.seed ?? 0) >>> 0;
  const frameRate = Math.max(1, params.frameRate ?? 24);
  const time = Math.max(0, params.time ?? 0);
  const frame = Math.floor(time * frameRate);
  const field = hash3(seed, frame, 0, seed);

  const lumaNoise = clamp01(params.lumaNoise ?? 0);
  const chromaNoise = clamp01(params.chromaNoise ?? 0);
  const bleed = clamp01(params.chromaBleed ?? 0);
  const jitter = clamp01(params.jitter ?? 0);
  const tracking = clamp01(params.tracking ?? 0);
  const dropouts = clamp01(params.dropouts ?? 0);
  const headSwitch = clamp01(params.headSwitching ?? 0);
  const tearing = clamp01(params.tearing ?? 0);
  const signalBlur = clamp01(params.signalBlur ?? 0);
  const instability = clamp01(params.timeInstability ?? 0);
  const quality: EffectQuality =
    params.quality && params.quality !== 'auto' ? params.quality : (options.quality ?? 'normal');

  const src = new Uint8ClampedArray(data);

  // Per-frame deterministic channels.
  const jitterPhase = seeded01(Math.round(field * 2 ** 31) ^ 0x5f3759df);
  const trackingY = Math.floor(seeded01(Math.round(field * 2 ** 31) ^ 0x9e3779b9) * h);
  const dropCount = Math.round(dropouts * 12);
  const tearCount = Math.max(1, Math.round(tearing * 24));
  const driftX = (jitterPhase - 0.5) * 2 * instability * 24;

  // Precompute per-line jitter.
  const lineJitter = new Float32Array(h);
  for (let y = 0; y < h; y += 1) {
    lineJitter[y] = (hash3(field, y, 1, seed) - 0.5) * 2 * jitter * 16;
  }

  // Tear slices: hash boundaries, each slice shifted.
  const tearOffsets = new Int32Array(h);
  if (tearing > 0) {
    const sliceH = Math.max(4, Math.floor(h / tearCount));
    for (let s = 0; s < tearCount; s += 1) {
      const y0 = s * sliceH;
      const offset = Math.round((hash3(field, s, 2, seed) - 0.5) * 2 * tearing * 48);
      for (let y = y0; y < Math.min(h, y0 + sliceH); y += 1) {
        tearOffsets[y] = offset;
      }
    }
  }

  // Dropout lines.
  const dropoutRows = new Set<number>();
  for (let i = 0; i < dropCount; i += 1) {
    const y = Math.floor(hash3(field, i, 3, seed) * h);
    dropoutRows.add(y);
    dropoutRows.add(Math.min(h - 1, y + 1));
  }

  const rng = mulberry32(Math.round(field * 2 ** 31));

  for (let y = 0; y < h; y += 1) {
    const isDropout = dropoutRows.has(y);
    const headOffset =
      y > h * 0.92 ? Math.round((hash3(field, 9, 4, seed) - 0.5) * 2 * headSwitch * 40) : 0;
    const trackOffset =
      tracking > 0 && Math.abs(y - trackingY) < Math.max(2, h * 0.03)
        ? Math.round((hash3(field, y, 5, seed) - 0.5) * 2 * tracking * 24)
        : 0;
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const a = src[o + 3]!;
      const shift = Math.round(lineJitter[y]! + tearOffsets[y]! + headOffset + trackOffset);
      const sx = x + shift;
      const sxWrapped = ((sx % w) + w) % w;
      const so = (y * w + sxWrapped) * 4;
      let r = src[so]!;
      let g = src[so + 1]!;
      let b = src[so + 2]!;

      // Time instability: global slow drift of the sampled position.
      if (instability > 0 && driftX !== 0) {
        const dx = Math.round(driftX);
        const sxo = (((x + dx) % w) + w) % w;
        const so2 = (y * w + sxo) * 4;
        r = r * 0.5 + src[so2]! * 0.5;
        g = g * 0.5 + src[so2 + 1]! * 0.5;
        b = b * 0.5 + src[so2 + 2]! * 0.5;
      }

      // Luma noise.
      if (lumaNoise > 0) {
        const n = (rng() - 0.5) * 2 * lumaNoise * 42;
        r += n;
        g += n;
        b += n;
      }
      // Chroma noise (opposed red/blue).
      if (chromaNoise > 0) {
        const n = (rng() - 0.5) * 2 * chromaNoise * 34;
        r += n;
        b -= n;
      }

      // Dropout: white burst line.
      if (isDropout) {
        const d = 0.55 + rng() * 0.3;
        r = r * 0.3 + 255 * d * 0.7;
        g = g * 0.3 + 255 * d * 0.7;
        b = b * 0.3 + 255 * d * 0.7;
      }

      data[o] = clampByte(r);
      data[o + 1] = clampByte(g);
      data[o + 2] = clampByte(b);
      data[o + 3] = a;
    }
  }

  // Chroma bleed: horizontal smear of the colour channels, luma untouched.
  if (bleed > 0) {
    const radius = Math.max(1, Math.round(bleed * 12 * (quality === 'interactive' ? 0.5 : 1)));
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        let r = 0;
        let b = 0;
        let n = 0;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const no = (y * w + nx) * 4;
          r += data[no]!;
          b += data[no + 2]!;
          n += 1;
        }
        if (n > 0) {
          const mix = bleed * 0.85;
          data[o] = clampByte(data[o]! + (r / n - data[o]!) * mix);
          data[o + 2] = clampByte(data[o + 2]! + (b / n - data[o + 2]!) * mix);
        }
      }
    }
  }

  // Signal blur: cheap 3x3 box blur blend.
  if (signalBlur > 0) {
    const blurred = new Uint8ClampedArray(data);
    boxBlur3(blurred, w, h, 1);
    const m = signalBlur * 0.6;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = clampByte(data[i]! + (blurred[i]! - data[i]!) * m);
      data[i + 1] = clampByte(data[i + 1]! + (blurred[i + 1]! - data[i + 1]!) * m);
      data[i + 2] = clampByte(data[i + 2]! + (blurred[i + 2]! - data[i + 2]!) * m);
    }
  }

  return imageData;
}

function boxBlur3(data: Uint8ClampedArray, w: number, h: number, radius: number): void {
  const tmp = new Float32Array(w * h * 4);
  for (let c = 0; c < 4; c += 1) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy += 1) {
          for (let dx = -radius; dx <= radius; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            sum += data[(ny * w + nx) * 4 + c]!;
            n += 1;
          }
        }
        tmp[(y * w + x) * 4 + c] = sum / n;
      }
    }
  }
  for (let i = 0; i < data.length; i += 1) data[i] = Math.round(tmp[i]!);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
