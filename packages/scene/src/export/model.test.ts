import { describe, expect, it } from 'vitest';
import {
  createExportConfiguration,
  createExportDefaults,
  createPrintExportSettings,
  EXPORT_MODEL_VERSION,
  ExportConfigurationError,
  exportConfigurationsEqual,
  isFiniteExportScale,
  isValidExportFormat,
  isValidExportScale,
  isValidExportTarget,
  migrateExportConfiguration,
  serializeExportConfiguration,
  validateExportConfiguration,
} from './model';

describe('createExportConfiguration', () => {
  it('defaults scale to 1x and enables the configuration', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
    });
    expect(config).toMatchObject({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1 },
      enabled: true,
      version: EXPORT_MODEL_VERSION,
    });
  });

  it('defaults format-specific sub-settings eagerly', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'document' },
      format: 'jpeg',
      raster: { quality: 0.85 },
    });
    expect(config.raster).toMatchObject({
      quality: 0.85,
      transparency: true,
      bitDepth: 32,
      stripMetadata: true,
    });
  });

  it('supports every documented target kind', () => {
    const targets = [
      { type: 'selection' as const, nodeIds: ['n1', 'n2'] },
      { type: 'selection' as const },
      { type: 'node' as const, nodeId: 'n1' },
      { type: 'frame' as const, nodeId: 'f1' },
      { type: 'slice' as const, sliceId: 's1' },
      { type: 'page' as const, pageId: 'p1' },
      { type: 'pages' as const, pageIds: ['p1', 'p2'] },
      { type: 'document' as const },
    ];
    for (const target of targets) {
      const config = createExportConfiguration({ id: 'c', target, format: 'png' });
      expect(isValidExportTarget(config.target)).toBe(true);
    }
  });
});

describe('isValidExportScale', () => {
  it('accepts multiplier, width/height with unit, and resolution', () => {
    expect(isValidExportScale({ mode: 'multiplier', value: 2 })).toBe(true);
    expect(isValidExportScale({ mode: 'width', value: 400, unit: 'px' })).toBe(true);
    expect(isValidExportScale({ mode: 'width', value: 3, unit: 'mm' })).toBe(true);
    expect(isValidExportScale({ mode: 'height', value: 200, unit: 'px' })).toBe(true);
    expect(isValidExportScale({ mode: 'resolution', dpi: 300 })).toBe(true);
  });

  it('rejects non-positive and non-finite values', () => {
    expect(isValidExportScale({ mode: 'multiplier', value: 0 })).toBe(false);
    expect(isValidExportScale({ mode: 'multiplier', value: -1 })).toBe(false);
    expect(isValidExportScale({ mode: 'multiplier', value: Number.NaN })).toBe(false);
    expect(isValidExportScale({ mode: 'resolution', dpi: 0 })).toBe(false);
    expect(isValidExportScale({ mode: 'resolution', dpi: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it('exposes isFiniteExportScale guard', () => {
    expect(isFiniteExportScale({ mode: 'multiplier', value: 3 })).toBe(true);
    expect(isFiniteExportScale({ mode: 'width', value: 100, unit: 'px' })).toBe(true);
    expect(isFiniteExportScale({ mode: 'multiplier', value: 0 })).toBe(false);
  });
});

describe('isValidExportFormat', () => {
  it('accepts raster, vector, print, and codegen formats', () => {
    for (const format of [
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
    ]) {
      expect(isValidExportFormat(format), format).toBe(true);
    }
  });

  it('rejects unknown formats', () => {
    expect(isValidExportFormat('docx')).toBe(false);
    expect(isValidExportFormat(42)).toBe(false);
    expect(isValidExportFormat(undefined)).toBe(false);
  });
});

describe('validateExportConfiguration', () => {
  it('accepts a valid configuration', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'svg',
    });
    expect(() => validateExportConfiguration(config)).not.toThrow();
  });

  it('rejects unknown formats', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'document' },
      format: 'png',
    });
    const mutated = { ...config, format: 'docx' } as unknown as Parameters<
      typeof validateExportConfiguration
    >[0];
    expect(() => validateExportConfiguration(mutated)).toThrow(ExportConfigurationError);
  });

  it('rejects future model versions with a precise message', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'document' },
      format: 'png',
    });
    const future = { ...config, version: 99 };
    expect(() => validateExportConfiguration(future)).toThrow(/newer than this app supports/);
  });
});

