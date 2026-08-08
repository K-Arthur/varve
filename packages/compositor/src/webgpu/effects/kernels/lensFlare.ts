/**
 * GPU kernel: lens flare — port of
 * `packages/engine/src/liveEffects/lensFlare.ts`.
 *
 * Single pass, fully procedural: each pixel accumulates the central halo,
 * seeded ghosts (with chromatic dispersion), anamorphic diffraction streaks,
 * and the aperture polygon star, then adds the accumulation to the source.
 * The CPU iterates components sparsely; the GPU evaluates the same terms per
 * pixel in a fixed-size loop (ghosts are capped at 8).
 *
 * Auto-source (sourceX < 0): the CPU scans for the brightest pixel. The GPU
 * kernel uses (0.5, 0.5) instead (documented approximation).
 *
 * Param packing (f32):
 *   [0] brightness [1] seed [2] scale [3] ghostCount [4] ghostSpacing
 *   [5] halo [6] blades [7] apertureRotation(deg) [8] streak
 *   [9] anamorphic [10] dispersion [11] sourceX [12] sourceY
 */
import type { GpuKernelSpec } from '../runner';
import { pack } from '../runner';
import { WGSL_HELPERS } from './shared';

export const LENS_FLARE_KERNEL: GpuKernelSpec = {
  id: 'lensFlare',
  wgsl:
    WGSL_HELPERS +
    /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;

@compute @workgroup_size(8, 8, 1)
fn lensFlareMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  let x = i32(gid.x);
  let y = i32(gid.y);
  if (x >= w || y >= h) { return; }

  let brightness = max(0.0, p[0]);
  let seed = u32(p[1]);
  let scale = max(0.05, p[2]);
  let baseRadius = f32(min(w, h)) * 0.09 * scale;
  let ghostCount = max(0, min(8, i32(round(p[3]))));
  let ghostSpacing = max(0.0, p[4]);
  let halo = clamp01(p[5]);
  let blades = i32(round(p[6]));
  let apertureRotation = p[7] * 3.141592653589793 / 180.0;
  let streak = clamp01(p[8]);
  let anamorphic = clamp01(p[9]);
  let dispersion = clamp01(p[10]);

  let fxx = f32(x);
  let fyy = f32(y);
  let lx = f32(w) * clamp01(p[11]);
  let ly = f32(h) * clamp01(p[12]);
  let ax = f32(w) / 2.0 - lx;
  let ay = f32(h) / 2.0 - ly;
  let axisLen = sqrt(ax * ax + ay * ay);
  if (axisLen < 0.000001) { axisLen = 1.0; }
  let ux = ax / axisLen;
  let uy = ay / axisLen;

  var acc = vec3f(0.0);
  let bf = brightness;

  // Central halo.
  if (halo > 0.0) {
    let hr = baseRadius * 2.2;
    let dx = fxx - lx;
    let dy = fyy - ly;
    let d2 = dx * dx + dy * dy;
    let r2 = hr * hr;
    let v = exp(-d2 / (2.0 * r2)) * halo * 0.5 * bf;
    if (v >= 0.004) { acc += vec3f(v, v, v); }
  }

  // Ghosts along the axis opposite the source.
  for (var i: i32 = 1; i <= ghostCount; i = i + 1) {
    let g = seeded01(seed + u32(i * 7919));
    let gx = lx + ux * -1.0 * f32(i) * ghostSpacing * baseRadius * 1.6;
    let gy = ly + uy * -1.0 * f32(i) * ghostSpacing * baseRadius * 1.6;
    let gr = baseRadius * (0.55 - f32(i) * 0.04) * (0.7 + g * 0.6);
    let intensity = bf * (1.0 - f32(i) / f32(ghostCount + 1)) * 0.8;
    let dx = fxx - gx;
    let dy = fyy - gy;
    let d2 = dx * dx + dy * dy;
    if (gr * gr <= 0.0) { continue; }
    if (dispersion > 0.0) {
      let off = gr * dispersion;
      let cr = exp(-((fxx - (gx + off * ux)) * (fxx - (gx + off * ux)) + (fyy - (gy + off * uy)) * (fyy - (gy + off * uy))) / (2.0 * gr * gr)) * intensity;
      let cg = exp(-d2 / (2.0 * gr * gr)) * intensity * 0.7;
      let cb = exp(-((fxx - (gx - off * ux)) * (fxx - (gx - off * ux)) + (fyy - (gy - off * uy)) * (fyy - (gy - off * uy))) / (2.0 * gr * gr)) * intensity;
      if (cr >= 0.004) { acc.x += cr; }
      if (cg >= 0.004) { acc.y += cg; }
      if (cb >= 0.004) { acc.z += cb; }
    } else {
      let v = exp(-d2 / (2.0 * gr * gr)) * intensity;
      if (v >= 0.004) { acc += vec3f(v, v, v); }
    }
  }

  // Diffraction streaks (anamorphic-weighted cross).
  if (streak > 0.0) {
    let sr = baseRadius * (4.0 + anamorphic * 6.0);
    let sw = max(1.0, baseRadius * 0.045 * (1.0 - anamorphic * 0.6));
    let a1 = atan2(uy, ux);
    let c1 = cos(a1);
    let s1 = sin(a1);
    let dx = fxx - lx;
    let dy = fyy - ly;
    let along = dx * c1 + dy * s1;
    let perp = -dx * s1 + dy * c1;
    let v1 = exp(-(along * along) / (2.0 * sr * sr)) * exp(-(perp * perp) / (2.0 * max(0.6, sw * sw))) * streak * 0.9 * bf;
    if (v1 >= 0.004) { acc += vec3f(v1, v1, v1); }
    let a2 = atan2(ux, -uy);
    let c2 = cos(a2);
    let s2 = sin(a2);
    let sr2 = sr * (1.0 + anamorphic);
    let sw2 = sw * (1.0 + anamorphic);
    let along2 = dx * c2 + dy * s2;
    let perp2 = -dx * s2 + dy * c2;
    let v2 = exp(-(along2 * along2) / (2.0 * sr2 * sr2)) * exp(-(perp2 * perp2) / (2.0 * max(0.6, sw2 * sw2))) * streak * 0.5 * bf;
    if (v2 >= 0.004) { acc += vec3f(v2, v2, v2); }
  }

  // Aperture polygon star.
  if (blades >= 3) {
    let ar = baseRadius * 1.5;
    let inner = ar * 0.82;
    let dx = fxx - lx;
    let dy = fyy - ly;
    let dist = sqrt(dx * dx + dy * dy);
    if (dist <= ar) {
      let ang = atan2(dy, dx) + apertureRotation;
      let sector = (ang / 3.141592653589793) * f32(blades);
      let f = abs(sector - round(sector));
      let radAtAngle = inner + (ar - inner) * (1.0 - f);
      let inside = select(exp(-((dist - radAtAngle) * (dist - radAtAngle)) / (2.0 * 0.8)), 1.0, dist <= radAtAngle);
      let v = inside * bf * 0.55 * 0.6;
      if (v >= 0.004) { acc += vec3f(v, v, v); }
    }
  }

  let s = textureLoad(src, vec2i(x, y), 0);
  textureStore(
    dst,
    vec2i(x, y),
    vec4f(
      clampByte(s.r * 255.0 + acc.x * 255.0),
      clampByte(s.g * 255.0 + acc.y * 255.0),
      clampByte(s.b * 255.0 + acc.z * 255.0),
      s.a * 255.0,
    ) / 255.0,
  );
}
`,
  buildPasses(request) {
    const q = request.params;
    const params = new Float32Array(13);
    let o = pack.f(params, 0, q.brightness, 1);
    o = pack.f(params, o, q.seed, 0);
    o = pack.f(params, o, q.scale, 1);
    o = pack.f(params, o, q.ghostCount, 4);
    o = pack.f(params, o, q.ghostSpacing, 0.8);
    o = pack.f(params, o, q.halo, 0.4);
    o = pack.f(params, o, q.apertureBlades, 0);
    o = pack.f(params, o, q.apertureRotation, 0);
    o = pack.f(params, o, q.streakIntensity, 0);
    o = pack.f(params, o, q.anamorphicRatio, 0);
    o = pack.f(params, o, q.chromaticDispersion, 0);
    const sx = typeof q.sourceX === 'number' && q.sourceX >= 0 && q.sourceX <= 1 ? q.sourceX : 0.5;
    const sy = typeof q.sourceY === 'number' && q.sourceY >= 0 && q.sourceY <= 1 ? q.sourceY : 0.5;
    o = pack.f(params, o, sx, 0.5);
    pack.f(params, o, sy, 0.5);
    return [
      {
        entry: 'lensFlareMain',
        params,
        textures: ['out', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};
