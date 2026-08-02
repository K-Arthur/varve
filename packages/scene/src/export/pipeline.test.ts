import { describe, expect, it } from 'vitest';
import {
  createColorConversionOptions,
  createDitherOptions,
  createMetadataPolicy,
  createResizeOptions,
  createSharpenOptions,
  isValidColorOperation,
  isValidDitherAlgorithm,
  isValidResamplingAlgorithm,
  isValidSharpenMode,
  resolveMetadataFieldDecision,
  validateColorConversionOptions,
  validateDitherOptions,
  validateMetadataPolicy,
  validateResizeOptions,
  validateSharpenOptions,
} from './pipeline';

describe('ResizeOptions', () => {
  it('defaults to deterministic auto mode with safe allocation cap', () => {
    const opts = createResizeOptions();
    expect(opts).toMatchObject({
      algorithm: 'auto',
      workingSpace: 'srgb',
      maxPixels: 64_000_000,
      tileHeight: 0,
    });
  });

  it('accepts partial overrides and fills the rest', () => {
    const opts = createResizeOptions({ algorithm: 'lanczos3', workingSpace: 'linear-srgb' });
    expect(opts.algorithm).toBe('lanczos3');
    expect(opts.workingSpace).toBe('linear-srgb');
    expect(opts.maxPixels).toBe(64_000_000);
  });

  it('rejects unknown algorithms and invalid numbers', () => {
    expect(() =>
      validateResizeOptions({ ...createResizeOptions(), algorithm: 'magic' as never }, 'r'),
    ).toThrow(/unknown resampling algorithm/);
    expect(() =>
      validateResizeOptions({ ...createResizeOptions(), maxPixels: Number.NaN }, 'r'),
    ).toThrow(/maxPixels/);
    expect(() => validateResizeOptions({ ...createResizeOptions(), tileHeight: -1 }, 'r')).toThrow(
      /tileHeight/,
    );
  });

  it('accepts every documented algorithm', () => {
    for (const algorithm of [
      'auto',
      'nearest',
      'bilinear',
      'bicubic',
      'catmull-rom',
      'mitchell',
      'lanczos2',
      'lanczos3',
      'area',
      'pixel-art',
    ] as const) {
      expect(isValidResamplingAlgorithm(algorithm)).toBe(true);
    }
    expect(isValidResamplingAlgorithm('nope')).toBe(false);
  });
});

describe('SharpenOptions', () => {
  it('defaults to no sharpening (safe for photographic output)', () => {
    expect(createSharpenOptions().mode).toBe('none');
  });

  it('validates ranges and rejects NaN', () => {
    expect(() =>
      validateSharpenOptions({ ...createSharpenOptions(), mode: 'unsharp', amount: 2 }, 's'),
    ).toThrow(/amount/);
    expect(() =>
      validateSharpenOptions(
        { ...createSharpenOptions(), mode: 'unsharp', radius: Number.NaN },
        's',
      ),
    ).toThrow(/radius/);
    expect(() =>
      validateSharpenOptions({ ...createSharpenOptions(), mode: 'unsharp', threshold: -0.1 }, 's'),
    ).toThrow(/threshold/);
    expect(() =>
      validateSharpenOptions({ ...createSharpenOptions(), mode: 'unknown' as never }, 's'),
    ).toThrow(/unknown sharpen mode/);
  });

  it('treats mode none as valid without checking numeric params', () => {
    expect(() =>
      validateSharpenOptions({ ...createSharpenOptions(), amount: Number.NaN }, 's'),
    ).not.toThrow();
    expect(isValidSharpenMode('crisp')).toBe(true);
    expect(isValidSharpenMode('sparkle')).toBe(false);
  });
});

