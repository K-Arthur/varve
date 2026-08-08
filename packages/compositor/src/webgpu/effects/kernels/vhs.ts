/**
 * GPU kernel: VHS — port of `packages/engine/src/liveEffects/vhs.ts`.
 *
 * Three passes (all parallel):
 *   vhsMain  — per-pixel jitter/tear/dropout/noise from 'src' → 'a'
 *   vhsBleed — horizontal chroma bleed on 'a' → 'b'
 *   vhsBlur  — 3x3 box-blur blend on 'b' → 'out'
 *
 * The CPU kernel draws noise from a single sequential mulberry32 stream; the
 * GPU kernel uses per-pixel hashes instead (same structure, different exact
 * pattern — within the harness tolerance).
 *
 * Param packing (f32):
 *   [0] seed  [1] frameRate  [2] time  [3] lumaNoise  [4] chromaNoise
 *   [5] bleed [6] jitter     [7] tracking [8] dropouts [9] headSwitching
 *   [10] tearing [11] signalBlur [12] timeInstability [13] quality factor
 */
import type { GpuKernelSpec } from '../runner';
import { pack, resolveQuality } from '../runner';
import { WGSL_HELPERS } from './shared';

export const VHS_KERNEL: GpuKernelSpec = {
  id: 'vhs',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let seed = u32(p[0]);
  let frameRate = max(1.0, p[1]);
  let time = max(0.0, p[2]);
  let frame = i32(floor(time * frameRate));
  let field = hash3(i32(seed), frame, 0, seed);

  let lumaNoise = clamp01(p[3]);
  let chromaNoise = clamp01(p[4]);
  let jitter = clamp01(p[6]);
  let tracking = clamp01(p[7]);
  let dropouts = clamp01(p[8]);
  let headSwitch = clamp01(p[9]);
  let tearing = clamp01(p[10]);
  let instability = clamp01(p[12]);

  let jitterPhase = seeded01(u32(round(field * 2147483648.0)) ^ 0x5f3759dfu);
  let trackingY = i32(floor(seeded01(u32(round(field * 2147483648.0)) ^ 0x9e3779b9u) * f32(h)));
  let tearCount = max(1, i32(round(tearing * 24.0)));
  let driftX = (jitterPhase - 0.5) * 2.0 * instability * 24.0;

  // Per-line jitter (CPU precomputes per line; compute per pixel here).
  let lineJitter = (hash3(field, y, 1, seed) - 0.5) * 2.0 * jitter * 16.0;

  // Tear slices.
  var tearOffset = 0.0;
  if (tearing > 0.0) {
    let sliceH = max(4.0, floor(f32(h) / f32(tearCount)));
    let s = i32(floor(f32(y) / sliceH));
    tearOffset = round((hash3(field, s, 2, seed) - 0.5) * 2.0 * tearing * 48.0);
  }

  let headOffset = y > i32(f32(h) * 0.92)
    ? round((hash3(field, 9, 4, seed) - 0.5) * 2.0 * headSwitch * 40.0)
    : 0.0;
  var trackOffset = 0.0;
  if (tracking > 0.0 && abs(f32(y) - f32(trackingY)) < max(2.0, f32(h) * 0.03)) {
    trackOffset = round((hash3(field, y, 5, seed) - 0.5) * 2.0 * tracking * 24.0);
  }

  let shift = round(lineJitter + tearOffset + headOffset + trackOffset);
  let sx = ((x + i32(shift)) % w + w) % w;
  let s = textureLoad(src, vec2i(sx, y), 0);

  var r = s.r * 255.0;
  var g = s.g * 255.0;
  var b = s.b * 255.0;
  let a = s.a * 255.0;

  // Time instability: global slow drift.
  if (instability > 0.0 && driftX != 0.0) {
    let dx = i32(round(driftX));
    let sxo = ((x + dx) % w + w) % w;
    let s2 = textureLoad(src, vec2i(sxo, y), 0);
    r = r * 0.5 + s2.r * 255.0 * 0.5;
    g = g * 0.5 + s2.g * 255.0 * 0.5;
    b = b * 0.5 + s2.b * 255.0 * 0.5;
  }

  // Per-pixel noise (CPU uses a sequential RNG stream; hash-based here).
  let rn = (hash3(x, y, frame, seed) - 0.5);
  if (lumaNoise > 0.0) {
    let n = rn * 2.0 * lumaNoise * 42.0;
    r += n;
    g += n;
    b += n;
  }
  if (chromaNoise > 0.0) {
    let n = (hash3(x, y, frame + 31, seed) - 0.5) * 2.0 * chromaNoise * 34.0;
    r += n;
    b -= n;
  }

  // Dropout rows.
  var isDropout = false;
  if (dropouts > 0.0) {
    let dropCount = i32(round(dropouts * 12.0));
    for (var i: i32 = 0; i < dropCount; i = i + 1) {
      let dy = i32(floor(hash3(field, i, 3, seed) * f32(h)));
      if (dy == y || min(h - 1, dy + 1) == y) { isDropout = true; }
    }
  }
  if (isDropout) {
    let d = 0.55 + (hash3(x, y, frame + 17, seed) * 0.3);
    r = r * 0.3 + 255.0 * d * 0.7;
    g = g * 0.3 + 255.0 * d * 0.7;
    b = b * 0.3 + 255.0 * d * 0.7;
  }

  textureStore(dst, vec2i(x, y), vec4f(clampByte(r), clampByte(g), clampByte(b), a) / 255.0);
}

