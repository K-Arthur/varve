/**
 * Wiring invariants for the live effects family: defaults, Adjustment →
 * FilterIR mapping, filter dispatch classification, and bounds expansion.
 */

import { describe, expect, it } from 'vitest';
import {
  effectPixelExpansion,
  getFilterProperties,
  requiresRasterExport,
} from '../../adjustmentPipeline';
import { getEffectContract } from '../../effectContract';
import { adjustmentToFilter, makeAdjustment } from '../../filters';

const KINDS = [
  'dither',
  'paletteSnap',
  'bloom',
  'rgbSplit',
  'crt',
  'vhs',
  'lightShafts',
  'lensFlare',
  'lightLeak',
  'caustics',
] as const;

describe('live effect defaults', () => {
  for (const kind of KINDS) {
    it(`${kind} has complete defaults`, () => {
      const adj = makeAdjustment('id-1', kind);
      expect(adj.kind).toBe(kind);
      expect(adj.visible).toBe(true);
      expect(adj.opacity).toBe(1);
      expect(adj.blendMode).toBe('normal');
      // All parameters must be present and finite (JSON-safe).
      for (const [key, value] of Object.entries(adj)) {
        if (
          key === 'id' ||
          key === 'kind' ||
          key === 'visible' ||
          key === 'opacity' ||
          key === 'blendMode'
        )
          continue;
        if (Array.isArray(value)) continue;
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    });
  }
});

describe('live effect IR mapping', () => {
  for (const kind of KINDS) {
    it(`${kind} maps to a FilterIR of the same kind`, () => {
      const adj = makeAdjustment('id-2', kind);
      const ir = adjustmentToFilter(adj);
      expect(ir.kind).toBe(kind);
      expect(ir.opacity).toBe(1);
      expect(ir.blendMode).toBe('normal');
    });
  }

  it('dither palette survives the round trip', () => {
    const adj = makeAdjustment('id-3', 'dither', {
      algorithm: 'bayer',
      paletteMode: 'custom',
      colors: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      metric: 'oklab',
      seed: 42,
    } as Partial<import('../../filters').DitherAdjustment>);
    const ir = adjustmentToFilter(adj);
    expect(ir.kind).toBe('dither');
    if (ir.kind === 'dither') {
      expect(ir.colors).toEqual([
        [1, 2, 3],
        [4, 5, 6],
      ]);
      expect(ir.metric).toBe('oklab');
      expect(ir.seed).toBe(42);
    }
  });

  it('bloom quality param is preserved', () => {
    const adj = makeAdjustment('id-4', 'bloom', { quality: 'export' } as Partial<
      import('../../filters').BloomAdjustment
    >);
    const ir = adjustmentToFilter(adj);
    if (ir.kind === 'bloom') expect(ir.quality).toBe('export');
  });
});

describe('live effect classification', () => {
  const GPU_IMPLEMENTED = new Set([
    'paletteSnap',
    'bloom',
    'rgbSplit',
    'crt',
    'vhs',
    'lightShafts',
    'lensFlare',
    'lightLeak',
    'caustics',
  ]);
  for (const kind of KINDS) {
    it(`${kind} is raster-export and honestly GPU-classified`, () => {
      const contract = getEffectContract(kind);
      expect(contract).toBeDefined();
      expect(contract!.cssFilterEquivalent).toBeNull();
      expect(contract!.requiresRasterForExport).toBe(true);
      const gpuImplemented = GPU_IMPLEMENTED.has(kind);
      expect(contract!.gpuStatus).toBe(gpuImplemented ? 'implemented' : 'partial');
      const props = getFilterProperties(kind);
      expect(props).toBeDefined();
      expect(props!.hasCssPath).toBe(false);
      expect(props!.hasGpuPath).toBe(gpuImplemented);
      expect(requiresRasterExport(kind)).toBe(true);
    });
  }
});

describe('live effect bounds expansion', () => {
  it('bloom expands by its radius and streak contribution', () => {
    const [l] = effectPixelExpansion({
      kind: 'bloom',
      threshold: 0.5,
      softKnee: 0.2,
      intensity: 1,
      radius: 100,
      diffusion: 0.5,
      tint: null,
      tintAmount: 0,
      composite: 'screen',
      streakEnabled: true,
      streakAngle: 0,
      streakLength: 200,
      streakIntensity: 1,
      streakAspect: 2,
      quality: 'auto',
      opacity: 1,
      blendMode: 'normal',
    });
    expect(l).toBe(100);
  });

  it('rgbSplit expands by the largest channel offset', () => {
    const [l] = effectPixelExpansion({
      kind: 'rgbSplit',
      mode: 'offset',
      redX: 2,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: -40,
      blueY: 12,
      amount: 3,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'transparent',
      intensity: 1,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(l).toBe(40);
  });

  it('radial rgbSplit expands by amount', () => {
    const [l] = effectPixelExpansion({
      kind: 'rgbSplit',
      mode: 'radial',
      redX: 0,
      redY: 0,
      greenX: 0,
      greenY: 0,
      blueX: 0,
      blueY: 0,
      amount: 9,
      centerX: 0.5,
      centerY: 0.5,
      falloff: 1,
      fringeAngle: 0,
      borderMode: 'transparent',
      intensity: 1,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(l).toBe(9);
  });

  it('lensFlare expands with scale; crt/vhs stay small', () => {
    const [flare] = effectPixelExpansion({
      kind: 'lensFlare',
      sourceX: 0.5,
      sourceY: 0.5,
      brightness: 1,
      scale: 1.5,
      ghostCount: 4,
      ghostSpacing: 0.8,
      halo: 0.5,
      apertureBlades: 0,
      apertureRotation: 0,
      streakIntensity: 0.5,
      anamorphicRatio: 0.2,
      chromaticDispersion: 0.4,
      seed: 0,
      quality: 'auto',
      opacity: 1,
      blendMode: 'normal',
    });
    expect(flare).toBeGreaterThan(100);
    const [crt] = effectPixelExpansion({
      kind: 'crt',
      curvature: 0.1,
      cornerRadius: 0.3,
      scanlinePeriod: 3,
      scanlineStrength: 0.5,
      scanlineSoftness: 0.5,
      phosphorMask: 'none',
      phosphorPitch: 4,
      phosphorIntensity: 0.5,
      glow: 0.3,
      vignette: 0.3,
      vignetteRadius: 0.5,
      convergenceX: 0.5,
      convergenceY: 0,
      brightness: 0,
      contrast: 1.1,
      opacity: 1,
      blendMode: 'normal',
    });
    expect(crt).toBe(8);
  });

  it('unknown kinds expand by zero (graceful degradation)', () => {
    expect(
      effectPixelExpansion({
        kind: 'brightness',
        value: 10,
        opacity: 1,
        blendMode: 'normal',
      }),
    ).toEqual([0, 0, 0, 0]);
  });
});
