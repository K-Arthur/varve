/**
 * GPU-vs-CPU agreement harness for the live-effects compute kernels.
 *
 * Loaded by `tests/e2e/effects/gpu-agreement.spec.ts` inside a plain page
 * (no app boot). Exposes `window.__effectsHarness`:
 *
 *   run(effects: string[]): Promise<HarnessResult>
 *
 * For each effect it applies the CPU kernel and the GPU kernel to the same
 * deterministic input and reports per-effect delta statistics. The spec
 * asserts the bounds.
 */

import type { EffectDispatchRequest } from '@varve/engine/liveEffects';
import { cpuEffectProvider, dispatchLiveEffect } from '@varve/engine/liveEffects';
import { registerEffectKernels } from '../effects/kernels';
import { GpuEffectRunner } from '../effects/runner';

export interface HarnessCase {
  effect: EffectDispatchRequest['effect'];
  params: Record<string, unknown>;
  coordSpace?: {
    scale: number;
    originX: number;
    originY: number;
    regionX: number;
    regionY: number;
  };
}

export interface HarnessStats {
  meanAbs: number;
  maxAbs: number;
  p99: number;
  mismatchPixels: number;
  totalPixels: number;
  samples: number;
}

export interface HarnessResultEntry {
  effect: string;
  gpuReady: boolean;
  stats: HarnessStats | null;
  error?: string;
  head?: string;
}

export interface HarnessResult {
  entries: HarnessResultEntry[];
}

function makeInput(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  // Deterministic: gradient + blocks + noise (mulberry32(7)).
  let a = 7;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      let r = Math.round((x / (width - 1)) * 255);
      let g = Math.round((y / (height - 1)) * 255);
      let b = Math.round(((x + y) / (width + height - 2)) * 255);
      if (y < 6 && x > 20) {
        r = 220;
        g = 40;
        b = 40;
      } else if (y > 16 && x < 8) {
        r = 30;
        g = 30;
        b = 200;
      } else if (y > 14 && x > 22) {
        r = 250;
        g = 250;
        b = 250;
      }
      const n = (next() - 0.5) * 24;
      data[o] = Math.max(0, Math.min(255, Math.round(r + n)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
      data[o + 3] = 255;
    }
  }
  return data;
}

const COORD = { scale: 2, originX: 10, originY: 5, regionX: 4, regionY: 3 };

const WGSL_HELPERS2 = `// prefix
`;

