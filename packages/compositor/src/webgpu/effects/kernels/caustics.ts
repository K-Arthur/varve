/**
 * GPU kernel: caustics — port of `packages/engine/src/liveEffects/caustics.ts`.
 *
 * Two passes:
 *   causticsField — evaluate the wave field (derivatives + laplacian) per
 *                   pixel into a full-res 'field' texture (fx, fy, lap, 0).
 *                   The CPU evaluates the field on a quality grid and
 *                   bilinear-samples it; the GPU evaluates it at full res
 *                   (visual equivalence, no size mismatch for the runner).
 *   causticsComposite — refraction sampling with per-channel dispersion +
 *                   caustic lighting + water/surface tints → 'out'.
 *
 * Param packing (f32):
 *   [0] scale(px) [1] depth [2] waveCount [3] complexity [4] refractionAmount
 *   [5] sharpness [6] lightAngle(deg) [7] brightness [8] contrast
 *   [9] dispersion [10] distortionAmount [11] output (0=combined,1=lighting,2=refraction)
 *   [12] waterTint mix(0/1) [13] wtR [14] wtG [15] wtB (0..1)
 *   [16] surfaceTint mix [17] stR [18] stG [19] stB
 *   [20] seed [21] time [22] animationSpeed [23] tileable(0/1)
 *   [24] coordSpace scale
 */
import type { GpuKernelSpec } from '../runner';
import { pack, resolveQuality } from '../runner';
import { WGSL_HELPERS } from './shared';

