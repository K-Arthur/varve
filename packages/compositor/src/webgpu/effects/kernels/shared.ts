/**
 * Shared WGSL helpers for the live-effects compute kernels.
 *
 * These mirror the TS helpers in `packages/engine/src/liveEffects/prng.ts`
 * (f64 there, f32 here — the GPU agreement harness tolerates the ULP-level
 * difference). Integer hashing uses u32 wrapping arithmetic identical to the
 * JS `Math.imul` bit patterns; per-pixel output is deterministic.
 *
 * Kernels concatenate `WGSL_HELPERS` before their own code and use the
 * helpers below.
 */

export const WGSL_HELPERS = /* wgsl */ `
// ── deterministic hashing (u32 wrapping == JS Math.imul patterns) ──────────

fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn seeded01(seed: u32) -> f32 {
  var h: u32 = seed;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = (h ^ (h >> 16u)) * 0x45d9f3bu;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn smoothCurve(t: f32) -> f32 {
  return t * t * (3.0 - 2.0 * t);
}

fn valueNoise2(x: f32, y: f32, seed: u32) -> f32 {
  let x0 = floor(x);
  let y0 = floor(y);
  let fx = smoothCurve(x - x0);
  let fy = smoothCurve(y - y0);
  let a = hash2(i32(x0), i32(y0), seed);
  let b = hash2(i32(x0) + 1, i32(y0), seed);
  let c = hash2(i32(x0), i32(y0) + 1, seed);
  let d = hash2(i32(x0) + 1, i32(y0) + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

fn fbm2(x: f32, y: f32, seed: u32, octaves: i32) -> f32 {
  var sum: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: f32 = 1.0;
  var total: f32 = 0.0;
  for (var i: i32 = 0; i < octaves; i = i + 1) {
    sum = sum + valueNoise2(x * freq, y * freq, seed + u32(i * 1013)) * amp;
    total = total + amp;
    amp = amp * 0.5;
    freq = freq * 2.0;
  }
  if (total > 0.0) { return sum / total; }
  return 0.0;
}

// ── sRGB transfer (matches prng.ts srgbToLinear01 / linearToSrgb01) ─────────

fn srgbToLinear01(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn srgbByteToLinear01(b: f32) -> f32 {
  return srgbToLinear01(b / 255.0);
}

fn linearToSrgb01(linear: f32) -> f32 {
  let v = clamp(linear, 0.0, 1.0);
  if (v <= 0.0031308) { return v * 12.92; }
  return 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}

fn clamp01(v: f32) -> f32 {
  return clamp(v, 0.0, 1.0);
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}

// ── sampling ────────────────────────────────────────────────────────────────

// Bilinear sample at continuous pixel coords (clamped), matching the CPU
// kernels' clamp-then-bilinear convention. Values come back in 0..1.
fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

// ── HSL → RGB (matches lightLeak.ts / vhs hue helpers) ──────────────────────

fn hue2rgb(p: f32, q: f32, t: f32) -> f32 {
  var tt: f32 = t;
  if (tt < 0.0) { tt = tt + 1.0; }
  if (tt > 1.0) { tt = tt - 1.0; }
  if (tt < 1.0 / 6.0) { return p + (q - p) * 6.0 * tt; }
  if (tt < 1.0 / 2.0) { return q; }
  if (tt < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - tt) * 6.0; }
  return p;
}

fn hslToRgb01(h: f32, s: f32, l: f32) -> vec3f {
  let hue = ((h % 360.0) + 360.0) % 360.0 / 360.0;
  if (s <= 0.0) { return vec3f(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(hue2rgb(p, q, hue + 1.0 / 3.0), hue2rgb(p, q, hue), hue2rgb(p, q, hue - 1.0 / 3.0));
}
`;