describe('DitherOptions', () => {
  it('defaults to no dithering with a fixed deterministic seed', () => {
    const opts = createDitherOptions();
    expect(opts.algorithm).toBe('none');
    expect(opts.seed).toBe(0);
    expect(opts.serpentine).toBe(true);
  });

  it('validates algorithm, strength, bit depth, palette size and threshold', () => {
    expect(() =>
      validateDitherOptions({ ...createDitherOptions(), algorithm: 'wat' as never }, 'd'),
    ).toThrow(/unknown dither algorithm/);
    expect(() => validateDitherOptions({ ...createDitherOptions(), strength: 1.5 }, 'd')).toThrow(
      /strength/,
    );
    expect(() =>
      validateDitherOptions({ ...createDitherOptions(), targetBitDepth: 12 }, 'd'),
    ).toThrow(/targetBitDepth/);
    expect(() =>
      validateDitherOptions({ ...createDitherOptions(), paletteSize: 512 }, 'd'),
    ).toThrow(/paletteSize/);
    expect(() =>
      validateDitherOptions({ ...createDitherOptions(), alphaThreshold: -0.5 }, 'd'),
    ).toThrow(/alphaThreshold/);
  });

  it('accepts every documented algorithm', () => {
    for (const algorithm of [
      'none',
      'floyd-steinberg',
      'atkinson',
      'jarvis-judice-ninke',
      'stucki',
      'bayer-2',
      'bayer-4',
      'bayer-8',
      'blue-noise',
    ] as const) {
      expect(isValidDitherAlgorithm(algorithm)).toBe(true);
    }
    expect(isValidDitherAlgorithm('troll')).toBe(false);
  });
});

describe('MetadataPolicy', () => {
  it('defaults to privacy-strip, keeping authorship but dropping GPS', () => {
    const policy = createMetadataPolicy();
    expect(policy.kind).toBe('privacy-strip');
    expect(resolveMetadataFieldDecision(policy, 'gps')).toBe('strip');
    expect(resolveMetadataFieldDecision(policy, 'device')).toBe('strip');
    expect(resolveMetadataFieldDecision(policy, 'copyright')).toBe('keep');
    expect(resolveMetadataFieldDecision(policy, 'creator')).toBe('keep');
  });

  it('copyright-only keeps only the copyright field', () => {
    const policy = createMetadataPolicy({ kind: 'copyright-only' });
    expect(resolveMetadataFieldDecision(policy, 'copyright')).toBe('keep');
    expect(resolveMetadataFieldDecision(policy, 'creator')).toBe('strip');
    expect(resolveMetadataFieldDecision(policy, 'gps')).toBe('strip');
  });

  it('strip-all and preserve behave as named', () => {
    const strip = createMetadataPolicy({ kind: 'strip-all' });
    const preserve = createMetadataPolicy({ kind: 'preserve' });
    for (const field of ['gps', 'device', 'copyright', 'creator', 'timestamps'] as const) {
      expect(resolveMetadataFieldDecision(strip, field)).toBe('strip');
      expect(resolveMetadataFieldDecision(preserve, field)).toBe('keep');
    }
  });

  it('custom uses per-field overrides with inherit fallback', () => {
    const policy = createMetadataPolicy({
      kind: 'custom',
      overrides: { gps: 'keep', device: 'strip' },
    });
    expect(resolveMetadataFieldDecision(policy, 'gps')).toBe('keep');
    expect(resolveMetadataFieldDecision(policy, 'device')).toBe('strip');
    expect(resolveMetadataFieldDecision(policy, 'copyright')).toBe('inherit');
  });

  it('validates overrides', () => {
    expect(() =>
      validateMetadataPolicy(
        createMetadataPolicy({ kind: 'custom', overrides: { gps: 'explode' as never } }),
        'm',
      ),
    ).toThrow(/gps/);
    expect(() => validateMetadataPolicy({ kind: 'nope' as never } as never, 'm')).toThrow(/kind/);
  });
});

describe('ColorConversionOptions', () => {
  it('defaults to convert-from-sRGB with relative intent and BPC', () => {
    expect(createColorConversionOptions()).toMatchObject({
      operation: 'convert',
      sourceProfile: 'assume-srgb',
      renderingIntent: 'relative',
      blackPointCompensation: true,
    });
  });

  it('requires a source profile name when source is user', () => {
    expect(() =>
      validateColorConversionOptions(createColorConversionOptions({ sourceProfile: 'user' }), 'c'),
    ).toThrow(/sourceProfileName/);
    expect(() =>
      validateColorConversionOptions(
        createColorConversionOptions({ sourceProfile: 'user', sourceProfileName: 'My.icc' }),
        'c',
      ),
    ).not.toThrow();
  });

  it('rejects unknown operations and intents', () => {
    expect(() =>
      validateColorConversionOptions(
        { ...createColorConversionOptions(), operation: 'x' as never },
        'c',
      ),
    ).toThrow(/operation/);
    expect(() =>
      validateColorConversionOptions(
        { ...createColorConversionOptions(), renderingIntent: 'vivid' as never },
        'c',
      ),
    ).toThrow(/renderingIntent/);
    expect(isValidColorOperation('embed')).toBe(true);
    expect(isValidColorOperation('proof')).toBe(true);
  });
});
