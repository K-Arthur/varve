/**
 * GPU kernel: light leak — direct port of
 * `packages/engine/src/liveEffects/lightLeak.ts` (per-pixel, single pass).
 *
 * Param packing (f32):
 *   [0]  seed (u32 as f32)
 *   [1]  x (0..1)          [2]  y (0..1)      [3]  angle (deg)
 *   [4]  size              [5]  softness      [6]  hue
 *   [7]  saturation        [8]  lightness     [9]  intensity
 *   [10] noiseScale
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

export const LIGHT_LEAK_KERNEL: GpuKernelSpec = {
  id: 'lightLeak',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightLeakMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let intensity = max(0.0, p[9]);
  let seed = u32(p[0]);
  let cx = f32(w) * clamp01(p[1]);
  let cy = f32(h) * clamp01(p[2]);
  let angle = p[3] * 3.141592653589793 / 180.0;
  let diag = sqrt(f32(w * w + h * h));
  let sizeParam = max(0.05, p[4]);
  let sigma = diag * sizeParam * 0.14;
  let softness = clamp01(p[5]);
  let noiseScale = clamp01(p[10]);
  let cosA = cos(angle);
  let sinA = sin(angle);
  let noiseFreq = (1.0 / max(1.0, diag * 0.02)) * (0.3 + noiseScale * 1.6);
  let octaves = 1 + i32(round(softness * 3.0));

  let col = hslToRgb01(p[6], clamp01(p[7]), clamp01(p[8]));

  let dx = f32(x) - cx;
  let dy = f32(y) - cy;
  let nx = dx * cosA - dy * sinA;
  let ny = dx * sinA + dy * cosA;
  let n = fbm2(nx * noiseFreq, ny * noiseFreq, seed, octaves);
  let g = exp(-(dx * dx + dy * dy) / (2.0 * sigma * sigma));
  let leak = n * g * intensity;
  if (leak <= 0.004) { return; }

  let s = textureLoad(src, vec2i(x, y), 0);
  let lr = col.r * leak;
  let lg = col.g * leak;
  let lb = col.b * leak;
  let out = vec4f(
    clampByte(255.0 - ((255.0 - s.r * 255.0) * (255.0 - lr)) / 255.0),
    clampByte(255.0 - ((255.0 - s.g * 255.0) * (255.0 - lg)) / 255.0),
    clampByte(255.0 - ((255.0 - s.b * 255.0) * (255.0 - lb)) / 255.0),
    s.a * 255.0,
  );
  textureStore(dst, vec2i(x, y), out / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    const params = new Float32Array(11);
    let o = pack.f(params, 0, q.seed, 0);
    o = pack.f(params, o, q.x, 0.5);
    o = pack.f(params, o, q.y, 0.5);
    o = pack.f(params, o, q.angle, 0);
    o = pack.f(params, o, q.size, 0.8);
    o = pack.f(params, o, q.softness, 0.6);
    o = pack.f(params, o, q.hue, 0);
    o = pack.f(params, o, q.saturation, 0.7);
    o = pack.f(params, o, q.lightness, 0.6);
    o = pack.f(params, o, q.intensity, 0.6);
    pack.f(params, o, q.noiseScale, 0.5);
    return [
      {
        entry: 'lightLeakMain',
        params,
        textures: ['out', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
