import { describe, expect, it } from 'vitest';
import type { ProofTransformConfig } from './proofTransform';
import {
  applyProofToNormalized,
  applyProofToRgba,
  clearProofConverters,
  isColorOutOfProofGamut,
  isProofingAvailable,
  proofConfigKey,
  registerProfileProofConverter,
  registerProfileProofConverterNormalized,
} from './proofTransform';

const config = {
  profileId: 'fogra39',
  renderingIntent: 'relative' as const,
  blackPointCompensation: true,
  simulatePaperColor: false,
  simulateBlackInk: false,
};

describe('applyProofToRgba', () => {
  it('reports unavailable when no profile converter is registered', () => {
    clearProofConverters();
    const result = applyProofToRgba([255, 0, 0, 255], config);
    expect(result.kind).toBe('unavailable');
    // Honest pass-through: the source color is never mutated or lost.
    expect(result.rgba).toEqual([255, 0, 0, 255]);
  });

  it('applies the registered converter deterministically', () => {
    clearProofConverters();
    const seen = new Set<string>();
    registerProfileProofConverter('fogra39', (rgba) => {
      seen.add(rgba.join(','));
      return [rgba[0], rgba[1], rgba[2], rgba[3]];
    });
    const a = applyProofToRgba([10, 20, 30, 255], config);
    const b = applyProofToRgba([10, 20, 30, 255], config);
    expect(a.kind).toBe('icc');
    expect(a).toEqual(b);
    // Determinism + bounded cache: the converter runs once per color.
    expect(seen.size).toBe(1);
    clearProofConverters();
  });

  it('never mutates its input', () => {
    clearProofConverters();
    registerProfileProofConverter('fogra39', (rgba) => [rgba[0] - 5, rgba[1], rgba[2], rgba[3]]);
    const input: [number, number, number, number] = [100, 150, 200, 255];
    const result = applyProofToRgba(input, config);
    expect(input).toEqual([100, 150, 200, 255]);
    expect(result.rgba[0]).toBe(95);
    clearProofConverters();
  });

  it('returns unavailable when the converter declines the color', () => {
    clearProofConverters();
    registerProfileProofConverter('fogra39', () => null);
    expect(applyProofToRgba([1, 2, 3, 255], config).kind).toBe('unavailable');
    clearProofConverters();
  });
});

describe('applyProofToNormalized', () => {
  const config: ProofTransformConfig = {
    profileId: 'fogra39',
    renderingIntent: 'relative',
    blackPointCompensation: true,
    simulatePaperColor: false,
    simulateBlackInk: false,
  };

  it('preserves fractional channels through a normalized provider', () => {
    registerProfileProofConverterNormalized('fogra39', ([r, g, b, a]) => [r + 0.0001, g, b, a]);
    const result = applyProofToNormalized([0.1234, 0.5, 0.75, 1], config);
    expect(result.kind).toBe('icc');
    if (result.kind === 'icc') expect(result.rgba[0]).toBeCloseTo(0.1235, 12);
  });
});

describe('isColorOutOfProofGamut', () => {
  it('returns null (unknown) when proofing is unavailable', () => {
    clearProofConverters();
    expect(isColorOutOfProofGamut([255, 0, 0, 255], config)).toBeNull();
  });

  it('flags colors the proof transform clips meaningfully', () => {
    clearProofConverters();
    registerProfileProofConverter('fogra39', (rgba) => [
      Math.round(rgba[0] * 0.6),
      Math.round(rgba[1] * 0.6),
      Math.round(rgba[2] * 0.6),
      rgba[3],
    ]);
    expect(isColorOutOfProofGamut([255, 0, 0, 255], config)).toBe(true);
    // A color the transform leaves alone is in gamut.
    registerProfileProofConverter('fogra39', (rgba) => [...rgba]);
    expect(isColorOutOfProofGamut([255, 0, 0, 255], config)).toBe(false);
    clearProofConverters();
  });
});

describe('proofConfigKey', () => {
  it('is stable and distinguishes options', () => {
    expect(proofConfigKey(config)).toBe(proofConfigKey({ ...config }));
    expect(proofConfigKey(config)).not.toBe(
      proofConfigKey({ ...config, simulatePaperColor: true }),
    );
    expect(proofConfigKey(config)).not.toBe(
      proofConfigKey({ ...config, renderingIntent: 'perceptual' }),
    );
  });
});

describe('isProofingAvailable', () => {
  it('reflects registered converters', () => {
    clearProofConverters();
    expect(isProofingAvailable(config)).toBe(false);
    registerProfileProofConverter('fogra39', (rgba) => [...rgba]);
    expect(isProofingAvailable(config)).toBe(true);
    clearProofConverters();
    expect(isProofingAvailable(config)).toBe(false);
  });
});
