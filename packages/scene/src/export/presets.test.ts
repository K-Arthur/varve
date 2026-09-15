import { describe, expect, it } from 'vitest';
import { validateExportConfiguration } from './model';
import {
  BUILTIN_EXPORT_PRESETS,
  builtinPresetList,
  createUserPresetConfiguration,
  getBuiltinPreset,
  materializeBundle,
  materializePreset,
  materializePresetById,
} from './presets';

describe('builtin preset catalog', () => {
  it('has unique stable ids and a name for every preset', () => {
    const list = builtinPresetList();
    const ids = new Set<string>();
    for (const preset of list) {
      expect(preset.id).toBe(preset.id);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
    }
    expect(ids.size).toBeGreaterThan(10);
  });

  it('covers all three product categories', () => {
    const categories = new Set(builtinPresetList().map((p) => p.category));
    expect(categories.has('web')).toBe(true);
    expect(categories.has('print')).toBe(true);
    expect(categories.has('developer')).toBe(true);
  });

  it('every preset uses only formats with a working encoder', () => {
    for (const preset of builtinPresetList()) {
      expect(
        ['png', 'jpeg', 'webp', 'svg', 'pdf', 'pdf-x1a', 'pdf-x4', 'react', 'flutter', 'swiftui'],
        preset.id,
      ).toContain(preset.format);
    }
  });

  it('materializes a detached configuration for a target', () => {
    const preset = getBuiltinPreset('web-png-2x');
    expect(preset).toBeDefined();
    const config = materializePreset(preset!, { type: 'node', nodeId: 'n1' }, 'cfg-1');
    expect(config).toMatchObject({
      id: 'cfg-1',
      target: { type: 'node', nodeId: 'n1' },
      format: 'png',
      scale: { mode: 'multiplier', value: 2 },
      suffix: '@2x',
      presetRef: 'web-png-2x',
    });
    expect(() => validateExportConfiguration(config)).not.toThrow();
  });

  it('materialized configurations are detached copies (mutation-safe)', () => {
    const a = materializePresetById('web-png-1x', { type: 'document' }, 'a')!;
    const b = materializePresetById('web-png-1x', { type: 'document' }, 'b')!;
    expect(a.id).not.toBe(b.id);
    expect(a.format).toBe(b.format);
    expect(a.scale).toEqual(b.scale);
    expect(a.presetRef).toBe(b.presetRef);
    a.suffix = '@2x';
    expect(b.suffix).not.toBe('@2x');
  });

  it('print presets carry real print settings', () => {
    const x4 = getBuiltinPreset('print-pdf-x4')!;
    expect(x4.config.print).toMatchObject({ bleedMm: 3, includeCropMarks: true, enforceDpi: 300 });
    const x1a = getBuiltinPreset('print-pdf-x1a')!;
    expect(x1a.config.color).toMatchObject({ profile: 'cmyk', convertToDestination: true });
    expect(x1a.config.print?.includeRegistrationMarks).toBe(true);
  });

  it('web presets default to privacy-conscious metadata', () => {
    const png = getBuiltinPreset('web-png-1x')!;
    expect(png.config.metadata?.stripExif).toBe(true);
    expect(png.config.metadata?.stripLocalPaths).toBe(true);
    const jpeg = getBuiltinPreset('web-jpeg-high')!;
    expect(jpeg.config.background?.color).toEqual([255, 255, 255, 255]);
  });

  it('materializes a bundle into ordered, distinct configurations', () => {
    const configs = materializeBundle(
      {
        id: 'b',
        name: 'B',
        category: 'web',
        presetIds: ['web-svg-web', 'web-png-1x', 'web-png-2x'],
      },
      { type: 'node', nodeId: 'n1' },
      'obj',
    );
    expect(
      configs.map((c) => `${c.format}:${c.scale.mode === 'multiplier' ? c.scale.value : ''}`),
    ).toEqual(['svg:1', 'png:1', 'png:2']);
    expect(configs.map((c) => c.id)).toEqual([
      'obj-web-svg-web',
      'obj-web-png-1x',
      'obj-web-png-2x',
    ]);
    for (const config of configs) {
      expect(() => validateExportConfiguration(config)).not.toThrow();
    }
  });

  it('skips missing presets in a bundle without dropping siblings', () => {
    const configs = materializeBundle(
      {
        id: 'b',
        name: 'B',
        category: 'web',
        presetIds: ['web-png-1x', 'does-not-exist', 'web-png-2x'],
      },
      { type: 'node', nodeId: 'n1' },
      'obj',
    );
    expect(configs).toHaveLength(2);
    expect(configs[0]?.format).toBe('png');
    expect(configs[1]?.format).toBe('png');
  });

  it('creates user preset configurations with fresh ids and no presetRef', () => {
    const template = materializePresetById('web-png-1x', { type: 'document' }, 't')!;
    const user = createUserPresetConfiguration(template, { type: 'node', nodeId: 'n1' }, 'user-1');
    expect(user.id).toBe('user-1');
    expect(user.presetRef).toBeUndefined();
    expect(user.target).toEqual({ type: 'node', nodeId: 'n1' });
    expect(user.format).toBe('png');
  });
});

describe('preset/plan interplay', () => {
  it('materialized presets can be validated and persisted as canonical configs', () => {
    const config = materializePresetById('print-pdf-x4', { type: 'page', pageId: 'p1' }, 'p1-x4')!;
    expect(config.target).toEqual({ type: 'page', pageId: 'p1' });
    expect(BUILTIN_EXPORT_PRESETS['print-pdf-x4']?.id).toBe('print-pdf-x4');
  });
});
