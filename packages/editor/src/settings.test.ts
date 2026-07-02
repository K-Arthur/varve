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
});
