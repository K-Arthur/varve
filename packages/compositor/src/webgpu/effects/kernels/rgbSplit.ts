/**
 * GPU kernel: RGB split — direct port of
 * `packages/engine/src/liveEffects/rgbSplit.ts` (per-pixel, single pass).
 *
 * Sampling happens on the straight-alpha source with premultiplied lerps in
 * the shader (the CPU kernel premultiplies a working copy first); border
 * policy is implemented as coordinate remapping + a transparent sentinel.
 *
 * Param packing (f32):
 *   [0]  mode code (offset=0, radial=1)
 *   [1]  redX  [2] redY  [3] greenX  [4] greenY  [5] blueX  [6] blueY
 *   [7]  amount  [8] centerX  [9] centerY  [10] falloff  [11] fringeAngle (deg)
 *   [12] border code (transparent=0, clamp=1, mirror=2, wrap=3)
 *   [13] intensity  [14] coordSpace scale
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

const MODE_OFFSET = 0;
const MODE_RADIAL = 1;
const BORDER_TRANSPARENT = 0;
const BORDER_CLAMP = 1;
const BORDER_MIRROR = 2;
const BORDER_WRAP = 3;

export const RGB_SPLIT_KERNEL: GpuKernelSpec = {
  id: 'rgbSplit',
  wgsl:
    `
fn remapCoord(v: f32, w: i32, border: u32) -> f32 {
  let i = i32(floor(v));
  if (border == 3u) {
    let m = ((i % w) + w) % w;
    return f32(m);
  }
  if (border == 2u) {
    let period = 2 * w;
    var m = ((i % period) + period) % period;
    if (m >= w) { m = period - m - 1; }
    return f32(m);
  }
  return clamp(v, 0.0, f32(w - 1));
}
` +
    `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

fn sampleBilinearClamped(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let cx = clamp(x, 0.0, f32(w - 1));
  let cy = clamp(y, 0.0, f32(h - 1));
  let u = (cx + 0.5) / f32(w);
  let v = (cy + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

fn sampleChannel(src: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32, border: u32) -> vec4f {
  if (border == 0u) {
    if (x < 0.0 || x > f32(w - 1) || y < 0.0 || y > f32(h - 1)) {
      return vec4f(0.0);
    }
    return sampleBilinearClamped(src, samp, x, y, w, h);
  }
  let rx = remapCoord(x, w, border);
  let ry = remapCoord(y, h, border);
  return sampleBilinearClamped(src, samp, rx, ry, w, h);
}

@compute @workgroup_size(8, 8, 1)
fn probe3jMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let intensity = p[13];
  let scale = p[14];
  let redX = p[1] * scale * intensity;
  let redY = p[2] * scale * intensity;
  let greenX = p[3] * scale * intensity;
  let greenY = p[4] * scale * intensity;
  let blueX = p[5] * scale * intensity;
  let blueY = p[6] * scale * intensity;
  let fxx = f32(x);
  let fyy = f32(y);
  let r = sampleChannel(src, samp, fxx + redX, fyy + redY, w, h, u32(p[12]));
  let g = sampleChannel(src, samp, fxx + greenX, fyy + greenY, w, h, u32(p[12]));
  let b = sampleChannel(src, samp, fxx + blueX, fyy + blueY, w, h, u32(p[12]));
  let a = textureLoad(src, vec2i(x, y), 0).a;
  let pr = r.rgb * a;
  let pg = g.rgb * a;
  let pb = b.rgb * a;
  let outR = select(pr.r, pr.r / max(a, 1.0 / 255.0), a > 0.0);
  let outG = select(pg.g, pg.g / max(a, 1.0 / 255.0), a > 0.0);
  let outB = select(pb.b, pb.b / max(a, 1.0 / 255.0), a > 0.0);
  textureStore(dst, vec2i(x, y), vec4f(clamp(outR * 255.0, 0.0, 255.0), clamp(outG * 255.0, 0.0, 255.0), clamp(outB * 255.0, 0.0, 255.0), a * 255.0) / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    const params = new Float32Array(15);
    let o = pack.f(params, 0, q.mode === 'radial' ? MODE_RADIAL : MODE_OFFSET, 0);
    o = pack.f(params, o, q.redX, 0);
    o = pack.f(params, o, q.redY, 0);
    o = pack.f(params, o, q.greenX, 0);
    o = pack.f(params, o, q.greenY, 0);
    o = pack.f(params, o, q.blueX, 0);
    o = pack.f(params, o, q.blueY, 0);
    o = pack.f(params, o, q.amount, 4);
    o = pack.f(params, o, q.centerX, 0.5);
    o = pack.f(params, o, q.centerY, 0.5);
    o = pack.f(params, o, q.falloff, 1);
    o = pack.f(params, o, q.fringeAngle, 0);
    const borderCode =
      q.borderMode === 'clamp'
        ? BORDER_CLAMP
        : q.borderMode === 'mirror'
          ? BORDER_MIRROR
          : q.borderMode === 'wrap'
            ? BORDER_WRAP
            : BORDER_TRANSPARENT;
    o = pack.f(params, o, borderCode, BORDER_CLAMP);
    o = pack.f(params, o, q.intensity, 1);
    pack.f(
      params,
      o,
      request.coordSpace && request.coordSpace.scale > 0 ? request.coordSpace.scale : 1,
      1,
    );
    return [
      {
        entry: 'rgbSplitMain',
        params,
        textures: ['probe3jout', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
