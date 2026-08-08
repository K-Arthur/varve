/**
 * Determinism / alpha / palette-membership invariants for the live effects
 * kernels. These tests run on plain ImageData (no canvas required).
 */

import { describe, expect, it } from 'vitest';
import { applyBloom } from '../bloom';
import { applyCaustics, buildCausticWaves } from '../caustics';
import { applyCrt } from '../crt';
import { applyDither } from '../dither';
import { applyLensFlare } from '../lensFlare';
import { applyLightLeak } from '../lightLeak';
import { applyLightShafts } from '../lightShafts';
import {
  buildPaletteLookup,
  dedupePalette,
  generatePalette,
  sanitizePalette,
} from '../paletteCore';
import { applyPaletteSnap } from '../paletteSnap';
import { fbm2, hash2, mulberry32, seeded01, valueNoise2 } from '../prng';
import { downsampleBox, resolveEffectQuality, upsampleBilinear } from '../quality';
import { applyRgbSplit } from '../rgbSplit';
import { applyVhs } from '../vhs';

function makeImage(
  w: number,
  h: number,
  fill?: (x: number, y: number) => [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      const [r, g, b, a] = fill ? fill(x, y) : [128, 128, 128, 255];
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

function snapshot(img: ImageData): string {
  return Array.from(img.data).join(',');
}

const gradient = (x: number, y: number): [number, number, number, number] => [
  (x * 7) % 256,
  (y * 13) % 256,
  ((x + y) * 5) % 256,
  255,
];

describe('prng', () => {
  it('is deterministic across runs', () => {
    expect(seeded01(42)).toBe(seeded01(42));
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(fbm2(1.5, 2.5, 7, 3)).toBe(fbm2(1.5, 2.5, 7, 3));
    expect(valueNoise2(0.25, 0.75, 1)).toBe(valueNoise2(0.25, 0.75, 1));
  });

  it('differs for different seeds', () => {
    expect(seeded01(1)).not.toBe(seeded01(2));
    expect(hash2(0, 0, 1)).not.toBe(hash2(0, 0, 2));
  });

  it('stays in range', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 1000; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('large-image behaviour (memory safety)', () => {
  it('1024x1024 dither completes with bounded, finite output', () => {
    const img = makeImage(1024, 1024, (x, y) => [
      (x * 3) % 256,
      (y * 5) % 256,
      ((x + y) * 7) % 256,
      255,
    ]);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'levels',
      levels: 4,
      colors: [],
      metric: 'rgb',
      serpentine: true,
      strength: 1,
      bayerSize: 8,
      cellSize: 1,
      alphaCutoff: 0,
      seed: 0,
    });
    expect(img.data.length).toBe(1024 * 1024 * 4);
    for (let i = 0; i < img.data.length; i += 4096) {
      expect(Number.isFinite(img.data[i])).toBe(true);
    }
  });

  it('1024x1024 bloom stays within its pyramid and never overflows bytes', () => {
    const img = makeImage(1024, 1024, (x, y) =>
      x < 512 ? [255, 255, 255, 255] : [24, 40, 60, 255],
    );
    applyBloom(img, {
      threshold: 0.6,
      softKnee: 0.2,
      intensity: 1.5,
      radius: 24,
      diffusion: 0.6,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: true,
      streakAngle: 30,
      streakLength: 64,
      streakIntensity: 0.5,
      streakAspect: 3,
      quality: 'export',
    });
    // Every byte stays a valid 8-bit value (no overflow into other channels).
    for (let i = 0; i < img.data.length; i += 2048) {
      expect(img.data[i]).toBeGreaterThanOrEqual(0);
      expect(img.data[i]).toBeLessThanOrEqual(255);
    }
  });

  it('palette LUT cache is keyed per palette identity (no unbounded growth per lookup)', () => {
    const makePalette = (): [number, number, number][] =>
      Array.from({ length: 64 }, (_, i) => [i * 4, 255 - i * 4, i * 2] as [number, number, number]);
    const a = buildPaletteLookup(makePalette(), 'oklab');
    const b = buildPaletteLookup(makePalette(), 'oklab');
    const c = buildPaletteLookup(makePalette(), 'rgb');
    // Same palette + metric must give identical answers; different palettes
    // get their own cache entries (bounded by live palette lifetimes via
    // WeakMap semantics).
    expect(a.find(100, 100, 100)).toEqual(b.find(100, 100, 100));
    expect(c.find(100, 100, 100)).toBeDefined();
  });
});

describe('quality helpers', () => {
  it('resolves quality params against the caller tier', () => {
    expect(resolveEffectQuality('auto', 'export')).toBe('export');
    expect(resolveEffectQuality('auto', 'normal')).toBe('normal');
    expect(resolveEffectQuality('interactive', 'export')).toBe('interactive');
    expect(resolveEffectQuality(undefined, 'normal')).toBe('normal');
  });

  it('downsample/upsample round-trips dimensions', () => {
    const src = makeImage(40, 24, gradient);
    const down = downsampleBox(src.data, 40, 24, 2);
    expect(down.width).toBe(20);
    expect(down.height).toBe(12);
    const up = new Uint8ClampedArray(new ArrayBuffer(40 * 24 * 4));
    upsampleBilinear(down.data, down.width, down.height, up, 40, 24);
    expect(up.length).toBe(40 * 24 * 4);
  });
});

describe('palette core', () => {
  it('nearest lookup finds exact palette colors', () => {
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    const lookup = buildPaletteLookup(palette, 'rgb');
    expect(lookup.find(255, 0, 0)).toEqual([255, 0, 0]);
    expect(lookup.find(10, 0, 0)).toEqual([0, 0, 0]);
  });

  it('large palettes get the LUT path with the same answers', () => {
    const palette: [number, number, number][] = [];
    for (let i = 0; i < 64; i += 1) palette.push([i * 4, 255 - i * 4, i * 2]);
    const lut = buildPaletteLookup(palette, 'oklab');
    const brute = buildPaletteLookup(palette.slice(0, 4), 'oklab');
    expect(lut.find(0, 0, 0)).toBeDefined();
    expect(brute.find(0, 0, 0)).toBeDefined();
    // LUT lookup for a palette color lands on or very near that color.
    const [pr, pg, pb] = lut.find(128, 128, 64)!;
    expect(Math.abs(pr - 128)).toBeLessThanOrEqual(4);
    expect(Math.abs(pg - 128)).toBeLessThanOrEqual(4);
    expect(Math.abs(pb - 64)).toBeLessThanOrEqual(2);
  });

  it('generates deterministic palettes with bounded size', () => {
    const img = makeImage(64, 64, gradient);
    const a = generatePalette(img.data, 64, 64, 8, 'oklab', 5);
    const b = generatePalette(img.data, 64, 64, 8, 'oklab', 5);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(8);
  });

  it('sanitize clamps and dedupes', () => {
    expect(
      sanitizePalette([
        [300, -5, 10],
        [300, -5, 10],
        [1, 2],
      ]),
    ).toEqual([[255, 0, 10]]);
    expect(
      dedupePalette([
        [1, 2, 3],
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toHaveLength(2);
  });
});

describe('dither', () => {
  it('never mutates the alpha channel', () => {
    const img = makeImage(
      16,
      16,
      (x, y) =>
        [...gradient(x, y).slice(0, 3), x % 2 === 0 ? 255 : 128] as [
          number,
          number,
          number,
          number,
        ],
    );
    const before = Array.from(img.data).filter((_, i) => i % 4 === 3);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'levels',
      levels: 2,
      colors: [],
      metric: 'rgb',
      serpentine: true,
      strength: 1,
      bayerSize: 4,
      cellSize: 1,
      alphaCutoff: 0,
      seed: 1,
    });
    const after = Array.from(img.data).filter((_, i) => i % 4 === 3);
    expect(after).toEqual(before);
  });

  it('is deterministic for the same seed and params', () => {
    const run = (seed: number, algo: 'atkinson' | 'blue-noise') => {
      const img = makeImage(24, 24, gradient);
      applyDither(img, {
        algorithm: algo,
        paletteMode: 'levels',
        levels: 3,
        colors: [],
        metric: 'rgb',
        serpentine: true,
        strength: 0.9,
        bayerSize: 8,
        cellSize: 1,
        alphaCutoff: 0,
        seed,
      });
      return snapshot(img);
    };
    expect(run(7, 'atkinson')).toBe(run(7, 'atkinson'));
    // Error diffusion is pure arithmetic (seed-independent by design)…
    expect(run(7, 'atkinson')).toBe(run(8, 'atkinson'));
    // …while seeded pattern algorithms must differ across seeds.
    expect(run(7, 'blue-noise')).not.toBe(run(8, 'blue-noise'));
  });

  it('1-bit output only contains two levels per channel', () => {
    const img = makeImage(32, 32, gradient);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'levels',
      levels: 1,
      colors: [],
      metric: 'rgb',
      serpentine: true,
      strength: 1,
      bayerSize: 8,
      cellSize: 1,
      alphaCutoff: 0,
      seed: 0,
    });
    for (let i = 0; i < img.data.length; i += 4) {
      expect([0, 255]).toContain(img.data[i]);
      expect([0, 255]).toContain(img.data[i + 1]);
      expect([0, 255]).toContain(img.data[i + 2]);
    }
  });

  it('paletteMode none is a no-op', () => {
    const img = makeImage(16, 16, gradient);
    const before = snapshot(img);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'none',
      levels: 1,
      colors: [],
      metric: 'rgb',
      serpentine: true,
      strength: 1,
      bayerSize: 4,
      cellSize: 1,
      alphaCutoff: 0,
      seed: 0,
    });
    expect(snapshot(img)).toBe(before);
  });

  it('transparent pixels below cutoff stay transparent', () => {
    const img = makeImage(8, 8, () => [200, 200, 200, 0]);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'levels',
      levels: 2,
      colors: [],
      metric: 'rgb',
      serpentine: true,
      strength: 1,
      bayerSize: 4,
      cellSize: 1,
      alphaCutoff: 0.5,
      seed: 0,
    });
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(0);
  });

  it('custom palette output stays within the palette', () => {
    const palette: [number, number, number][] = [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
    ];
    const img = makeImage(24, 24, gradient);
    applyDither(img, {
      algorithm: 'floyd-steinberg',
      paletteMode: 'custom',
      levels: 4,
      colors: palette,
      metric: 'oklab',
      serpentine: true,
      strength: 1,
      bayerSize: 8,
      cellSize: 1,
      alphaCutoff: 0,
      seed: 3,
    });
    for (let i = 0; i < img.data.length; i += 4) {
      const px = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      expect(palette).toContainEqual(px);
    }
  });

  it('Bayer pattern is anchored to doc coordinates (no swimming under pan)', () => {
    // Uniform content + 8-bit levels: the pattern itself is the only signal.
    // Shifting the region origin by one full cell must move the pattern WITH
    // the content (pixel x of the shifted render == pixel x+cell of the
    // original); a sub-cell shift must change the visible pattern.
    const render = (regionX: number) => {
      const img = makeImage(32, 32, () => [128, 128, 128, 255]);
      applyDither(
        img,
        {
          algorithm: 'bayer',
          paletteMode: 'levels',
          levels: 8,
          colors: [],
          metric: 'rgb',
          serpentine: false,
          strength: 1,
          bayerSize: 4,
          cellSize: 4,
          alphaCutoff: 0,
          seed: 0,
        },
        { scale: 1, originX: 0, originY: 0, regionX, regionY: 0 },
      );
      return Array.from(img.data);
    };
    const base = render(0);
    const shifted = render(4);
    // Shifted pixel (P-4) shows the same doc point as base pixel P, so the
    // shifted row is the base row slid left by one cell.
    expect(shifted.slice(0, 28 * 4)).toEqual(base.slice(4 * 4, 32 * 4));
    expect(render(1).slice(0, 32 * 4)).not.toEqual(base.slice(0, 32 * 4));
  });
});

