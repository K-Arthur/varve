import { describe, expect, it } from 'vitest';
import type { ExportJob, ExportPreset, ExportSettings } from './export-types';

describe('ExportPreset', () => {
  it('can represent a PNG preset at 2x', () => {
    const preset: ExportPreset = {
      id: 'preset-1',
      format: 'png',
      scale: { type: 'factor', value: 2 },
      suffix: '@2x',
      enabled: true,
      raster: { scale: { type: 'factor', value: 2 }, transparency: true, colorProfile: 'srgb' },
    };
    expect(preset.format).toBe('png');
    expect(preset.scale).toEqual({ type: 'factor', value: 2 });
  });

  it('can represent a PDF/X-1a preset with print options', () => {
    const preset: ExportPreset = {
      id: 'preset-2',
      format: 'pdf-x1a',
      scale: { type: 'factor', value: 1 },
      suffix: '',
      enabled: true,
      print: { iccProfile: 'FOGRA39', bleedMm: 3, includeCropMarks: true, outlineText: true },
    };
    expect(preset.format).toBe('pdf-x1a');
    expect(preset.print?.iccProfile).toBe('FOGRA39');
  });

  it('can represent a React+Tailwind code preset', () => {
    const preset: ExportPreset = {
      id: 'preset-3',
      format: 'react-tailwind',
      scale: { type: 'factor', value: 1 },
      suffix: '',
      enabled: true,
      code: { stylingMode: 'tailwind', tokenAware: true, units: 'rem' },
    };
    expect(preset.code?.tokenAware).toBe(true);
  });
});

describe('ExportSettings', () => {
  it('has sensible defaults shape', () => {
    const settings: ExportSettings = {
      defaultScale: { type: 'factor', value: 1 },
      defaultFormat: 'png',
      defaultColorProfile: 'srgb',
      defaultDestination: null,
      defaultFilenameTemplate: '{name}{suffix}.{ext}',
      defaultOutlineText: true,
      defaultIccProfile: 'FOGRA39',
      defaultBleedMm: 3,
      defaultRenderingIntent: 'relative',
      lastUsedPerDocument: {},
    };
    expect(settings.defaultIccProfile).toBe('FOGRA39');
  });
});

describe('ExportJob', () => {
  it('tracks status transitions', () => {
    const job: ExportJob = {
      presetId: 'p1',
      nodeId: 'n1',
      nodeName: 'Rect',
      format: 'png',
      fileName: 'Rect@2x.png',
      dimensions: { w: 100, h: 100 },
      estimatedSize: 5000,
      status: 'pending',
    };
    expect(job.status).toBe('pending');
    const running: ExportJob = { ...job, status: 'running' };
    expect(running.status).toBe('running');
    const done: ExportJob = { ...job, status: 'done', result: new Uint8Array([1, 2, 3]) };
    expect(done.result).toBeInstanceOf(Uint8Array);
  });
});
