import { describe, expect, it } from 'vitest';
import {
  canonicalFormatToLegacy,
  canonicalScaleToLegacy,
  configurationToLegacyPreset,
  legacyFormatToCanonical,
  legacyJobToJobSpec,
  legacyPresetsToConfigurations,
  legacyPresetToConfiguration,
  legacyScaleToCanonical,
} from './adapter';
import { createExportConfiguration } from './model';

describe('format mapping', () => {
  it('maps every legacy format to a canonical format', () => {
    const legacy = [
      'png',
      'jpg',
      'webp',
      'avif',
      'svg',
      'pdf-screen',
      'pdf-x1a',
      'pdf-x4',
      'react-tailwind',
      'react-cssmodules',
      'flutter',
      'swiftui',
      'svg-component',
    ] as const;
    for (const format of legacy) {
      const canonical = legacyFormatToCanonical(format);
      expect(isValidCanonicalFormat(canonical)).toBe(true);
      expect(canonicalFormatToLegacy(canonical)).toBeDefined();
    }
  });

  it('normalizes jpg→jpeg and pdf-screen→pdf', () => {
    expect(legacyFormatToCanonical('jpg')).toBe('jpeg');
    expect(legacyFormatToCanonical('pdf-screen')).toBe('pdf');
    expect(canonicalFormatToLegacy('jpeg')).toBe('jpg');
    expect(canonicalFormatToLegacy('pdf')).toBe('pdf-screen');
  });

  it('returns undefined for formats with no legacy representation', () => {
    const canonicalOnly = [
      'tiff',
      'bmp',
      'ico',
      'eps',
      'psd',
      'json',
      'css',
      'html',
      'gif',
      'pdf-x3',
    ] as const;
    for (const format of canonicalOnly) {
      expect(canonicalFormatToLegacy(format)).toBeUndefined();
    }
  });
});

describe('scale mapping', () => {
  it('maps legacy factor/width/height to canonical modes', () => {
    expect(legacyScaleToCanonical({ type: 'factor', value: 2 })).toEqual({
      mode: 'multiplier',
      value: 2,
    });
    expect(legacyScaleToCanonical({ type: 'width', pixels: 400 })).toEqual({
      mode: 'width',
      value: 400,
      unit: 'px',
    });
    expect(legacyScaleToCanonical({ type: 'height', pixels: 50 })).toEqual({
      mode: 'height',
      value: 50,
      unit: 'px',
    });
  });

  it('round-trips multiplier/width/height/resolution', () => {
    expect(canonicalScaleToLegacy({ mode: 'multiplier', value: 3 })).toEqual({
      type: 'factor',
      value: 3,
    });
    expect(canonicalScaleToLegacy({ mode: 'width', value: 300, unit: 'px' })).toEqual({
      type: 'width',
      pixels: 300,
    });
    expect(canonicalScaleToLegacy({ mode: 'resolution', dpi: 300 })).toEqual({
      type: 'resolution',
      dpi: 300,
    });
  });
});

describe('legacyPresetToConfiguration', () => {
  it('converts a PNG@2x preset preserving suffix convention', () => {
    const config = legacyPresetToConfiguration('n1', {
      id: 'p1',
      format: 'png',
      scale: { type: 'factor', value: 2 },
      suffix: '@2x',
      enabled: true,
    });
    expect(config).toMatchObject({
      id: 'p1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 2 },
      suffix: '@2x',
      enabled: true,
    });
  });

  it('normalizes hyphen-prefixed suffixes to canonical form', () => {
    const config = legacyPresetToConfiguration('n1', {
      id: 'p2',
      format: 'jpg',
      scale: { type: 'factor', value: 1 },
      suffix: 'social',
      enabled: true,
    });
    expect(config.suffix).toBe('-social');
  });

  it('maps print options for PDF/X-1a', () => {
    const config = legacyPresetToConfiguration('n1', {
      id: 'p3',
      format: 'pdf-x1a',
      scale: { type: 'factor', value: 1 },
      suffix: '',
      enabled: true,
      print: { iccProfile: 'FOGRA39', bleedMm: 5, includeCropMarks: true, outlineText: true },
    });
    expect(config.format).toBe('pdf-x1a');
    expect(config.print).toMatchObject({
      bleedMm: 5,
      includeCropMarks: true,
      convertToDestination: true,
    });
  });

  it('maps raster color profile', () => {
    const config = legacyPresetToConfiguration('n1', {
      id: 'p4',
      format: 'png',
      scale: { type: 'factor', value: 1 },
      suffix: '',
      enabled: true,
      raster: {
        scale: { type: 'factor', value: 1 },
        transparency: false,
        colorProfile: 'display-p3',
      },
    });
    expect(config.color?.profile).toBe('display-p3');
    expect(config.raster?.transparency).toBe(false);
  });

  it('converts multiple presets for one node in order', () => {
    const configs = legacyPresetsToConfigurations('n1', [
      { id: 'a', format: 'png', scale: { type: 'factor', value: 1 }, suffix: '', enabled: true },
      { id: 'b', format: 'svg', scale: { type: 'factor', value: 1 }, suffix: '', enabled: true },
    ]);
    expect(configs.map((c) => c.format)).toEqual(['png', 'svg']);
  });
});