export const CAUSTICS_KERNEL: GpuKernelSpec = {
  id: 'caustics',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn causticsField(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let scalePx = max(4.0, p[0]);
  let depth = clamp01(p[1]);
  let count = max(2, min(8, i32(round(p[2]))));
  let complexity = clamp01(p[3]);
  let seed = u32(p[20]);
  let time = max(0.0, p[21]);
  let animSpeed = p[22];
  let tileable = p[23] > 0.5;
  let period = scalePx * 4.0;

  let px = f32(x) + 0.5;
  let py = f32(y) + 0.5;

  var hx: f32 = 0.0;
  var hy: f32 = 0.0;
  var hlap: f32 = 0.0;
  for (var i: i32 = 0; i < count; i = i + 1) {
    var kx: f32;
    var ky: f32;
    if (tileable) {
      let nx = max(1.0, round(seeded01(seed + u32(i * 101 + 1)) * 3.0));
      let my = max(1.0, round(seeded01(seed + u32(i * 101 + 2)) * 3.0));
      kx = (nx * 2.0 * 3.141592653589793) / period;
      ky = (my * 2.0 * 3.141592653589793) / period;
      if ((i & 1) == 0) { kx = -kx; }
      if ((i & 2) == 0) { ky = -ky; }
    } else {
      let angle = seeded01(seed + u32(i * 101)) * 3.141592653589793 * 2.0;
      kx = cos(angle) * (2.0 * 3.141592653589793) / period;
      ky = sin(angle) * (2.0 * 3.141592653589793) / period;
    }
    let amp = 1.0 / f32(i + 1);
    let phase = seeded01(seed + u32(i * 173)) * 3.141592653589793 * 2.0;
    let speed = 0.5 + seeded01(seed + u32(i * 233)) * 0.5;
    let arg = kx * px + ky * py + phase + speed * time * 3.141592653589793 * 2.0 * animSpeed;
    let s = sin(arg);
    let c = cos(arg);
    let k2 = kx * kx + ky * ky;
    hx += amp * kx * c;
    hy += amp * ky * c;
    hlap += -amp * k2 * s;
  }
  hx *= depth;
  hy *= depth;
  hlap *= depth;

  // Complexity: mix a fine secondary field into the laplacian.
  if (complexity > 0.0) {
    let n = seeded01(u32(round(hlap * 4096.0)) ^ (seed + u32(y * 31 + x * 7)));
    hlap = hlap * (1.0 - complexity) + (n - 0.5) * 0.05 * complexity;
  }

  textureStore(dst, vec2i(x, y), vec4f(hx, hy, hlap, 0.0) / 1.0);
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var field: texture_2d<f32>;
@group(2) @binding(2) var src2: texture_2d<f32>;
@group(2) @binding(3) var samp: sampler;

fn fieldBilinear(tex: texture_2d<f32>, fx: f32, fy: f32, w: i32, h: i32) -> vec4f {
  let gx = min(f32(w - 1), max(0.0, fx));
  let gy = min(f32(h - 1), max(0.0, fy));
  let x0 = i32(floor(gx));
  let y0 = i32(floor(gy));
  let x1 = min(w - 1, x0 + 1);
  let y1 = min(h - 1, y0 + 1);
  let fxx = gx - f32(x0);
  let fyy = gy - f32(y0);
  let a = textureLoad(tex, vec2i(x0, y0), 0);
  let b = textureLoad(tex, vec2i(x1, y0), 0);
  let c = textureLoad(tex, vec2i(x0, y1), 0);
  let d = textureLoad(tex, vec2i(x1, y1), 0);
  return a + (b - a) * fxx + (c - a) * fyy + (a - b - c + d) * fxx * fyy;
}

@compute @workgroup_size(8, 8, 1)
fn causticsComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let scalePx = max(4.0, p[0]);
  let refraction = clamp01(p[4]);
  let distortion = clamp01(p[10]);
  let sharpness = clamp01(p[5]);
  let brightness = max(0.0, p[7]);
  let contrast = max(0.0, p[8]);
  let dispersion = clamp01(p[9]);
  let output = i32(p[11]);
  let lightAngle = p[6] * 3.141592653589793 / 180.0;

  let f = fieldBilinear(field, f32(x) - 0.5, f32(y) - 0.5, w, h);
  let gx_ = f.x;
  let gy_ = f.y;
  let lap_ = f.z;

  let srcv = textureLoad(src2, vec2i(x, y), 0);

  let disp = 1.0 + dispersion * 0.6;
  let base = refraction * distortion * scalePx * 0.09;
  let offR = gx_ * base * disp;
  let offG = gx_ * base;
  let offB = gx_ * base * (2.0 - disp);
  let offRY = gy_ * base * disp;
  let offGY = gy_ * base;
  let offBY = gy_ * base * (2.0 - disp);

  var r: f32;
  var g: f32;
  var b: f32;
  if (output == 1) {
    r = srcv.r * 255.0;
    g = srcv.g * 255.0;
    b = srcv.b * 255.0;
  } else {
    r = sampleBilinearClamped(src2, samp, f32(x) + offR, f32(y) + offRY, w, h).r * 255.0;
    g = sampleBilinearClamped(src2, samp, f32(x) + offG, f32(y) + offGY, w, h).g * 255.0;
    b = sampleBilinearClamped(src2, samp, f32(x) + offB, f32(y) + offBY, w, h).b * 255.0;
  }

  let focusScale = (0.3 + sharpness * 1.2) * 0.06 * scalePx;
  let c = clamp01(0.45 + lap_ * focusScale * brightness);
  let lightDirX = cos(lightAngle);
  let lightDirY = sin(lightAngle);
  let shade = 0.5 + 0.5 * clamp(lightDirX * gx_ + lightDirY * gy_, -1.0, 1.0);
  let light = clamp01((c - 0.5) * contrast + 0.5);

  if (output == 2) {
    textureStore(dst, vec2i(x, y), vec4f(r, g, b, srcv.a * 255.0) / 255.0);
    return;
  }

  let bright = 0.55 + light * 0.9 * shade;
  var nr = r * bright;
  var ng = g * bright;
  var nb = b * bright;
  if (p[12] > 0.5) {
    let m = clamp01(light) * 0.5;
    nr = nr * (1.0 - m) + p[13] * 255.0 * light * m;
    ng = ng * (1.0 - m) + p[14] * 255.0 * light * m;
    nb = nb * (1.0 - m) + p[15] * 255.0 * light * m;
  }
  if (p[16] > 0.5) {
    nr = nr * 0.65 + nr * p[17] * 0.35;
    ng = ng * 0.65 + ng * p[18] * 0.35;
    nb = nb * 0.65 + nb * p[19] * 0.35;
  }
  textureStore(dst, vec2i(x, y), vec4f(clampByte(nr), clampByte(ng), clampByte(nb), srcv.a * 255.0) / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    void resolveQuality;
    const scale = request.coordSpace && request.coordSpace.scale > 0 ? request.coordSpace.scale : 1;
    const params = new Float32Array(25);
    let o = pack.f(params, 0, Math.max(4, (q.scale ?? 24) * scale), 24);
    o = pack.f(params, o, q.depth, 0.5);
    o = pack.f(params, o, q.waveCount, 4);
    o = pack.f(params, o, q.complexity, 0);
    o = pack.f(params, o, q.refractionAmount, 0.5);
    o = pack.f(params, o, q.sharpness, 0.5);
    o = pack.f(params, o, q.lightAngle, 60);
    o = pack.f(params, o, q.brightness, 1);
    o = pack.f(params, o, q.contrast, 1);
    o = pack.f(params, o, q.dispersion, 0);
    o = pack.f(params, o, q.distortionAmount, 1);
    const outputCode = q.output === 'lighting' ? 1 : q.output === 'refraction' ? 2 : 0;
    o = pack.f(params, o, outputCode, 0);
    const wt = Array.isArray(q.waterTint) ? (q.waterTint as number[]) : null;
    o = pack.f(params, o, wt ? 1 : 0, 0);
    if (wt) {
      o = pack.f(params, o, (wt[0] ?? 0) / 255, 0);
      o = pack.f(params, o, (wt[1] ?? 0) / 255, 0);
      o = pack.f(params, o, (wt[2] ?? 0) / 255, 0);
    } else {
      o = pack.f(params, o, 0, 0);
      o = pack.f(params, o, 0, 0);
      o = pack.f(params, o, 0, 0);
    }
    const st = Array.isArray(q.surfaceTint) ? (q.surfaceTint as number[]) : null;
    o = pack.f(params, o, st ? 1 : 0, 0);
    if (st) {
      o = pack.f(params, o, (st[0] ?? 255) / 255, 1);
      o = pack.f(params, o, (st[1] ?? 255) / 255, 1);
      o = pack.f(params, o, (st[2] ?? 255) / 255, 1);
    } else {
      o = pack.f(params, o, 1, 1);
      o = pack.f(params, o, 1, 1);
      o = pack.f(params, o, 1, 1);
    }
    o = pack.f(params, o, q.seed, 0);
    o = pack.f(params, o, q.time, 0);
    o = pack.f(params, o, q.animationSpeed, 0.5);
    pack.f(params, o, q.tileable === true ? 1 : 0, 0);
    return [
      {
        entry: 'causticsField',
        params,
        textures: ['field', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
      {
        entry: 'causticsComposite',
        params,
        textures: ['out', 'field', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
