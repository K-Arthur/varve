import { describe, expect, it } from 'vitest';
import {
  FORMAT_CAPABILITIES,
  assessMaskCompatibility,
  getMaskFeatureCapability,
  isFormatSupported,
} from './maskCapability';
import type { Mask } from './types';

function makeMask(overrides: Partial<Mask> & { type: Mask['type'] }): Mask {
  return {
    type: overrides.type,
    visible: true,
    fillRule: 'nonzero',
    inverted: false,
    feather: 0,
    density: 1,
    linked: true,
    hideMaskSource: false,
    sourceNodeId: 'node-1',
    ...overrides,
  };
}

describe('FORMAT_CAPABILITIES', () => {
  it('declares SVG with full native support', () => {
    const svg = FORMAT_CAPABILITIES.svg;
    expect(svg).toBeDefined();
    expect(svg.clip.type).toBe('native');
    expect(svg.alpha.type).toBe('native');
    expect(svg.luminance.type).toBe('native');
    expect(svg.maxNestingDepth).toBe(Infinity);
    expect(svg.supportsRasterMask).toBe(true);
  });

  it('declares PDF with partial support', () => {
    const pdf = FORMAT_CAPABILITIES.pdf;
    expect(pdf).toBeDefined();
    expect(pdf.clip.type).toBe('native');
    expect(pdf.clip.feather).toBe('unsupported');
    expect(pdf.alpha.feather).toBe('native');
    expect(pdf.maxNestingDepth).toBe(4);
  });

  it('declares PSD with partial support', () => {
    const psd = FORMAT_CAPABILITIES.psd;
    expect(psd).toBeDefined();
    expect(psd.clip.type).toBe('native');
    expect(psd.clip.feather).toBe('native');
    expect(psd.maxNestingDepth).toBe(2);
  });
});

describe('getMaskFeatureCapability', () => {
  it('returns native for SVG clip type', () => {
    expect(getMaskFeatureCapability('svg', 'clip', 'type')).toBe('native');
  });

  it('returns unsupported for PDF clip feather', () => {
    expect(getMaskFeatureCapability('pdf', 'clip', 'feather')).toBe('unsupported');
  });

  it('returns native for PDF alpha feather', () => {
    expect(getMaskFeatureCapability('pdf', 'alpha', 'feather')).toBe('native');
  });

  it('returns unsupported for unknown format', () => {
    expect(getMaskFeatureCapability('unknown', 'clip', 'type')).toBe('unsupported');
  });
});

describe('assessMaskCompatibility', () => {
  it('preserves a simple clip mask in SVG', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('svg', mask);
    expect(result.outcome).toBe('preserved');
    expect(result.lossless).toBe(true);
  });

  it('preserves a simple alpha mask in PDF', () => {
    const mask = makeMask({ type: 'alpha' });
    const result = assessMaskCompatibility('pdf', mask);
    expect(result.outcome).toBe('preserved');
    expect(result.lossless).toBe(true);
  });

  it('converts a feathered clip mask in PDF', () => {
    const mask = makeMask({ type: 'clip', feather: 5 });
    const result = assessMaskCompatibility('pdf', mask);
    expect(result.outcome).toBe('converted');
    expect(result.lossless).toBe(false);
    expect(result.detail).toContain('feather lost');
  });

  it('rasterizes a masked container with effects in PDF', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('pdf', mask, { hasEffects: true });
    expect(result.outcome).toBe('rasterized');
    expect(result.lossless).toBe(false);
  });

  it('rasterizes deeply nested masks beyond PDF max depth', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('pdf', mask, { nestedDepth: 5 });
    expect(result.outcome).toBe('rasterized');
    expect(result.detail).toContain('nesting depth');
  });

  it('blocks unknown format', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('unknown', mask);
    expect(result.outcome).toBe('blocked');
  });

  it('converts inverted clip in PDF', () => {
    const mask = makeMask({ type: 'clip', inverted: true });
    const result = assessMaskCompatibility('pdf', mask);
    expect(result.outcome).toBe('converted');
    expect(result.detail).toContain('inverted');
  });

  it('preserves luminance mask with feather in PDF', () => {
    const mask = makeMask({ type: 'luminance', feather: 3, density: 0.8 });
    const result = assessMaskCompatibility('pdf', mask);
    expect(result.outcome).toBe('preserved');
  });

  it('converts unlinked transform in PNG raster export', () => {
    const mask = makeMask({ type: 'clip', linked: false });
    const result = assessMaskCompatibility('png', mask);
    expect(result.outcome).toBe('converted');
    expect(result.detail).toContain('unlinked mask transform');
  });

  it('converts hide-mask-source in PNG raster export', () => {
    const mask = makeMask({ type: 'alpha', hideMaskSource: true });
    const result = assessMaskCompatibility('png', mask);
    expect(result.outcome).toBe('converted');
    expect(result.detail).toContain('hide-mask-source');
  });

  it('preserves simple mask in PNG raster export when no structural features', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('png', mask);
    expect(result.outcome).toBe('preserved');
  });

  it('blocks unsupported mask type for a format', () => {
    const mask = makeMask({ type: 'luminance' });
    const result = assessMaskCompatibility('psd', mask);
    expect(result.outcome).toBe('preserved');
  });

  it('blocks format when effects are unsupported with mask', () => {
    const mask = makeMask({ type: 'clip' });
    const result = assessMaskCompatibility('psd', mask, { hasEffects: true });
    expect(result.outcome).toBe('blocked');
    expect(result.detail).toContain('does not support');
  });

  it('handles fill rule loss for alpha mask in PDF', () => {
    const mask = makeMask({ type: 'alpha', fillRule: 'evenodd' });
    const result = assessMaskCompatibility('pdf', mask);
    expect(result.outcome).toBe('converted');
    expect(result.detail).toContain('fill rule');
  });
});

describe('isFormatSupported', () => {
  it('returns true for known formats', () => {
    expect(isFormatSupported('svg')).toBe(true);
    expect(isFormatSupported('pdf')).toBe(true);
    expect(isFormatSupported('png')).toBe(true);
  });

  it('returns false for unknown formats', () => {
    expect(isFormatSupported('bmp')).toBe(false);
  });
});