describe('migrateExportConfiguration', () => {
  it('round-trips a persisted configuration with defaults', () => {
    const config = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'webp',
      scale: { mode: 'multiplier', value: 2 },
      suffix: '@2x',
      raster: { transparency: false, quality: 0.8 },
    });
    const migrated = migrateExportConfiguration(JSON.parse(JSON.stringify(config)));
    expect(migrated).toEqual(config);
  });

  it('preserves unknown future fields instead of dropping them', () => {
    const migrated = migrateExportConfiguration({
      id: 'c1',
      target: { type: 'document' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1 },
      version: 1,
      futureSetting: { animated: true },
    });
    expect(migrated.unknownFields).toEqual({ futureSetting: { animated: true } });
  });

  it('fills defaulted sub-settings from a sparse persisted object', () => {
    const migrated = migrateExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'pdf-x4',
      scale: { mode: 'multiplier', value: 1 },
      print: { bleedMm: 5 },
    });
    expect(migrated.print).toMatchObject({
      bleedMm: 5,
      includeCropMarks: false,
      enforceDpi: 300,
      spreads: false,
    });
  });

  it('normalizes missing enabled/version to safe defaults', () => {
    const migrated = migrateExportConfiguration({
      id: 'c1',
      target: { type: 'document' },
      format: 'png',
      scale: { mode: 'multiplier', value: 1 },
    });
    expect(migrated.enabled).toBe(true);
    expect(migrated.version).toBe(1);
  });

  it('throws for structurally unrecoverable input', () => {
    expect(() => migrateExportConfiguration(null)).toThrow(ExportConfigurationError);
    expect(() =>
      migrateExportConfiguration({
        id: '',
        target: { type: 'document' },
        format: 'png',
        scale: { mode: 'multiplier', value: 1 },
      }),
    ).toThrow(ExportConfigurationError);
    expect(() =>
      migrateExportConfiguration({
        id: 'c1',
        target: { type: 'document' },
        format: 'pdfx9',
        scale: { mode: 'multiplier', value: 1 },
      }),
    ).toThrow(/Unsupported export format/);
  });
});

describe('deterministic serialization', () => {
  it('serializes equal configurations identically regardless of key order', () => {
    const a = createExportConfiguration({
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'svg',
      suffix: '@2x',
    });
    const b = migrateExportConfiguration(JSON.parse(JSON.stringify(a)));
    expect(serializeExportConfiguration(a)).toBe(serializeExportConfiguration(b));
    expect(exportConfigurationsEqual(a, b)).toBe(true);
  });

  it('distinguishes configurations that differ only in settings', () => {
    const base = {
      id: 'c1',
      target: { type: 'node', nodeId: 'n1' } as const,
      format: 'jpeg' as const,
    };
    const a = createExportConfiguration({ ...base, raster: { quality: 0.8 } });
    const b = createExportConfiguration({ ...base, raster: { quality: 0.9 } });
    expect(exportConfigurationsEqual(a, b)).toBe(false);
  });
});

describe('createExportDefaults', () => {
  it('provides a complete default set for all format groups', () => {
    const defaults = createExportDefaults();
    expect(defaults.color.profile).toBe('srgb');
    expect(defaults.raster.transparency).toBe(true);
    expect(defaults.vector.text).toBe('preserve');
    expect(defaults.print).toMatchObject({ bleedMm: 3, enforceDpi: 300 });
    expect(defaults.metadata.stripLocalPaths).toBe(true);
    expect(defaults.background.transparent).toBe(true);
    expect(defaults.filenameTemplate).toBe('{name}{suffix}.{ext}');
  });

  it('can derive a print preset from defaults', () => {
    const print = createPrintExportSettings({ includeCropMarks: true, bleedMm: 5 });
    expect(print).toMatchObject({ includeCropMarks: true, bleedMm: 5, enforceDpi: 300 });
  });
});
