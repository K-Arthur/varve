import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, resetSettings, saveSettings, updateSettings } from './settings';

const STORAGE_KEY = 'strata-editor-settings';

beforeEach(() => {
  localStorage.clear();
});

describe('loadSettings', () => {
  it('loads defaults when nothing saved', () => {
    const s = loadSettings();
    expect(s.export.defaultFormat).toBe('png');
    expect(s.export.defaultScale).toEqual({ type: 'factor', value: 2 });
    expect(s.appearance.theme).toBe('light');
    expect(s.startup.showBrandedLoader).toBe(true);
    expect(s.viewport.snapEnabled).toBe(true);
    expect(s.viewport.guidesVisible).toBe(true);
    expect(s.viewport.snapGrid).toBe(8);
    expect(s.render.memoryBudget).toBe('medium');
    expect(s.performance.reducedMotionOverride).toBe('system');
    expect(s.performance.showPerformanceDiagnostics).toBe(false);
  });

  it('merges a partial performance/render patch without dropping unrelated fields', () => {
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({
        render: { memoryBudget: 'low' },
        performance: { reducedMotionOverride: 'always' },
      }),
    );
    const s = loadSettings();
    expect(s.render.memoryBudget).toBe('low');
    expect(s.render.preferWebGpu).toBe(false);
    expect(s.performance.reducedMotionOverride).toBe('always');
    expect(s.performance.showPerformanceDiagnostics).toBe(false);
  });

  it('performance diagnostics default to false for new installs, missing values, and malformed persisted data', () => {
    // Nothing persisted at all.
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(false);

    // Persisted performance block without the field (pre-migration installs).
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({ performance: { reducedMotionOverride: 'always' } }),
    );
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(false);

    // An explicit, intentionally-saved true value is preserved.
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({ performance: { showPerformanceDiagnostics: true } }),
    );
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(true);

    // Corrupt top-level JSON falls back to defaults entirely.
    localStorage.setItem('strata-editor-settings', '{not valid json');
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(false);
  });

  it('resetSettings turns performance diagnostics back off', () => {
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({ performance: { showPerformanceDiagnostics: true } }),
    );
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(true);
    const reset = resetSettings();
    expect(reset.performance.showPerformanceDiagnostics).toBe(false);
    expect(loadSettings().performance.showPerformanceDiagnostics).toBe(false);
  });

  it('persists and loads startup settings', () => {
    const s = loadSettings();
    s.startup.showBrandedLoader = false;
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded.startup.showBrandedLoader).toBe(false);
  });

  it('merges partial startup settings gracefully', () => {
    localStorage.setItem(
      'strata-editor-settings',
      JSON.stringify({ export: { defaultFormat: 'svg' }, startup: { showBrandedLoader: false } }),
    );
    const s = loadSettings();
    expect(s.export.defaultFormat).toBe('svg');
    expect(s.startup.showBrandedLoader).toBe(false);
    expect(s.appearance.reduceMotion).toBe(false);
  });

  it('round-trips through localStorage', () => {
    const s = loadSettings();
    s.export.defaultFormat = 'svg';
    s.export.defaultBleedMm = 5;
    saveSettings(s);
    const loaded = loadSettings();
    expect(loaded.export.defaultFormat).toBe('svg');
    expect(loaded.export.defaultBleedMm).toBe(5);
  });

  it('handles corrupt JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json');
    const s = loadSettings();
    expect(s.export.defaultFormat).toBe('png');
  });

  it('preserves a persisted wide-gamut export colour space (now supported)', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ export: { defaultColorProfile: 'display-p3' } }),
    );
    expect(loadSettings().export.defaultColorProfile).toBe('display-p3');
  });

  it('sanitizes unknown persisted colour spaces to sRGB', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ export: { defaultColorProfile: 'rec2100-pq' } }),
    );
    expect(loadSettings().export.defaultColorProfile).toBe('srgb');
  });
});

describe('updateSettings', () => {
  it('partial update merges correctly', () => {
    const s = updateSettings({
      export: {
        defaultFormat: 'webp',
        defaultScale: { type: 'factor', value: 2 },
        defaultColorProfile: 'srgb',
        defaultDestination: null,
        defaultFilenameTemplate: '{name}{suffix}.{ext}',
        defaultOutlineText: false,
        defaultIccProfile: 'FOGRA39',
        defaultBleedMm: 3,
        defaultRenderingIntent: 'relative',
        lastUsedPerDocument: {},
      },
    });
    expect(s.export.defaultFormat).toBe('webp');
    expect(s.export.defaultScale).toEqual({ type: 'factor', value: 2 });
    expect(s.appearance.theme).toBe('light');
  });
});

describe('resetSettings', () => {
  it('restores factory defaults', () => {
    const s = updateSettings({
      export: {
        defaultFormat: 'pdf-screen',
        defaultScale: { type: 'factor', value: 2 },
        defaultColorProfile: 'srgb',
        defaultDestination: null,
        defaultFilenameTemplate: '{name}{suffix}.{ext}',
        defaultOutlineText: false,
        defaultIccProfile: 'FOGRA39',
        defaultBleedMm: 10,
        defaultRenderingIntent: 'relative',
        lastUsedPerDocument: {},
      },
    });
    expect(s.export.defaultFormat).toBe('pdf-screen');
    expect(s.export.defaultBleedMm).toBe(10);
    const r = resetSettings();
    expect(r.export.defaultFormat).toBe('png');
    expect(r.export.defaultBleedMm).toBe(3);
  });

  it('restores performance settings to factory defaults', () => {
    updateSettings({
      render: { memoryBudget: 'high' },
      performance: { reducedMotionOverride: 'never' },
    });
    const r = resetSettings();
    expect(r.render.memoryBudget).toBe('medium');
    expect(r.performance.reducedMotionOverride).toBe('system');
  });
});