describe('configurationToLegacyPreset', () => {
  it('round-trips a legacy-compatible configuration', () => {
    const config = createExportConfiguration({
      id: 'p1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 2 },
      suffix: '@2x',
    });
    const preset = configurationToLegacyPreset(config);
    expect(preset).toMatchObject({
      id: 'p1',
      format: 'png',
      scale: { type: 'factor', value: 2 },
      suffix: '@2x',
      enabled: true,
    });
  });

  it('returns undefined for canonical-only formats', () => {
    const tiff = createExportConfiguration({
      id: 'p1',
      target: { type: 'document' },
      format: 'tiff',
    });
    expect(configurationToLegacyPreset(tiff)).toBeUndefined();

    const resolution = createExportConfiguration({
      id: 'p2',
      target: { type: 'document' },
      format: 'png',
      scale: { mode: 'resolution', dpi: 300 },
    });
    expect(configurationToLegacyPreset(resolution)).toMatchObject({
      format: 'png',
      scale: { type: 'resolution', dpi: 300 },
    });
  });

  it('preserves legacy-compatible print settings', () => {
    const config = createExportConfiguration({
      id: 'print-1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x4',
      color: {
        profile: 'cmyk',
        iccProfile: 'FOGRA39',
        renderingIntent: 'relative',
        blackPointCompensation: true,
        convertToDestination: true,
      },
      print: {
        bleedMm: 3,
        includeCropMarks: true,
        includeRegistrationMarks: true,
        includeColorBars: false,
        includePageInformation: false,
        markOffsetMm: 2,
        enforceDpi: 300,
        downsampling: 'bicubic',
        compression: 'auto',
        convertToDestination: true,
        overprint: true,
        spreads: false,
      },
      vector: {
        text: 'outline',
        embedFonts: false,
        embedImages: true,
        styleMode: 'inline',
        minify: false,
        precision: 3,
        idMode: 'layer-name',
      },
    });

    expect(configurationToLegacyPreset(config)?.print).toMatchObject({
      iccProfile: 'FOGRA39',
      renderingIntent: 'relative',
      blackPointCompensation: true,
      bleedMm: 3,
      includeCropMarks: true,
      includeRegistrationMarks: true,
      enforceDpi: 300,
      overprintBlack: true,
      outlineText: true,
    });
  });
});

describe('legacyJobToJobSpec', () => {
  it('maps a raster job to a canonical spec', () => {
    const spec = legacyJobToJobSpec({
      presetId: 'p1',
      nodeId: 'n1',
      nodeName: 'Logo',
      format: 'png',
      fileName: 'Logo@2x.png',
      scale: { type: 'factor', value: 2 },
      dimensions: { w: 200, h: 100 },
      estimatedSize: 1024,
      status: 'pending',
    });
    expect(spec).toMatchObject({
      format: 'png',
      fileName: 'Logo@2x.png',
      nodeId: 'n1',
      rasterized: true,
      resolvedDimensions: { width: 200, height: 100 },
    });
  });

  it('marks PDF jobs as requiring an image manifest', () => {
    const spec = legacyJobToJobSpec({
      presetId: 'p1',
      nodeId: 'n1',
      nodeName: 'Page',
      format: 'pdf-screen',
      fileName: 'Page.pdf',
      dimensions: { w: 100, h: 100 },
      estimatedSize: 1024,
      status: 'pending',
    });
    expect(spec?.format).toBe('pdf');
    expect(spec?.requiresImageManifest).toBe(true);
  });
});

function isValidCanonicalFormat(format: string): boolean {
  return [
    'png',
    'jpeg',
    'webp',
    'avif',
    'gif',
    'svg',
    'pdf',
    'pdf-x1a',
    'pdf-x3',
    'pdf-x4',
    'tiff',
    'bmp',
    'ico',
    'eps',
    'psd',
    'json',
    'css',
    'html',
    'react',
    'flutter',
    'swiftui',
  ].includes(format);
}