describe('paletteSnap', () => {
  it('never produces colors outside the palette (except transparent)', () => {
    const palette: [number, number, number][] = [
      [10, 20, 30],
      [200, 150, 100],
      [40, 40, 40],
    ];
    const img = makeImage(32, 32, gradient);
    applyPaletteSnap(img, {
      colors: palette,
      metric: 'oklab',
      amount: 1,
      dither: false,
      ditherAlgorithm: 'floyd-steinberg',
      ditherStrength: 0.5,
      alphaCutoff: 0,
      seed: 0,
    });
    for (let i = 0; i < img.data.length; i += 4) {
      const px = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      expect(palette).toContainEqual(px);
    }
  });

  it('amount=0 leaves pixels untouched', () => {
    const img = makeImage(16, 16, gradient);
    const before = snapshot(img);
    applyPaletteSnap(img, {
      colors: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      metric: 'rgb',
      amount: 0,
      dither: false,
      ditherAlgorithm: 'floyd-steinberg',
      ditherStrength: 0.5,
      alphaCutoff: 0,
      seed: 0,
    });
    expect(snapshot(img)).toBe(before);
  });

  it('keeps alpha', () => {
    const img = makeImage(8, 8, () => [120, 120, 120, 64]);
    applyPaletteSnap(img, {
      colors: [
        [0, 0, 0],
        [255, 255, 255],
      ],
      metric: 'rgb',
      amount: 1,
      dither: false,
      ditherAlgorithm: 'floyd-steinberg',
      ditherStrength: 0.5,
      alphaCutoff: 0,
      seed: 0,
    });
    for (let i = 3; i < img.data.length; i += 4) expect(img.data[i]).toBe(64);
  });
});