// ── chroma bleed: horizontal box on R/B ─────────────────────────────────────

@group(2) @binding(1) var bleedSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsBleed(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(bleedSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  let bleed = clamp01(p[5]);
  let radius = max(1, i32(round(bleed * 12.0 * p[13])));
  var r: f32 = 0.0;
  var b: f32 = 0.0;
  var n: f32 = 0.0;
  for (var dx = -radius; dx <= radius; dx = dx + 1) {
    let nx = x + dx;
    if (nx < 0 || nx >= w) { continue; }
    let c = textureLoad(bleedSrc, vec2i(nx, y), 0);
    r += c.r * 255.0;
    b += c.b * 255.0;
    n += 1.0;
  }
  let cur = textureLoad(bleedSrc, vec2i(x, y), 0);
  let mix = bleed * 0.85;
  let outR = clampByte(cur.r * 255.0 + (r / max(n, 1.0) - cur.r * 255.0) * mix);
  let outB = clampByte(cur.b * 255.0 + (b / max(n, 1.0) - cur.b * 255.0) * mix);
  textureStore(dst, vec2i(x, y), vec4f(outR, cur.g * 255.0, outB, cur.a * 255.0) / 255.0);
}

// ── signal blur: 3x3 box blur blend ─────────────────────────────────────────

@group(2) @binding(1) var blurSrc: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn vhsBlur(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(blurSrc);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }
  var sum = vec4f(0.0);
  var n = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let nx = x + dx;
      let ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) { continue; }
      sum += textureLoad(blurSrc, vec2i(nx, ny), 0);
      n += 1.0;
    }
  }
  let cur = textureLoad(blurSrc, vec2i(x, y), 0);
  let m = clamp01(p[11]) * 0.6;
  let out = vec4f(
    clampByte(cur.r * 255.0 + (sum.r / n * 255.0 - cur.r * 255.0) * m),
    clampByte(cur.g * 255.0 + (sum.g / n * 255.0 - cur.g * 255.0) * m),
    clampByte(cur.b * 255.0 + (sum.b / n * 255.0 - cur.b * 255.0) * m),
    cur.a * 255.0,
  );
  textureStore(dst, vec2i(x, y), out / 255.0);
}
`,
  buildPasses(request) {
    const q = request.params;
    const tier = resolveQuality(q, request.quality);
    const params = new Float32Array(14);
    let o = pack.f(params, 0, q.seed, 0);
    o = pack.f(params, o, q.frameRate, 24);
    o = pack.f(params, o, q.time, 0);
    o = pack.f(params, o, q.lumaNoise, 0);
    o = pack.f(params, o, q.chromaNoise, 0);
    o = pack.f(params, o, q.chromaBleed, 0);
    o = pack.f(params, o, q.jitter, 0);
    o = pack.f(params, o, q.tracking, 0);
    o = pack.f(params, o, q.dropouts, 0);
    o = pack.f(params, o, q.headSwitching, 0);
    o = pack.f(params, o, q.tearing, 0);
    o = pack.f(params, o, q.signalBlur, 0);
    o = pack.f(params, o, q.timeInstability, 0);
    pack.f(params, o, tier === 'interactive' ? 0.5 : 1, 1);
    return [
      {
        entry: 'vhsMain',
        params,
        textures: ['a', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
      {
        entry: 'vhsBleed',
        params,
        textures: ['b', 'a'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
      {
        entry: 'vhsBlur',
        params,
        textures: ['out', 'b'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
