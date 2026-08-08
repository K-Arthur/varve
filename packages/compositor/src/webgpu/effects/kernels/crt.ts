/**
 * GPU kernel: CRT — direct port of `packages/engine/src/liveEffects/crt.ts`.
 *
 * Three passes (all parallel): warp+patterns → glow box blur → blend +
 * unpremultiply. Sampling is premultiplied in the shader (the CPU
 * premultiplies a working copy first).
 *
 * Param packing (f32):
 *   [0]  curvature        [1]  scanlinePeriod  [2]  scanlineStrength
 *   [3]  scanlineSoftness [4]  phosphor code   [5]  phosphor pitch
 *   [6]  phosphorIntensity[7]  glow            [8]  vignette
 *   [9]  vignetteRadius   [10] convergenceX    [11] convergenceY
 *   [12] brightness       [13] contrast
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

const PHOSPHOR_NONE = 0;
const PHOSPHOR_RGB = 1;
const PHOSPHOR_BGR = 2;
const PHOSPHOR_GRILLE = 3;
const PHOSPHOR_SHADOW = 4;

export const CRT_KERNEL: GpuKernelSpec = {
  id: 'crt',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

fn phosphorMask(mask: i32, x: f32, y: f32, pitch: f32) -> vec3f {
  let px = x % pitch;
  let t = px / pitch;
  if (mask == 1) {
    if (t < 0.34) { return vec3f(1.0, 0.22, 0.22); }
    if (t < 0.67) { return vec3f(0.22, 1.0, 0.22); }
    return vec3f(0.22, 0.22, 1.0);
  }
  if (mask == 2) {
    if (t < 0.34) { return vec3f(0.22, 0.22, 1.0); }
    if (t < 0.67) { return vec3f(0.22, 1.0, 0.22); }
    return vec3f(1.0, 0.22, 0.22);
  }
  if (mask == 3) {
    if (t < 0.5) { return vec3f(1.0, 0.35, 0.35); }
    return vec3f(0.35, 0.35, 1.0);
  }
  if (mask == 4) {
    let py = y % pitch;
    let dot = sqrt((t - 0.5) * (t - 0.5) + (py / pitch - 0.5) * (py / pitch - 0.5)) * 2.0;
    let dark = select(1.0, 0.2, dot > 0.85);
    return vec3f(dark, dark, dark);
  }
  return vec3f(1.0);
}

@compute @workgroup_size(8, 8, 1)
fn crtWarpMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let curvature = p[0];
  let scanPeriod = max(1.5, p[1]);
  let scanStrength = clamp01(p[2]);
  let scanSoftness = clamp01(p[3]);
  let mask = i32(p[4]);
  let pitch = max(1.0, p[5]);
  let phIntensity = clamp01(p[6]);
  let vignette = clamp01(p[8]);
  let vignetteR = clamp01(p[9]);
  let cx = p[10];
  let cy = p[11];
  let brightness = clamp(p[12], -1.0, 1.0);
  let contrast = clamp(p[13], 0.0, 2.0);

  let halfW = f32(w) / 2.0;
  let halfH = f32(h) / 2.0;
  let warpK = curvature * 0.28;

  let fxx = f32(x);
  let fyy = f32(y);

  var sx = fxx;
  var sy = fyy;
  if (warpK > 0.0) {
    let nx = (fxx - halfW) / halfW;
    let ny = (fyy - halfH) / halfH;
    let r2 = nx * nx + ny * ny;
    let scale = 1.0 + warpK * r2;
    sx = min(f32(w - 1), max(0.0, halfW + (nx * halfW) / scale));
    sy = min(f32(h - 1), max(0.0, halfH + (ny * halfH) / scale));
  }

  let s0 = textureLoad(src, vec2i(x, y), 0);
  let s = vec4f(s0.rgb * s0.a, s0.a);
  let a = s.a;

  // Warp sample (premultiplied).
  var r: f32 = 0.0; var g: f32 = 0.0; var b: f32 = 0.0;
  if (warpK > 0.0) {
    let c = sampleBilinearClamped(src, samp, sx, sy, w, h);
    let pm = vec4f(c.rgb * c.a, c.a);
    r = pm.r; g = pm.g; b = pm.b;
  } else {
    r = s.r; g = s.g; b = s.b;
  }

  // Convergence: red shifted +, blue shifted − (subpixel bilinear), 60% mix.
  if (cx != 0.0 || cy != 0.0) {
    let cr = sampleBilinearClamped(src, samp, fxx + cx, fyy + cy, w, h);
    let cb = sampleBilinearClamped(src, samp, fxx - cx, fyy - cy, w, h);
    r = r + (cr.r * cr.a - r) * 0.6;
    b = b + (cb.b * cb.a - b) * 0.6;
  }

  // Scanlines.
  if (scanStrength > 0.0) {
    let phase = ((fyy % scanPeriod) + scanPeriod) % scanPeriod;
    let pulse = 0.5 + 0.5 * cos((2.0 * 3.141592653589793 * phase) / scanPeriod);
    let depth = scanStrength * pow(pulse, 0.4 + scanSoftness * 2.2);
    r *= 1.0 - depth;
    g *= 1.0 - depth;
    b *= 1.0 - depth;
  }

  // Phosphor mask.
  if (mask != 0 && phIntensity > 0.0) {
    let m = phosphorMask(mask, fxx, fyy, pitch);
    let mi = phIntensity;
    r = r * (1.0 - mi) + r * m.r * mi;
    g = g * (1.0 - mi) + g * m.g * mi;
    b = b * (1.0 - mi) + b * m.b * mi;
  }

  // Vignette.
  if (vignette > 0.0) {
    let nx = (fxx - halfW) / (halfW * vignetteR * 2.0);
    let ny = (fyy - halfH) / (halfH * vignetteR * 2.0);
    let d = min(1.0, sqrt(nx * nx + ny * ny));
    let t = clamp01((d - 0.55) / (1.0 - 0.55));
    let vig = 1.0 - vignette * (t * t * (3.0 - 2.0 * t));
    r *= vig; g *= vig; b *= vig;
  }

  // Brightness/contrast.
  let gain = contrast;
  r = (r - 128.0) * gain + 128.0 + brightness * 128.0;
  g = (g - 128.0) * gain + 128.0 + brightness * 128.0;
  b = (b - 128.0) * gain + 128.0 + brightness * 128.0;

  textureStore(dst, vec2i(x, y), vec4f(r, g, b, a * 255.0) / 255.0);
}

// ── glow pass: 5x5 box blur of the warp output ──────────────────────────────

@group(2) @binding(1) var glowSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn crtGlowMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(glowSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var dy = -2; dy <= 2; dy = dy + 1) {
    for (var dx = -2; dx <= 2; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(glowSrc, vec2i(nx, ny), 0);
      n += 1.0;
    }
  }
  let avg = sum / n;
  // Clamp/round to byte precision like the CPU boxBlur3 (Math.round).
  textureStore(dst, vec2i(x, y), vec4f(round(avg.r * 255.0), round(avg.g * 255.0), round(avg.b * 255.0), round(avg.a * 255.0)) / 255.0);
}

// ── blend pass: a + (blur - a) * m, then unpremultiply ──────────────────────

@group(2) @binding(1) var blendA: texture_2d<f32>;
@group(2) @binding(2) var blendB: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn crtBlendMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blendA);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let glow = p[7];
  let m = glow * 0.5;
  let a = textureLoad(blendA, vec2i(x, y), 0);
  let b = textureLoad(blendB, vec2i(x, y), 0);
  var out = vec4f(
    clampByte(a.r * 255.0 + (b.r * 255.0 - a.r * 255.0) * m),
    clampByte(a.g * 255.0 + (b.g * 255.0 - a.g * 255.0) * m),
    clampByte(a.b * 255.0 + (b.b * 255.0 - a.b * 255.0) * m),
    a.a * 255.0,
  );
  // Unpremultiply.
  if (out.a > 0.0 && out.a < 255.0) {
    let inv = 255.0 / out.a;
    out.r = clampByte(out.r * inv);
    out.g = clampByte(out.g * inv);
    out.b = clampByte(out.b * inv);
  }
  textureStore(dst, vec2i(x, y), out / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    const params = new Float32Array(14);
    let o = pack.f(params, 0, q.curvature, 0);
    o = pack.f(params, o, q.scanlinePeriod, 3);
    o = pack.f(params, o, q.scanlineStrength, 0.5);
    o = pack.f(params, o, q.scanlineSoftness, 0.5);
    const maskCode =
      q.phosphorMask === 'rgb-stripe'
        ? PHOSPHOR_RGB
        : q.phosphorMask === 'bgr-stripe'
          ? PHOSPHOR_BGR
          : q.phosphorMask === 'aperture-grille'
            ? PHOSPHOR_GRILLE
            : q.phosphorMask === 'shadow-mask'
              ? PHOSPHOR_SHADOW
              : PHOSPHOR_NONE;
    o = pack.f(params, o, maskCode, PHOSPHOR_NONE);
    o = pack.f(params, o, q.phosphorPitch, 4);
    o = pack.f(params, o, q.phosphorIntensity, 0.6);
    o = pack.f(params, o, q.glow, 0);
    o = pack.f(params, o, q.vignette, 0);
    o = pack.f(params, o, q.vignetteRadius, 0.5);
    o = pack.f(params, o, q.convergenceX, 0);
    o = pack.f(params, o, q.convergenceY, 0);
    o = pack.f(params, o, q.brightness, 0);
    pack.f(params, o, q.contrast, 1);
    const glow = typeof q.glow === 'number' && Number.isFinite(q.glow) ? q.glow : 0;
    return [
      {
        entry: 'crtWarpMain',
        params,
        textures: ['a', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
      {
        entry: 'crtGlowMain',
        params,
        textures: ['b', 'a'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
      {
        entry: 'crtBlendMain',
        params,
        textures: ['out', 'a', 'b'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ].filter((pass, i) => (i === 1 ? glow > 0 : true));
  },
};
