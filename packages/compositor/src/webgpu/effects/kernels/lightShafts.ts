/**
 * GPU kernel: light shafts — port of
 * `packages/engine/src/liveEffects/lightShafts.ts`.
 *
 * Three passes:
 *   lightShaftsRay — screen-space ray march (occlusion mask → scatter)
 *   lightShaftsBlur — optional box blur of the scatter map
 *   lightShaftsComposite — add scatter*tint*gain over the source
 *
 * Param packing (f32):
 *   [0] intensity [1] exposure [2] decay [3] density [4] weight
 *   [5] scattering [6] occlusion (0=luminance, 1=alpha)
 *   [7] lightX (0..1) [8] lightY [9] lightType (0=point, 1=directional)
 *   [10] direction (deg) [11] sampleCount [12] tintMix (0/1)
 *   [13] tintR [14] tintG [15] tintB (0..1)
 */
import type { EffectPass, GpuKernelSpec } from '../runner';
import { pack, resolveQuality } from '../runner';
import { WGSL_HELPERS } from './shared';

export const LIGHT_SHAFTS_KERNEL: GpuKernelSpec = {
  id: 'lightShafts',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsRay(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let intensity = max(0.0, p[0]);
  if (intensity <= 0.0) { return; }
  let exposure = clamp(p[1], -1.0, 1.0);
  let decay = clamp01(p[2]);
  let density = clamp01(p[3]);
  let weight = clamp01(p[4]);
  let occlusionCode = i32(p[6]);
  let steps = max(4, min(96, i32(round(p[11]))));

  let lightX = f32(w) * clamp01(p[7]);
  let lightY = f32(h) * clamp01(p[8]);
  let isDirectional = p[9] > 0.5;
  let angle = p[10] * 3.141592653589793 / 180.0;
  let dirX = -cos(angle);
  let dirY = -sin(angle);
  let maxDist = sqrt(f32(w * w + h * h));

  let px = f32(x) + 0.5;
  let py = f32(y) + 0.5;
  var rayX: f32;
  var rayY: f32;
  if (isDirectional) {
    rayX = dirX;
    rayY = dirY;
  } else {
    let ddx = lightX - px;
    let ddy = lightY - py;
    var d = sqrt(ddx * ddx + ddy * ddy);
    if (d <= 0.000001) { d = 1.0; }
    rayX = ddx / d;
    rayY = ddy / d;
  }
  var distToLight = sqrt((lightX - px) * (lightX - px) + (lightY - py) * (lightY - py));
  if (isDirectional) { distToLight = maxDist; }
  let stepLen = max(1.0, distToLight / f32(steps));

  var acc: f32 = 0.0;
  var sampleX: f32 = px;
  var sampleY: f32 = py;
  var e: f32 = 1.0;
  for (var s: i32 = 0; s < steps; s = s + 1) {
    sampleX += rayX * stepLen;
    sampleY += rayY * stepLen;
    let si = min(w - 1, max(0, i32(floor(sampleX)))) + min(h - 1, max(0, i32(floor(sampleY)))) * w;
    let sc = textureLoad(src, vec2i(si % w, si / w), 0);
    var occ: f32;
    if (occlusionCode == 1) {
      occ = sc.a;
    } else {
      let lum = 0.2126 * sc.r * 255.0 + 0.7152 * sc.g * 255.0 + 0.0722 * sc.b * 255.0;
      occ = max(0.0, srgbByteToLinear01(lum) - 0.12) * weight;
    }
    acc += occ * e * density;
    e *= decay;
    if (sampleX < 0.0 || sampleX >= f32(w) || sampleY < 0.0 || sampleY >= f32(h)) { break; }
  }

  let stored = clamp(acc * 255.0, 0.0, 255.0);
  textureStore(dst, vec2i(x, y), vec4f(stored, stored, stored, 1.0) / 255.0);
}

// ── scatter blur ────────────────────────────────────────────────────────────

@group(2) @binding(1) var scatterSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsBlur(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(scatterSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let radius = max(1, i32(round(p[5] * 6.0)));
  var sum = vec3f(0.0);
  var n = 0.0;
  for (var dy = -radius; dy <= radius; dy = dy + 1) {
    for (var dx = -radius; dx <= radius; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(scatterSrc, vec2i(nx, ny), 0).rgb;
      n += 1.0;
    }
  }
  let avg = sum / max(n, 1.0);
  textureStore(dst, vec2i(x, y), vec4f(avg, 1.0));
}

// ── composite ───────────────────────────────────────────────────────────────

@group(2) @binding(1) var scatter2: texture_2d<f32>;
@group(2) @binding(2) var src2: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lightShaftsComposite(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(scatter2);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let sc = textureLoad(scatter2, vec2i(x, y), 0);
  let srcv = textureLoad(src2, vec2i(x, y), 0);
  let s = sc.r * 255.0;
  let gain = p[0] * pow(2.0, p[1]);
  var lr = s * gain;
  var lg = s * gain;
  var lb = s * gain;
  if (p[12] > 0.5) {
    lr *= p[13];
    lg *= p[14];
    lb *= p[15];
  }
  textureStore(
    dst,
    vec2i(x, y),
    vec4f(
      clampByte(srcv.r * 255.0 + lr),
      clampByte(srcv.g * 255.0 + lg),
      clampByte(srcv.b * 255.0 + lb),
      srcv.a * 255.0,
    ) / 255.0,
  );
}
`,
  buildPasses(request, _surface) {
    const q = request.params;
    const tier = resolveQuality(q, request.quality);
    const factor = tier === 'interactive' ? 0.5 : tier === 'export' ? 2 : 1;
    const params = new Float32Array(16);
    let o = pack.f(params, 0, q.intensity, 1);
    o = pack.f(params, o, q.exposure, 0);
    o = pack.f(params, o, q.decay, 0.9);
    o = pack.f(params, o, q.density, 0.15);
    o = pack.f(params, o, q.weight, 0.8);
    o = pack.f(params, o, q.scattering, 0.5);
    o = pack.f(params, o, q.occlusionSource === 'alpha' ? 1 : 0, 0);
    o = pack.f(params, o, q.lightX, 0.5);
    o = pack.f(params, o, q.lightY, 0.5);
    o = pack.f(params, o, q.lightType === 'directional' ? 1 : 0, 0);
    o = pack.f(params, o, q.direction, 0);
    o = pack.f(
      params,
      o,
      Math.max(4, Math.min(96, Math.round(((q.sampleCount as number | undefined) ?? 24) * factor))),
      24,
    );
    const hasTint = Array.isArray(q.tint);
    o = pack.f(params, o, hasTint ? 1 : 0, 0);
    if (hasTint) {
      const t = q.tint as number[];
      o = pack.f(params, o, (t[0] ?? 255) / 255, 1);
      o = pack.f(params, o, (t[1] ?? 255) / 255, 1);
      pack.f(params, o, (t[2] ?? 255) / 255, 1);
    } else {
      o = pack.f(params, o, 1, 1);
      o = pack.f(params, o, 1, 1);
      pack.f(params, o, 1, 1);
    }
    const scattering = typeof q.scattering === 'number' ? q.scattering : 0.5;
    const passes: EffectPass[] = [
      {
        entry: 'lightShaftsRay',
        params,
        textures: ['a', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
    if (scattering > 0) {
      passes.push({
        entry: 'lightShaftsBlur',
        params,
        textures: ['b', 'a'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      });
    }
    passes.push({
      entry: 'lightShaftsComposite',
      params,
      textures: ['out', scattering > 0 ? 'b' : 'a', 'src'],
      sampler: 'nearest',
      workgroup: [8, 8, 1],
    });
    return passes;
  },
};
