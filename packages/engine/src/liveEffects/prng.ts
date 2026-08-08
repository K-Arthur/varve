/**
 * Deterministic seeded pseudo-random helpers for procedural effects.
 *
 * Never uses Math.random() — every value derives from integer seeds so the
 * same (seed, time, frame) triple produces byte-identical output. All
 * functions are pure; no module-level mutable state.
 */

/** Mulberry32 PRNG — fast, deterministic, good-enough distribution. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of (x, y, seed) → [0, 1). Deterministic across platforms. */
export function hash2(x: number, y: number, seed: number): number {
  let h = (seed >>> 0) ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Integer hash of (x, y, z, seed) → [0, 1). */
export function hash3(x: number, y: number, z: number, seed: number): number {
  let h =
    (seed >>> 0) ^
    Math.imul(x | 0, 0x27d4eb2d) ^
    Math.imul(y | 0, 0x165667b1) ^
    Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise at continuous coords → [0, 1). Grid-anchored, deterministic. */
export function valueNoise2(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal Brownian motion (octave-summed value noise) → [0, 1]. */
export function fbm2(x: number, y: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let total = 0;
  const o = Math.max(1, Math.min(8, Math.round(octaves)));
  for (let i = 0; i < o; i += 1) {
    sum += valueNoise2(x * freq, y * freq, seed + i * 1013) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total > 0 ? sum / total : 0;
}

/** Deterministic [0,1) value from a 1D seed without allocating a PRNG. */
export function seeded01(seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Deterministic integer in [0, max) from a seed. */
export function seededInt(seed: number, max: number): number {
  return Math.floor(seeded01(seed) * max);
}

/** sRGB encoded byte → linear-light [0, 1] (piecewise sRGB transfer). */
export function srgbToLinear01(byte: number): number {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Linear-light [0, 1] → sRGB encoded byte (clamped). */
export function linearToSrgb01(linear: number): number {
  const v = Math.max(0, Math.min(1, linear));
  const srgb = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}