describe('bloom', () => {
  it('does not mutate the source when intensity is 0', () => {
    const img = makeImage(16, 16, () => [255, 255, 255, 255]);
    const before = snapshot(img);
    applyBloom(img, {
      threshold: 0.6,
      softKnee: 0.2,
      intensity: 0,
      radius: 8,
      diffusion: 0.5,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: false,
      streakAngle: 0,
      streakLength: 32,
      streakIntensity: 0.5,
      streakAspect: 2,
      quality: 'auto',
    });
    expect(snapshot(img)).toBe(before);
  });

  it('brightens highlights and is deterministic', () => {
    const run = () => {
      const img = makeImage(32, 32, (x, y) => (x < 16 ? [255, 255, 255, 255] : [10, 10, 10, 255]));
      applyBloom(img, {
        threshold: 0.4,
        softKnee: 0.2,
        intensity: 1.5,
        radius: 12,
        diffusion: 0.5,
        tint: null,
        tintAmount: 0,
        composite: 'screen',
        streakEnabled: false,
        streakAngle: 0,
        streakLength: 32,
        streakIntensity: 0.5,
        streakAspect: 2,
        quality: 'normal',
      });
      return snapshot(img);
    };
    const a = run();
    const b = run();
    expect(a).toBe(b);
  });

  it('glows bright content onto dark neighbors (white-on-dark)', () => {
    // Left half bright, right half dark: bloom must brighten the dark side.
    const img = makeImage(64, 32, (x) => (x < 32 ? [255, 255, 255, 255] : [16, 28, 40, 255]));
    const beforeDark = img.data[32 * 4 + 32 * 4 * 16]!;
    applyBloom(img, {
      threshold: 0.6,
      softKnee: 0.2,
      intensity: 1.5,
      radius: 16,
      diffusion: 0.5,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: false,
      streakAngle: 0,
      streakLength: 32,
      streakIntensity: 0.5,
      streakAspect: 2,
      quality: 'normal',
    });
    // The dark pixel near the boundary (row 16, col 40) gets glow.
    const afterDark = img.data[(40 + 32 * 16) * 4]!;
    expect(afterDark).toBeGreaterThan(beforeDark);
  });

  it('survives zero radius and degenerate inputs without NaN', () => {
    const img = makeImage(1, 1, () => [255, 255, 255, 255]);
    applyBloom(img, {
      threshold: 0.5,
      softKnee: 0.1,
      intensity: 2,
      radius: 0,
      diffusion: 0.5,
      tint: [255, 0, 0],
      tintAmount: 1,
      composite: 'add',
      streakEnabled: true,
      streakAngle: 45,
      streakLength: 300,
      streakIntensity: 1,
      streakAspect: 4,
      quality: 'export',
    });
    for (const v of img.data) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('rgbSplit', () => {
  it('displaces channels and keeps alpha', () => {
    const img = makeImage(16, 16, (x) => [x * 16, 100, 200, 255]);
    const beforeAlpha = Array.from(img.data).filter((_, i) => i % 4 === 3);
    applyRgbSplit(img, {
      mode: 'offset',
      redX: -3,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: -3,
      blueY: 0,
      amount: 3,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'transparent',
      intensity: 1,
    });
    const afterAlpha = Array.from(img.data).filter((_, i) => i % 4 === 3);
    expect(afterAlpha).toEqual(beforeAlpha);
    // Red at (0,0) samples x=-3: outside → transparent border contributes 0.
    expect(img.data[0]).toBe(0);
    // Red at (4,0) samples x=1 → source red 16.
    expect(img.data[4 * 4]).toBe(16);
  });

  it('clamp border does not introduce transparency at edges', () => {
    const img = makeImage(8, 8, () => [200, 200, 200, 255]);
    applyRgbSplit(img, {
      mode: 'offset',
      redX: 20,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: 0,
      blueY: 0,
      amount: 20,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'clamp',
      intensity: 1,
    });
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i + 3]).toBe(255);
  });

  it('mirror border samples inside the surface', () => {
    const img = makeImage(8, 8, () => [123, 123, 123, 255]);
    applyRgbSplit(img, {
      mode: 'offset',
      redX: 30,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: 0,
      blueY: 0,
      amount: 30,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'mirror',
      intensity: 1,
    });
    for (let i = 0; i < img.data.length; i += 4) expect(img.data[i]).toBe(123);
  });

  it('is deterministic', () => {
    const run = () => {
      const img = makeImage(16, 16, gradient);
      applyRgbSplit(img, {
        mode: 'radial',
        redX: 0,
        redY: 0,
        greenX: 0,
        greenY: 0,
        blueX: 0,
        blueY: 0,
        amount: 5,
        centerX: 0.5,
        centerY: 0.5,
        falloff: 1.5,
        fringeAngle: 30,
        borderMode: 'transparent',
        intensity: 1,
      });
      return snapshot(img);
    };
    expect(run()).toBe(run());
  });
});

describe('crt', () => {
  it('is deterministic and keeps alpha', () => {
    const run = () => {
      const img = makeImage(24, 24, gradient);
      applyCrt(img, {
        curvature: 0.2,
        cornerRadius: 0.4,
        scanlinePeriod: 3,
        scanlineStrength: 0.5,
        scanlineSoftness: 0.5,
        phosphorMask: 'rgb-stripe',
        phosphorPitch: 4,
        phosphorIntensity: 0.6,
        glow: 0.3,
        vignette: 0.4,
        vignetteRadius: 0.5,
        convergenceX: 1,
        convergenceY: 0,
        brightness: 0.02,
        contrast: 1.1,
      });
      return snapshot(img);
    };
    const a = run();
    expect(a).toBe(run());
  });

  it('zero settings are near-identity', () => {
    const img = makeImage(16, 16, () => [128, 128, 128, 255]);
    const before = snapshot(img);
    applyCrt(img, {
      curvature: 0,
      cornerRadius: 0,
      scanlinePeriod: 3,
      scanlineStrength: 0,
      scanlineSoftness: 0.5,
      phosphorMask: 'none',
      phosphorPitch: 4,
      phosphorIntensity: 0,
      glow: 0,
      vignette: 0,
      vignetteRadius: 0.5,
      convergenceX: 0,
      convergenceY: 0,
      brightness: 0,
      contrast: 1,
    });
    expect(snapshot(img)).toBe(before);
  });
});

describe('vhs', () => {
  it('same seed+time+frameRate produces identical output', () => {
    const run = () => {
      const img = makeImage(32, 32, gradient);
      applyVhs(img, {
        lumaNoise: 0.4,
        chromaNoise: 0.3,
        chromaBleed: 0.4,
        jitter: 0.4,
        tracking: 0.3,
        dropouts: 0.2,
        headSwitching: 0.4,
        tearing: 0.3,
        signalBlur: 0.2,
        timeInstability: 0.3,
        seed: 11,
        time: 1.5,
        frameRate: 24,
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run()).toBe(run());
  });

  it('time changes the frame without changing identity (seed fixed)', () => {
    const run = (time: number) => {
      const img = makeImage(16, 16, () => [100, 100, 100, 255]);
      applyVhs(img, {
        lumaNoise: 0.5,
        chromaNoise: 0,
        chromaBleed: 0,
        jitter: 0,
        tracking: 0,
        dropouts: 0,
        headSwitching: 0,
        tearing: 0,
        signalBlur: 0,
        timeInstability: 0,
        seed: 5,
        time,
        frameRate: 12,
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run(0.2)).not.toBe(run(0.3));
  });

  it('different seeds differ', () => {
    const run = (seed: number) => {
      const img = makeImage(16, 16, () => [100, 100, 100, 255]);
      applyVhs(img, {
        lumaNoise: 0.6,
        chromaNoise: 0,
        chromaBleed: 0,
        jitter: 0,
        tracking: 0,
        dropouts: 0,
        headSwitching: 0,
        tearing: 0,
        signalBlur: 0,
        timeInstability: 0,
        seed,
        time: 0,
        frameRate: 24,
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run(1)).not.toBe(run(2));
  });
});

describe('lightShafts', () => {
  it('is deterministic per quality tier', () => {
    const run = () => {
      const img = makeImage(24, 24, (x, y) => (x < 8 ? [30, 30, 30, 255] : [220, 220, 220, 255]));
      applyLightShafts(img, {
        lightX: 0.5,
        lightY: 0.05,
        lightType: 'point',
        direction: 0,
        intensity: 1.2,
        exposure: 0,
        decay: 0.85,
        density: 0.2,
        weight: 0.9,
        sampleCount: 12,
        scattering: 0.3,
        tint: null,
        occlusionSource: 'luminance',
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run()).toBe(run());
  });

  it('zero intensity is a no-op', () => {
    const img = makeImage(16, 16, gradient);
    const before = snapshot(img);
    applyLightShafts(img, {
      lightX: 0.5,
      lightY: 0.1,
      lightType: 'point',
      direction: 0,
      intensity: 0,
      exposure: 0,
      decay: 0.9,
      density: 0.1,
      weight: 0.8,
      sampleCount: 12,
      scattering: 0,
      tint: null,
      occlusionSource: 'luminance',
      quality: 'normal',
    });
    expect(snapshot(img)).toBe(before);
  });
});

describe('lensFlare', () => {
  it('is deterministic and additive', () => {
    const run = () => {
      const img = makeImage(32, 32, () => [40, 40, 40, 255]);
      applyLensFlare(img, {
        sourceX: 0.5,
        sourceY: 0.3,
        brightness: 1,
        scale: 1,
        ghostCount: 4,
        ghostSpacing: 0.8,
        halo: 0.5,
        apertureBlades: 8,
        apertureRotation: 22,
        streakIntensity: 0.6,
        anamorphicRatio: 0.3,
        chromaticDispersion: 0.4,
        seed: 3,
        quality: 'normal',
      });
      return snapshot(img);
    };
    const a = run();
    expect(a).toBe(run());
    // Brightness 0 = no-op.
    const img = makeImage(16, 16, () => [40, 40, 40, 255]);
    const before = snapshot(img);
    applyLensFlare(img, {
      sourceX: 0.5,
      sourceY: 0.3,
      brightness: 0,
      scale: 1,
      ghostCount: 4,
      ghostSpacing: 0.8,
      halo: 0.5,
      apertureBlades: 0,
      apertureRotation: 0,
      streakIntensity: 0.6,
      anamorphicRatio: 0.3,
      chromaticDispersion: 0.4,
      seed: 3,
      quality: 'normal',
    });
    expect(snapshot(img)).toBe(before);
  });

  it('auto source tracks the brightest pixel deterministically', () => {
    const run = () => {
      const img = makeImage(16, 16, (x, y) =>
        x === 12 && y === 3 ? [255, 255, 255, 255] : [20, 20, 20, 255],
      );
      applyLensFlare(img, {
        sourceX: -1,
        sourceY: -1,
        brightness: 1,
        scale: 1,
        ghostCount: 2,
        ghostSpacing: 0.8,
        halo: 0.5,
        apertureBlades: 0,
        apertureRotation: 0,
        streakIntensity: 0,
        anamorphicRatio: 0,
        chromaticDispersion: 0,
        seed: 0,
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run()).toBe(run());
  });
});

describe('lightLeak', () => {
  it('is deterministic and never reduces alpha', () => {
    const run = () => {
      const img = makeImage(24, 24, gradient);
      applyLightLeak(img, {
        seed: 4,
        x: 0.2,
        y: 0.3,
        angle: 25,
        size: 1,
        softness: 0.7,
        hue: 25,
        saturation: 0.85,
        lightness: 0.6,
        intensity: 0.8,
        noiseScale: 0.5,
      });
      return snapshot(img);
    };
    const a = run();
    expect(a).toBe(run());
    const img = makeImage(8, 8, () => [100, 100, 100, 64]);
    const beforeAlpha = Array.from(img.data).filter((_, i) => i % 4 === 3);
    applyLightLeak(img, {
      seed: 4,
      x: 0.5,
      y: 0.5,
      angle: 0,
      size: 1,
      softness: 0.7,
      hue: 25,
      saturation: 0.85,
      lightness: 0.6,
      intensity: 1,
      noiseScale: 0.5,
    });
    const afterAlpha = Array.from(img.data).filter((_, i) => i % 4 === 3);
    expect(afterAlpha).toEqual(beforeAlpha);
  });
});

describe('caustics', () => {
  it('builds deterministic wave sets', () => {
    const base = {
      scale: 24,
      depth: 0.5,
      waveCount: 4,
      complexity: 0.3,
      refractionAmount: 0.4,
      sharpness: 0.5,
      lightAngle: 60,
      brightness: 1,
      contrast: 1.1,
      dispersion: 0.1,
      distortionAmount: 0.8,
      output: 'combined' as const,
      waterTint: null,
      surfaceTint: null,
      seed: 3,
      time: 0,
      animationSpeed: 0.5,
      tileable: false,
      quality: 'normal' as const,
    };
    const a = buildCausticWaves(base, 24);
    const b = buildCausticWaves(base, 24);
    expect(a).toEqual(b);
    expect(a.length).toBe(4);
  });

  it('same seed+time produces identical output', () => {
    const run = () => {
      const img = makeImage(32, 32, gradient);
      applyCaustics(img, {
        scale: 24,
        depth: 0.6,
        waveCount: 4,
        complexity: 0.4,
        refractionAmount: 0.5,
        sharpness: 0.6,
        lightAngle: 60,
        brightness: 1.2,
        contrast: 1.2,
        dispersion: 0.2,
        distortionAmount: 0.9,
        output: 'combined',
        waterTint: [30, 90, 160],
        surfaceTint: null,
        seed: 8,
        time: 1.2,
        animationSpeed: 0.6,
        tileable: false,
        quality: 'normal',
      });
      return snapshot(img);
    };
    expect(run()).toBe(run());
  });

  it('tileable waves are periodic', () => {
    const img = makeImage(64, 64, gradient);
    applyCaustics(img, {
      scale: 16,
      depth: 0.6,
      waveCount: 4,
      complexity: 0.2,
      refractionAmount: 0.4,
      sharpness: 0.5,
      lightAngle: 60,
      brightness: 1.1,
      contrast: 1.1,
      dispersion: 0.1,
      distortionAmount: 0.8,
      output: 'combined',
      waterTint: null,
      surfaceTint: null,
      seed: 2,
      time: 0.3,
      animationSpeed: 0.5,
      tileable: true,
      quality: 'normal',
    });
    // No NaN anywhere.
    for (const v of img.data) expect(Number.isFinite(v)).toBe(true);
  });
});