const PROBE3G_KERNEL = {
  id: 'probe3g',
  wgsl:
    WGSL_HELPERS2 +
    `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

@compute @workgroup_size(8, 8, 1)
fn probe3gMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  if (gid.x < size.x && gid.y < size.y) {
    let s = textureLoad(src, vec2i(gid.xy), 0);
    if (p[0] > 999.0) { return; }
    textureStore(dst, vec2i(gid.xy), s);
  }
}
`,
  buildPasses() {
    return [
      {
        entry: 'probe3gMain',
        params: new Float32Array(3),
        textures: ['probe3gout', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};

const PROBE3H_KERNEL = {
  id: 'probe3h',
  wgsl:
    WGSL_HELPERS2 +
    `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

@compute @workgroup_size(8, 8, 1)
fn probe3hMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  if (gid.x < size.x && gid.y < size.y) {
    let s = textureLoad(src, vec2i(gid.xy), 0);
    var sum: f32 = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7];
    sum = sum + p[8] + p[9] + p[10] + p[11] + p[12] + p[13] + p[14];
    if (sum > 999.0) { return; }
    textureStore(dst, vec2i(gid.xy), s);
  }
}
`,
  buildPasses() {
    const params = new Float32Array(15);
    return [
      {
        entry: 'probe3hMain',
        params,
        textures: ['probe3hout', 'src'],
        sampler: 'nearest',
        workgroup: [8, 8, 1],
      },
    ];
  },
};

const PROBE3I_KERNEL = {
  id: 'probe3i',
  wgsl:
    WGSL_HELPERS2 +
    `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

fn sampleIt(tex: texture_2d<f32>, samp: sampler, x: f32, y: f32, w: i32, h: i32) -> vec4f {
  let u = (clamp(x, 0.0, f32(w - 1)) + 0.5) / f32(w);
  let v = (clamp(y, 0.0, f32(h - 1)) + 0.5) / f32(h);
  return textureSampleLevel(tex, samp, vec2f(u, v), 0.0);
}

@compute @workgroup_size(8, 8, 1)
fn probe3iMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  let w = i32(size.x);
  let h = i32(size.y);
  if (gid.x < size.x && gid.y < size.y) {
    let s = sampleIt(src, samp, f32(gid.x), f32(gid.y), w, h);
    if (p[0] > 999.0) { return; }
    textureStore(dst, vec2i(gid.xy), s);
  }
}
`,
  buildPasses() {
    return [
      {
        entry: 'probe3iMain',
        params: new Float32Array(3),
        textures: ['probe3iout', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};

const HELPERS_LOCAL = `
fn hash2(x: i32, y: i32, seed: u32) -> f32 {
  var h: u32 = seed ^ (bitcast<u32>(x) * 0x27d4eb2du) ^ (bitcast<u32>(y) * 0x165667b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = h ^ (h >> 13u);
  h = (h ^ (h >> 16u)) * 0xc2b2ae35u;
  h = h ^ (h >> 16u);
  return f32(h) / 4294967296.0;
}

fn clampByte(v: f32) -> f32 {
  return clamp(v, 0.0, 255.0);
}
`;

const PROBE3J_KERNEL = {
  id: 'probe3j',
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
  buildPasses() {
    const params = new Float32Array(15);
    params[1] = 4;
    params[2] = -2;
    params[3] = 0;
    params[4] = 0;
    params[5] = -3;
    params[6] = 2;
    params[13] = 1;
    params[14] = 2;
    return [
      {
        entry: 'probe3jMain',
        params,
        textures: ['probe3jout', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};

const PROBE3F_KERNEL = {
  id: 'probe3f',
  wgsl:
    WGSL_HELPERS2 +
    `
@group(0) @binding(0) var<storage, read_write> p: array<f32, 128>;
@group(2) @binding(0) var dst: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var src: texture_2d<f32>;
@group(2) @binding(2) var samp: sampler;

@compute @workgroup_size(8, 8, 1)
fn probe3fMain(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(src);
  if (gid.x < size.x && gid.y < size.y) {
    let u = (f32(gid.x) + 0.5) / f32(size.x);
    let v = (f32(gid.y) + 0.5) / f32(size.y);
    let s = textureSampleLevel(src, samp, vec2f(u, v), 0.0);
    if (p[0] > 999.0) { return; }
    textureStore(dst, vec2i(gid.xy), s);
  }
}
`,
  buildPasses() {
    return [
      {
        entry: 'probe3fMain',
        params: new Float32Array(3),
        textures: ['probe3fout', 'src'],
        sampler: 'linear',
        workgroup: [8, 8, 1],
      },
    ];
  },
};

const CASES: Record<string, HarnessCase> = {
  probe3f: { effect: 'rgbSplit', params: { mode: 'offset', borderMode: 'clamp', intensity: 0 } },
  probe3g: { effect: 'rgbSplit', params: { mode: 'offset', borderMode: 'clamp', intensity: 0 } },
  probe3h: { effect: 'rgbSplit', params: { mode: 'offset', borderMode: 'clamp', intensity: 0 } },
  probe3i: { effect: 'rgbSplit', params: { mode: 'offset', borderMode: 'clamp', intensity: 0 } },
  probe3j: {
    effect: 'rgbSplit',
    params: {
      mode: 'radial',
      amount: 6,
      centerX: 0.6,
      centerY: 0.4,
      falloff: 0.8,
      fringeAngle: 25,
      borderMode: 'transparent',
      intensity: 0.8,
      quality: 'auto',
    },
    coordSpace: COORD,
  },
  paletteSnap: {
    effect: 'paletteSnap',
    params: {
      colors: [
        [10, 10, 10],
        [90, 90, 90],
        [180, 180, 180],
        [250, 250, 250],
        [200, 60, 60],
      ],
      metric: 'rgb',
      amount: 1,
      dither: true,
      ditherAlgorithm: 'bayer',
      ditherStrength: 0.6,
      alphaCutoff: 0,
      seed: 2,
      quality: 'auto',
    },
  },
  rgbSplit: {
    effect: 'rgbSplit',
    params: {
      mode: 'radial',
      amount: 6,
      centerX: 0.6,
      centerY: 0.4,
      falloff: 0.8,
      fringeAngle: 25,
      borderMode: 'transparent',
      intensity: 0.8,
      quality: 'auto',
    },
    coordSpace: COORD,
  },
  crt: {
    effect: 'crt',
    params: {
      curvature: 0.4,
      cornerRadius: 0.4,
      scanlinePeriod: 3,
      scanlineStrength: 0.6,
      scanlineSoftness: 0.5,
      phosphorMask: 'rgb-stripe',
      phosphorPitch: 2,
      phosphorIntensity: 0.5,
      glow: 0.3,
      vignette: 0.4,
      vignetteRadius: 0.6,
      convergenceX: 0.4,
      convergenceY: 0.2,
      brightness: 0.05,
      contrast: 1.1,
      quality: 'auto',
    },
  },
  vhs: {
    effect: 'vhs',
    params: {
      lumaNoise: 0.5,
      chromaNoise: 0.4,
      chromaBleed: 0.5,
      jitter: 0.4,
      tracking: 0.5,
      dropouts: 0.3,
      headSwitching: 0.4,
      tearing: 0.3,
      signalBlur: 0.3,
      timeInstability: 0.4,
      seed: 11,
      time: 0.5,
      frameRate: 24,
      quality: 'auto',
    },
  },
  lightShafts: {
    effect: 'lightShafts',
    params: {
      lightX: 0.3,
      lightY: 0.2,
      lightType: 'point',
      intensity: 1.2,
      exposure: 0.1,
      decay: 0.3,
      density: 0.5,
      weight: 0.8,
      sampleCount: 24,
      scattering: 0.4,
      tint: [255, 220, 180],
      occlusionSource: 'luminance',
      quality: 'auto',
    },
  },
  lensFlare: {
    effect: 'lensFlare',
    params: {
      sourceX: 0.7,
      sourceY: 0.35,
      brightness: 1.2,
      scale: 0.8,
      ghostCount: 4,
      ghostSpacing: 1.2,
      halo: 0.5,
      apertureBlades: 6,
      apertureRotation: 15,
      streakIntensity: 0.4,
      anamorphicRatio: 0.2,
      chromaticDispersion: 0.5,
      seed: 17,
      quality: 'auto',
    },
  },
  lightLeak: {
    effect: 'lightLeak',
    params: {
      seed: 23,
      x: 0.2,
      y: 0.3,
      angle: 35,
      size: 0.8,
      softness: 0.5,
      hue: 30,
      saturation: 0.8,
      lightness: 0.6,
      intensity: 1.2,
      noiseScale: 0.5,
      quality: 'auto',
    },
  },
  caustics: {
    effect: 'caustics',
    params: {
      scale: 2,
      depth: 0.5,
      waveCount: 4,
      complexity: 0.5,
      refractionAmount: 0.6,
      sharpness: 0.5,
      lightAngle: 45,
      brightness: 1.1,
      contrast: 1.2,
      dispersion: 0.3,
      distortionAmount: 0.4,
      output: 'combined',
      waterTint: [30, 120, 200],
      surfaceTint: null,
      seed: 31,
      time: 0.25,
      animationSpeed: 0.5,
      tileable: false,
      quality: 'auto',
      kx: 0,
      ky: 0,
      phase: 0,
      speed: 0,
      amp: 0,
    },
    coordSpace: COORD,
  },
  bloom: {
    effect: 'bloom',
    params: {
      threshold: 0.6,
      softKnee: 0.3,
      intensity: 1.5,
      radius: 6,
      diffusion: 0.5,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: false,
      streakAngle: 0,
      streakLength: 0,
      streakIntensity: 0.5,
      streakAspect: 2,
      quality: 'auto',
    },
    coordSpace: COORD,
  },
};

function statsOf(cpu: Uint8ClampedArray, gpu: Uint8ClampedArray): HarnessStats {
  const n = Math.min(cpu.length, gpu.length) / 4;
  let sum = 0;
  let maxAbs = 0;
  let mismatchPixels = 0;
  const deltas: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const o = i * 4;
    let worst = 0;
    for (let c = 0; c < 4; c += 1) {
      const d = Math.abs((cpu[o + c] ?? 0) - (gpu[o + c] ?? 0));
      if (d > worst) worst = d;
    }
    sum += worst;
    if (worst > maxAbs) maxAbs = worst;
    if (worst > 4) mismatchPixels += 1;
    deltas.push(worst);
  }
  deltas.sort((a, b) => a - b);
  const p99 = deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * 0.99))] ?? 0;
  return {
    meanAbs: sum / n,
    maxAbs,
    p99,
    mismatchPixels,
    totalPixels: n,
    samples: n,
  };
}

async function runOne(
  runner: GpuEffectRunner,
  name: string,
  caseSpec: HarnessCase,
  width: number,
  height: number,
): Promise<HarnessResultEntry> {
  const input = makeInput(width, height);
  const effectName =
    name === 'probe3f' ||
    name === 'probe3g' ||
    name === 'probe3h' ||
    name === 'probe3i' ||
    name === 'probe3j'
      ? (name as never)
      : caseSpec.effect;
  const request: EffectDispatchRequest = {
    effect: effectName,
    width,
    height,
    quality: 'normal',
    coordSpace: caseSpec.coordSpace,
    params: caseSpec.params,
  };
  const cpu = await dispatchLiveEffect(request, input, [cpuEffectProvider]);
  try {
    const gpu = await runner.apply(request, input);
    const stats = statsOf(cpu, gpu);
    const head = name === 'rgbSplit' ? Array.from(gpu.slice(0, 24)).join(',') : undefined;
    return { effect: name, gpuReady: true, stats, head };
  } catch (error) {
    return {
      effect: name,
      gpuReady: true,
      stats: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runHarness(
  effects: string[],
  options?: { width?: number; height?: number; requireHardwareAdapter?: boolean },
): Promise<HarnessResult> {
  const width = options?.width ?? 48;
  const height = options?.height ?? 32;
  const runner = new GpuEffectRunner();
  registerEffectKernels(runner);
  runner.register(PROBE3F_KERNEL as never);
  runner.register(PROBE3G_KERNEL as never);
  runner.register(PROBE3H_KERNEL as never);
  runner.register(PROBE3I_KERNEL as never);
  runner.register(PROBE3J_KERNEL as never);
  const ok = await runner.init({
    requireHardwareAdapter: options?.requireHardwareAdapter ?? false,
  });
  if (!ok) {
    return {
      entries: effects.map((e) => ({ effect: e, gpuReady: false, stats: null })),
    };
  }
  const entries: HarnessResultEntry[] = [];
  for (const name of effects) {
    const caseSpec = CASES[name];
    if (!caseSpec) {
      entries.push({ effect: name, gpuReady: true, stats: null, error: 'unknown case' });
      continue;
    }
    entries.push(await runOne(runner, name, caseSpec, width, height));
  }
  runner.destroy();
  return { entries };
}

declare global {
  interface Window {
    __effectsHarness: {
      run: (effects: string[]) => Promise<HarnessResult>;
      cpuOnly: (name: string) => Promise<HarnessStats | null>;
      effectNames: () => string[];
    };
  }
}

window.__effectsHarness = {
  run: (effects: string[]) => runHarness(effects),
  cpuOnly: async (name: string) => {
    const caseSpec = CASES[name];
    if (!caseSpec) return null;
    const input = makeInput(48, 32);
    const request: EffectDispatchRequest = {
      effect: caseSpec.effect,
      width: 48,
      height: 32,
      quality: 'normal',
      coordSpace: caseSpec.coordSpace,
      params: caseSpec.params,
    };
    const cpu = await dispatchLiveEffect(request, input, [cpuEffectProvider]);
    return statsOf(cpu, cpu);
  },
  effectNames: () => Object.keys(CASES),
};
