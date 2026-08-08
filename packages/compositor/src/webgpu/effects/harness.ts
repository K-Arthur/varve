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
 *
 * Note on this Dawn build (observed on Chromium 1228 headless + RADV):
 * - read-only storage buffers (`var<storage, read>`) silently no-op the
 *   dispatch — kernels MUST declare `read_write`.
 * - a shader entry point that doesn't exist in the module silently no-ops
 *   the dispatch (no throw) — keep entry names in sync.
 * - pipelines with unbound bind-group layouts can no-op — the runner always
 *   binds the palette group.
 */

import type { EffectDispatchRequest } from '@varve/engine/liveEffects';
import { cpuEffectProvider, dispatchLiveEffect } from '@varve/engine/liveEffects';
import { registerEffectKernels } from './kernels';
import { GpuEffectRunner } from './runner';

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

const CASES: Record<string, HarnessCase> = {
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
      borderMode: 'mirror',
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
  const request: EffectDispatchRequest = {
    effect: caseSpec.effect,
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
    return { effect: name, gpuReady: true, stats };
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
  const ok = await runner.init({
    requireHardwareAdapter: options?.requireHardwareAdapter ?? false,
  });
  if (!ok) {
    return {
      entries: effects.map((e) => ({ effect: e, gpuReady: false, stats: null })),
    };
  }
  try {
    const warm = CASES.rgbSplit ?? Object.values(CASES)[0];
    if (warm) {
      const warmReq: EffectDispatchRequest = {
        effect: warm.effect,
        width: 8,
        height: 8,
        quality: 'normal',
        coordSpace: warm.coordSpace,
        params: warm.params,
      };
      const warmInput = makeInput(8, 8);
      await runner.apply(warmReq, warmInput);
    }
  } catch {
    // Warm-up failure is non-fatal; the real cases will surface it.
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
