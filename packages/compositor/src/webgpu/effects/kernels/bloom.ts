/**
 * GPU kernel: bloom — port of `packages/engine/src/liveEffects/bloom.ts`.
 *
 * Multi-pass pipeline (all passes at full surface size — the runner pools
 * textures per (name, size); downsampled content is stored at full-res
 * stride and sampled with scaled UVs):
 *   bloomBright   — linearized-luma threshold + soft knee → 'b1'
 *   bloomDown2    — 2x2 box average of 'b1' → 'b2' (half grid)
 *   bloomDown4    — 2x2 box average of 'b2' → 'b3' (quarter grid)
 *   bloomBlurH2/V2, bloomBlurH4/V4 — 5-tap separable blur on each grid
 *   bloomComposite — weighted (diffusion) upsample-add + tint, screen/add
 *                    composite over the source → 'out'
 *
 * The CPU uses a 3-4 level pyramid with linear-light gaussian blur; the GPU
 * uses two levels with a fixed 5-tap blur (visual equivalence). The streak
 * pass is approximated by a horizontal smear on the coarsest level when
 * enabled (documented deviation).
 *
 * Param packing (f32):
 *   [0] threshold [1] softKnee [2] intensity [3] radius(px)
 *   [4] diffusion [5] tintMix(0/1) [6] tintR [7] tintG [8] tintB (0..1)
 *   [9] composite (0=screen, 1=add)
 *   [10] streakEnabled [11] streakAngle(deg) [12] streakLength(px)
 *   [13] streakIntensity [14] streakAspect
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

export const BLOOM_KERNEL: GpuKernelSpec = {
  id: 'bloom',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBright(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let s = textureLoad(src, vec2i(x, y), 0);
  let lum = 0.2126 * s.r * 255.0 + 0.7152 * s.g * 255.0 + 0.0722 * s.b * 255.0;
  let lin = srgbByteToLinear01(lum);
  let thresh = p[0];
  let knee = p[1];
  var m: f32;
  if (knee <= 0.0) {
    m = select(0.0, 1.0, lin >= thresh);
  } else {
    let d = (lin - thresh) / knee;
    m = select(0.0, 1.0, d >= 1.0);
    m = select(m, d * 0.5 + 0.5, d > -1.0 && d < 1.0);
  }
  let f = m * m;
  textureStore(dst, vec2i(x, y), vec4f(s.r * f, s.g * f, s.b * f, s.a));
}

// ── downsample: 2x2 box average, written at full-res stride ────────────────

@group(2) @binding(1) var downSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomDown(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(downSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let px = gx * 2;
  let py = gy * 2;
  let c00 = textureLoad(downSrc, vec2i(px, py), 0);
  let c10 = textureLoad(downSrc, vec2i(min(w - 1, px + 1), py), 0);
  let c01 = textureLoad(downSrc, vec2i(px, min(h - 1, py + 1)), 0);
  let c11 = textureLoad(downSrc, vec2i(min(w - 1, px + 1), min(h - 1, py + 1)), 0);
  let avg = (c00 + c10 + c01 + c11) * 0.25;
  textureStore(dst, vec2i(px, py), avg);
}

// ── 5-tap separable blur at grid stride ─────────────────────────────────────

@group(2) @binding(1) var blurSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBlurH(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let py = gy * 2;
  let px = gx * 2;
  let sum = vec4f(0.0);
  let weights = array<f32, 5>(0.05, 0.2, 0.5, 0.2, 0.05);
  for (var k: i32 = -2; k <= 2; k = k + 1) {
    let nx = clamp(px + k * 2, 0, w - 1);
    sum += textureLoad(blurSrc, vec2i(nx, py), 0) * weights[k + 2];
  }
  textureStore(dst, vec2i(px, py), sum);
}

@group(2) @binding(1) var blurSrc2: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomBlurV(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc2);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 2 >= w || gy * 2 >= h) { return; }
  let py = gy * 2;
  let px = gx * 2;
  let sum = vec4f(0.0);
  let weights = array<f32, 5>(0.05, 0.2, 0.5, 0.2, 0.05);
  for (var k: i32 = -2; k <= 2; k = k + 1) {
    let ny = clamp(py + k * 2, 0, h - 1);
    sum += textureLoad(blurSrc2, vec2i(px, ny), 0) * weights[k + 2];
  }
  textureStore(dst, vec2i(px, py), sum);
}

// ── streak: horizontal smear on the coarsest grid ───────────────────────────

@group(2) @binding(1) var streakSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn bloomStreak(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(streakSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let gx = i32(gid.x);
  let gy = i32(gid.y);
  if (gx * 4 >= w || gy * 4 >= h) { return; }
  let py = gy * 4;
  let px = gx * 4;
  let lenPx = p[12];
  let steps = max(3, min(16, i32(round(lenPx / 6.0))));
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var s = -steps; s <= steps; s = s + 1) {
    let nx = clamp(px + s * 4, 0, w - 1);
    sum += textureLoad(streakSrc, vec2i(nx, py), 0);
    n += 1.0;
  }
  let avg = sum / max(n, 1.0);
  let cur = textureLoad(streakSrc, vec2i(px, py), 0);
  let mix = p[13] * 0.5;
  textureStore(dst, vec2i(px, py), cur + (avg - cur) * mix);
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var g2: texture_2d<f32>;
@group(2) @binding(2) var g4: texture_2d<f32>;
@group(2) @binding(3) var src2: texture_2d<f32>;
@group(2) @binding(4) var samp: sampler;

@compute @workgroup_size(8, 8, 1)
fn bloomComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let fxx = f32(x);
  let fyy = f32(y);
  let u2 = vec2f((fxx * 0.5 + 0.5) / f32(w), (fyy * 0.5 + 0.5) / f32(h));
  let u4 = vec2f((fxx * 0.25 + 0.5) / f32(w), (fyy * 0.25 + 0.5) / f32(h));

  let diffusion = p[4];
  let w2 = 1.0 + 2.0 * diffusion * 0.35;
  let w4 = 1.0 + 1.0 * diffusion * 0.35;
  let glow = (textureSampleLevel(g2, samp, u2, 0.0).rgb * w2 + textureSampleLevel(g4, samp, u4, 0.0).rgb * w4) / (w2 + w4);

  let s = textureLoad(src2, vec2i(x, y), 0);
  let tintMix = p[5];
  var gr = glow.r;
  var gg = glow.g;
  var gb = glow.b;
  if (tintMix > 0.0) {
    gr = gr + (gr * p[6] - gr) * tintMix;
    gg = gg + (gg * p[7] - gg) * tintMix;
    gb = gb + (gb * p[8] - gb) * tintMix;
  }
  let intensity = p[2];
  var outR: f32;
  var outG: f32;
  var outB: f32;
  if (p[9] > 0.5) {
    // add
    outR = clampByte(s.r * 255.0 + gr * 255.0 * intensity);
    outG = clampByte(s.g * 255.0 + gg * 255.0 * intensity);
    outB = clampByte(s.b * 255.0 + gb * 255.0 * intensity);
  } else {
    // screen
    let invR = 255.0 - s.r * 255.0;
    outR = clampByte(255.0 - (invR * (255.0 - gr * 255.0 * intensity)) / 255.0);
    let invG = 255.0 - s.g * 255.0;
    outG = clampByte(255.0 - (invG * (255.0 - gg * 255.0 * intensity)) / 255.0);
    let invB = 255.0 - s.b * 255.0;
    outB = clampByte(255.0 - (invB * (255.0 - gb * 255.0 * intensity)) / 255.0);
  }
  textureStore(dst, vec2i(x, y), vec4f(outR, outG, outB, s.a * 255.0) / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    const coordScale =
      request.coordSpace && request.coordSpace.scale > 0 ? request.coordSpace.scale : 1;
    const radius = Math.max(0.5, (q.radius ?? 24) * coordScale);
    const params = new Float32Array(15);
    let o = pack.f(params, 0, q.threshold, 0.7);
    o = pack.f(params, o, q.softKnee, 0.2);
    o = pack.f(params, o, q.intensity, 1);
    o = pack.f(params, o, radius, 24);
    o = pack.f(params, o, q.diffusion, 0.5);
    const tint = Array.isArray(q.tint) ? (q.tint as number[]) : null;
    o = pack.f(params, o, tint ? 1 : 0, 0);
    if (tint) {
      o = pack.f(params, o, (tint[0] ?? 255) / 255, 1);
      o = pack.f(params, o, (tint[1] ?? 255) / 255, 1);
      o = pack.f(params, o, (tint[2] ?? 255) / 255, 1);
    } else {
      o = pack.f(params, o, 1, 1);
      o = pack.f(params, o, 1, 1);
      o = pack.f(params, o, 1, 1);
    }
    o = pack.f(params, o, q.composite === 'add' ? 1 : 0, 0);
    const streakEnabled = q.streakEnabled === true;
    o = pack.b(params, o, q.streakEnabled, false);
    o = pack.f(params, o, q.streakAngle, 0);
    o = pack.f(params, o, (q.streakLength ?? 64) * coordScale, 64);
    o = pack.f(params, o, q.streakIntensity, 0.5);
    pack.f(params, o, q.streakAspect, 2);
    const passes = [
      { entry: 'bloomBright' as const, textures: ['b1', 'src'] },
      { entry: 'bloomDown' as const, textures: ['b2', 'b1'] },
      { entry: 'bloomDown' as const, textures: ['b3', 'b2'] },
      { entry: 'bloomBlurH' as const, textures: ['c2', 'b2'] },
      { entry: 'bloomBlurV' as const, textures: ['b2', 'c2'] },
      { entry: 'bloomBlurH' as const, textures: ['c3', 'b3'] },
      { entry: 'bloomBlurV' as const, textures: ['b3', 'c3'] },
    ];
    if (streakEnabled && (q.streakIntensity ?? 0.5) > 0) {
      passes.push({ entry: 'bloomStreak' as const, textures: ['b3', 'b3'] });
    }
    return [
      ...passes.map((pass) => ({
        entry: pass.entry,
        params,
        textures: pass.textures,
        sampler: 'nearest' as const,
        workgroup: [8, 8, 1] as [number, number, number],
      })),
      {
        entry: 'bloomComposite',
        params,
        textures: ['out', 'b2', 'b3', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
