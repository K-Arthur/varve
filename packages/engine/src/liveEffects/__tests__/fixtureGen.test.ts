/**
 * Fixture generator for the native (Rust) effect kernel agreement tests.
 *
 * Runs ONLY when GENERATE_EFFECT_FIXTURES=1:
 *   GENERATE_EFFECT_FIXTURES=1 pnpm --filter @varve/engine test -- fixtureGen
 *
 * Applies the TS reference kernels to deterministic inputs and writes the
 * (input, params, expected output) triplets to
 * `crates/varve-effects/tests/fixtures/` where the Rust integration tests
 * replay them through `apply_effect`. This is the byte-level contract between
 * the TS reference implementation and the native port.
 *
 * Tolerance classes:
 *   exact    — arithmetic-only kernels (dither, paletteSnap, rgbSplit):
 *              byte-identical output expected.
 *   maxDelta — transcendental kernels (pow/trig): the Rust port may differ by
 *              a few code values per channel; the manifest records the bound.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyBloom } from '../bloom';
import { applyCaustics } from '../caustics';
import { applyCrt } from '../crt';
import { applyDither } from '../dither';
import { applyLensFlare } from '../lensFlare';
import { applyLightLeak } from '../lightLeak';
import { applyLightShafts } from '../lightShafts';
import { applyPaletteSnap } from '../paletteSnap';
import { mulberry32 } from '../prng';
import { applyRgbSplit } from '../rgbSplit';
import { applyVhs } from '../vhs';

type FixtureCase = {
  name: string;
  effect: string;
  width: number;
  height: number;
  quality: 'interactive' | 'normal' | 'export';
  coordSpace:
    | { scale: number; originX: number; originY: number; regionX: number; regionY: number }
    | undefined;
  params: Record<string, unknown>;
  input: number[];
  expected: number[];
  tolerance: { mode: 'exact' | 'maxDelta'; maxDelta: number };
};

const GENERATING = process.env.GENERATE_EFFECT_FIXTURES === '1';

/** Deterministic 32x24 input: vertical gradient + colour blocks + seeded noise. */
function makeInput(): { data: number[]; width: number; height: number } {
  const width = 32;
  const height = 24;
  const data = new Array<number>(width * height * 4);
  const rng = mulberry32(7);
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
      const n = (rng() - 0.5) * 24;
      data[o] = Math.max(0, Math.min(255, Math.round(r + n)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

const COORD = { scale: 2, originX: 10, originY: 5, regionX: 4, regionY: 3 };

const NO_COORD = undefined;

const cases: FixtureCase[] = [
  {
    name: 'dither-bayer',
    effect: 'dither',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
    params: {
      algorithm: 'bayer',
      paletteMode: 'none',
      levels: 4,
      colors: [],
      metric: 'rgb',
      serpentine: false,
      strength: 1,
      bayerSize: 4,
      cellSize: 2,
      alphaCutoff: 0,
      seed: 3,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'dither-floyd',
    effect: 'dither',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
    params: {
      algorithm: 'floyd-steinberg',
      paletteMode: 'levels',
      levels: 3,
      colors: [],
      metric: 'lab',
      serpentine: true,
      strength: 0.8,
      bayerSize: 4,
      cellSize: 1,
      alphaCutoff: 0.5,
      seed: 5,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'paletteSnap-custom',
    effect: 'paletteSnap',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      colors: [
        [0, 0, 0],
        [255, 255, 255],
        [255, 0, 0],
        [0, 255, 0],
        [0, 0, 255],
        [255, 255, 0],
      ],
      metric: 'oklab',
      amount: 0.9,
      dither: false,
      ditherAlgorithm: 'bayer',
      ditherStrength: 0.5,
      alphaCutoff: 0,
      seed: 1,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'paletteSnap-dither',
    effect: 'paletteSnap',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
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
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'rgbSplit-offset',
    effect: 'rgbSplit',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
    params: {
      mode: 'offset',
      redX: 4,
      redY: -2,
      greenX: 0,
      greenY: 0,
      blueX: -3,
      blueY: 2,
      amount: 8,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'clamp',
      intensity: 1,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'rgbSplit-radial',
    effect: 'rgbSplit',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
    params: {
      mode: 'radial',
      redX: 0,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: 0,
      blueY: 0,
      amount: 6,
      centerX: 0.6,
      centerY: 0.4,
      falloff: 0.8,
      fringeAngle: 25,
      borderMode: 'mirror',
      intensity: 0.8,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'exact', maxDelta: 0 },
  },
  {
    name: 'crt-classic',
    effect: 'crt',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      curvature: 0.3,
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
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 2 },
  },
  {
    name: 'crt-mask',
    effect: 'crt',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      curvature: 0.5,
      cornerRadius: 0.2,
      scanlinePeriod: 2,
      scanlineStrength: 0.8,
      scanlineSoftness: 0.2,
      phosphorMask: 'shadow-mask',
      phosphorPitch: 3,
      phosphorIntensity: 0.7,
      glow: 0.5,
      vignette: 0.7,
      vignetteRadius: 0.5,
      convergenceX: 0.6,
      convergenceY: 0.1,
      brightness: -0.1,
      contrast: 1.3,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 2 },
  },
  {
    name: 'bloom-normal',
    effect: 'bloom',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
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
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'bloom-streak',
    effect: 'bloom',
    width: 32,
    height: 24,
    quality: 'export',
    coordSpace: COORD,
    params: {
      threshold: 0.5,
      softKnee: 0.2,
      intensity: 2,
      radius: 4,
      diffusion: 0.7,
      tint: [255, 200, 150],
      tintAmount: 0.4,
      composite: 'add',
      streakEnabled: true,
      streakAngle: 30,
      streakLength: 12,
      streakIntensity: 0.6,
      streakAspect: 3,
      quality: 'auto',
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'vhs-default',
    effect: 'vhs',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
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
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'vhs-heavy',
    effect: 'vhs',
    width: 32,
    height: 24,
    quality: 'export',
    coordSpace: NO_COORD,
    params: {
      lumaNoise: 0.8,
      chromaNoise: 0.7,
      chromaBleed: 0.8,
      jitter: 0.7,
      tracking: 0.8,
      dropouts: 0.6,
      headSwitching: 0.7,
      tearing: 0.6,
      signalBlur: 0.6,
      timeInstability: 0.7,
      seed: 13,
      time: 1.25,
      frameRate: 30,
      quality: 'auto',
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lightShafts-point',
    effect: 'lightShafts',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      lightX: 0.3,
      lightY: 0.2,
      lightType: 'point',
      direction: 0,
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
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lightShafts-directional',
    effect: 'lightShafts',
    width: 32,
    height: 24,
    quality: 'interactive',
    coordSpace: NO_COORD,
    params: {
      lightX: 0.5,
      lightY: 0.5,
      lightType: 'directional',
      direction: 45,
      intensity: 1.8,
      exposure: -0.2,
      decay: 0.5,
      density: 0.7,
      weight: 0.6,
      sampleCount: 16,
      scattering: 0.6,
      tint: null,
      occlusionSource: 'alpha',
      quality: 'auto',
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lensFlare-auto',
    effect: 'lensFlare',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      sourceX: -1,
      sourceY: -1,
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
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lensFlare-fixed',
    effect: 'lensFlare',
    width: 32,
    height: 24,
    quality: 'export',
    coordSpace: NO_COORD,
    params: {
      sourceX: 0.7,
      sourceY: 0.35,
      brightness: 1.6,
      scale: 1.2,
      ghostCount: 6,
      ghostSpacing: 1.6,
      halo: 0.8,
      apertureBlades: 0,
      apertureRotation: 0,
      streakIntensity: 0.7,
      anamorphicRatio: 0.6,
      chromaticDispersion: 0.8,
      seed: 19,
      quality: 'auto',
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lightLeak-warm',
    effect: 'lightLeak',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
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
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'lightLeak-cool',
    effect: 'lightLeak',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: NO_COORD,
    params: {
      seed: 29,
      x: 0.8,
      y: 0.7,
      angle: -60,
      size: 1.4,
      softness: 0.8,
      hue: 210,
      saturation: 0.9,
      lightness: 0.4,
      intensity: 0.9,
      noiseScale: 1,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'caustics-pool',
    effect: 'caustics',
    width: 32,
    height: 24,
    quality: 'normal',
    coordSpace: COORD,
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
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
  {
    name: 'caustics-tileable',
    effect: 'caustics',
    width: 32,
    height: 24,
    quality: 'export',
    coordSpace: COORD,
    params: {
      scale: 3,
      depth: 0.7,
      waveCount: 5,
      complexity: 0.7,
      refractionAmount: 0.8,
      sharpness: 0.7,
      lightAngle: 60,
      brightness: 1.3,
      contrast: 1.4,
      dispersion: 0.5,
      distortionAmount: 0.6,
      output: 'lighting',
      waterTint: null,
      surfaceTint: [200, 220, 255],
      seed: 37,
      time: 0.8,
      animationSpeed: 1,
      tileable: true,
      quality: 'auto',
      kx: 0,
      ky: 0,
      phase: 0,
      speed: 0,
      amp: 0,
    },
    input: [],
    expected: [],
    tolerance: { mode: 'maxDelta', maxDelta: 3 },
  },
];

function toImageData(input: number[], width: number, height: number): ImageData {
  return new ImageData(new Uint8ClampedArray(input), width, height);
}

const RUNNERS: Record<
  string,
  (img: ImageData, params: Record<string, unknown>, coord?: unknown, quality?: string) => ImageData
> = {
  dither: (img, p, coord) => applyDither(img, p as never, coord as never),
  paletteSnap: (img, p) => applyPaletteSnap(img, p as never),
  bloom: (img, p, coord, q) =>
    applyBloom(img, p as never, { quality: (q ?? 'normal') as never, coordSpace: coord as never }),
  rgbSplit: (img, p, coord) => applyRgbSplit(img, p as never, coord as never),
  crt: (img, p) => applyCrt(img, p as never),
  vhs: (img, p, _c, q) => applyVhs(img, p as never, { quality: (q ?? 'normal') as never }),
  lightShafts: (img, p, _c, q) =>
    applyLightShafts(img, p as never, { quality: (q ?? 'normal') as never }),
  lensFlare: (img, p, _c, q) =>
    applyLensFlare(img, p as never, { quality: (q ?? 'normal') as never }),
  lightLeak: (img, p) => applyLightLeak(img, p as never),
  caustics: (img, p, coord, q) =>
    applyCaustics(img, p as never, {
      quality: (q ?? 'normal') as never,
      coordSpace: coord as never,
    }),
};

describe('effect fixture generation (GENERATE_EFFECT_FIXTURES=1)', () => {
  it('writes fixtures for all cases', () => {
    if (!GENERATING) {
      return;
    }
    const { data: input, width, height } = makeInput();
    const outDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../..',
      'crates/varve-effects/tests/fixtures',
    );
    mkdirSync(outDir, { recursive: true });

    const manifest: Array<{ name: string; file: string }> = [];
    for (const c of cases) {
      const runner = RUNNERS[c.effect];
      if (!runner) throw new Error(`No runner for ${c.effect}`);
      const img = toImageData(input, width, height);
      const result = runner(img, c.params, c.coordSpace, c.quality);
      const expected = Array.from(result.data);
      const fixture: FixtureCase = { ...c, input, expected };
      const file = `${c.name}.json`;
      writeFileSync(join(outDir, file), JSON.stringify(fixture));
      manifest.push({ name: c.name, file });
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ cases: manifest }, null, 2));
    // A real assertion so the test is meaningful in gated mode.
    expect(manifest.length).toBeGreaterThan(0);
  });
});
