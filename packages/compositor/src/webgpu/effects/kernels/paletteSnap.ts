/**
 * GPU kernel: palette snap — port of
 * `packages/engine/src/liveEffects/paletteSnap.ts`.
 *
 * Single pass: nearest-palette lookup (metrics: rgb, linear-rgb, lab,
 * oklab) + amount mix + optional Bayer dither + alphaCutoff.
 *
 * Param packing (f32):
 *   [0]  amount      [1]  alphaCutoff      [2]  seed
 *   [3]  metric code (rgb=0, linear-rgb=1, lab=2, oklab=3)
 *   [4]  dither (0/1)  [5]  ditherStrength  [6]  dither bayer (0/1)
 *   [7]  palette size (count of colors in the palette buffer)
 *
 * Palette buffer (group 1): RGB triplets in 0..1.
 *
 * Sequential error-diffusion dither is CPU-only: buildPasses throws and the
 * dispatch chain falls back to the CPU provider.
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

const METRIC_RGB = 0;
const METRIC_LINEAR = 1;
const METRIC_LAB = 2;
const METRIC_OKLAB = 3;

export const PALETTE_SNAP_KERNEL: GpuKernelSpec = {
  id: 'paletteSnap',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(1) @binding(0) var<storage, read_write> pal: array<f32, 384>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

fn srgbToLinear01c(v: f32) -> f32 {
  if (v <= 0.04045) { return v / 12.92; }
  return pow((v + 0.055) / 1.055, 2.4);
}

fn linearSrgbToOklabc(rgb: vec3f) -> vec3f {
  let m1 = mat3x3f(
    vec3f(0.4122214708, 0.2119034982, 0.0883024619),
    vec3f(0.5363325363, 0.6806995451, 0.2817188376),
    vec3f(0.0514459929, 0.1073969566, 0.6299787005),
  );
  let m2 = mat3x3f(
    vec3f(0.2104542553, 1.9779984951, 0.0259040371),
    vec3f(0.793617785, -2.428592205, 0.7827717662),
    vec3f(-0.0040720468, 0.4505937099, -0.808675766),
  );
  let lms = m1 * rgb;
  let lms3 = vec3f(pow(lms.x, 1.0 / 3.0), pow(lms.y, 1.0 / 3.0), pow(lms.z, 1.0 / 3.0));
  return m2 * lms3;
}

fn toLabc(rgb: vec3f, metric: i32) -> vec3f {
  if (metric == 3) {
    return linearSrgbToOklabc(vec3f(srgbToLinear01c(rgb.x), srgbToLinear01c(rgb.y), srgbToLinear01c(rgb.z)));
  }
  // Lab via XYZ D65 (matches the CPU paletteCore path).
  let rl = srgbToLinear01c(rgb.x);
  let gl = srgbToLinear01c(rgb.y);
  let bl = srgbToLinear01c(rgb.z);
  let x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  let z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  let fx = select(7.787 * x + 16.0 / 116.0, pow(x, 1.0 / 3.0), x > 0.008856);
  let fy = select(7.787 * y + 16.0 / 116.0, pow(y, 1.0 / 3.0), y > 0.008856);
  let fz = select(7.787 * z + 16.0 / 116.0, pow(z, 1.0 / 3.0), z > 0.008856);
  return vec3f(116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz));
}

fn distMetric(a: vec3f, b: vec3f, metric: i32) -> f32 {
  if (metric == 0) {
    let d = a - b;
    return dot(d, d);
  }
  if (metric == 1) {
    let la = vec3f(srgbToLinear01c(a.x), srgbToLinear01c(a.y), srgbToLinear01c(a.z));
    let lb = vec3f(srgbToLinear01c(b.x), srgbToLinear01c(b.y), srgbToLinear01c(b.z));
    let d = la - lb;
    return dot(d, d);
  }
  let d = toLabc(a, metric) - toLabc(b, metric);
  return dot(d, d);
}

@compute @workgroup_size(8, 8, 1)
fn paletteSnapMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let amount = p[0];
  let alphaCutoff = p[1];
  let metric = i32(p[3]);
  let dither = p[4] > 0.5;
  let ditherStrength = p[5];
  let seed = u32(p[2]);
  let paletteSize = i32(p[7]);

  let s = textureLoad(src, vec2i(x, y), 0);
  let a = s.a * 255.0;
  if (a / 255.0 < alphaCutoff || a <= 0.0) {
    textureStore(dst, vec2i(x, y), s);
    return;
  }

  let srgb = vec3f(s.r * 255.0, s.g * 255.0, s.b * 255.0);
  var best = vec3f(srgb);
  var bestD = 1e30;
  for (var i: i32 = 0; i < paletteSize; i = i + 1) {
    let pc = vec3f(pal[i * 3] * 255.0, pal[i * 3 + 1] * 255.0, pal[i * 3 + 2] * 255.0);
    let d = distMetric(srgb, pc, metric);
    if (d < bestD) {
      bestD = d;
      best = pc;
    }
  }

  var outR: f32 = s.r * 255.0;
  var outG: f32 = s.g * 255.0;
  var outB: f32 = s.b * 255.0;
  if (amount >= 1.0) {
    outR = best.x;
    outG = best.y;
    outB = best.z;
  } else {
    outR = outR + (best.x - outR) * amount;
    outG = outG + (best.y - outG) * amount;
    outB = outB + (best.z - outB) * amount;
  }

  // Bayer 4x4 dither on the quantization error (the CPU paletteSnap dither
  // path uses applyDither's bayer mode when requested).
  if (dither && ditherStrength > 0.0) {
    let bayer = mat4x4f(
      vec4f(0.0, 8.0, 2.0, 10.0),
      vec4f(12.0, 4.0, 14.0, 6.0),
      vec4f(3.0, 11.0, 1.0, 9.0),
      vec4f(15.0, 7.0, 13.0, 5.0),
    );
    let bx = x & 3;
    let by = y & 3;
    let th = (bayer[by][bx] + 0.5) / 16.0;
    let err = (best - vec3f(s.r * 255.0, s.g * 255.0, s.b * 255.0)) * ditherStrength;
    if (err.x > 0.0 && (err.x / 255.0) > th) { outR = min(255.0, outR + 255.0); }
    if (err.y > 0.0 && (err.y / 255.0) > th) { outG = min(255.0, outG + 255.0); }
    if (err.z > 0.0 && (err.z / 255.0) > th) { outB = min(255.0, outB + 255.0); }
  }

  textureStore(
    dst,
    vec2i(x, y),
    vec4f(clamp(outR, 0.0, 255.0), clamp(outG, 0.0, 255.0), clamp(outB, 0.0, 255.0), a) / 255.0,
  );
}
`,
  buildPasses(request) {
    const q = request.params;
    const colors = Array.isArray(q.colors) ? (q.colors as number[][]) : [];
    if (q.dither === true && q.ditherAlgorithm && q.ditherAlgorithm !== 'bayer') {
      throw new Error('sequential dither not supported on GPU');
    }
    const params = new Float32Array(8);
    let o = pack.f(params, 0, q.amount, 1);
    o = pack.f(params, o, q.alphaCutoff, 0);
    o = pack.f(params, o, q.seed, 0);
    const metricCode =
      q.metric === 'linear-rgb'
        ? METRIC_LINEAR
        : q.metric === 'lab'
          ? METRIC_LAB
          : q.metric === 'oklab'
            ? METRIC_OKLAB
            : METRIC_RGB;
    o = pack.f(params, o, metricCode, METRIC_RGB);
    o = pack.b(params, o, q.dither, false);
    o = pack.f(params, o, q.ditherStrength, 0.5);
    o = pack.f(params, o, q.ditherAlgorithm === 'bayer' ? 1 : 0, 0);
    pack.f(params, o, colors.length, 0);
    return [
      {
        entry: 'paletteSnapMain',
        params,
        palette: pack.palette(colors, 128),
        textures: ['out', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
