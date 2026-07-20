import { describe, expect, it } from 'vitest';
import {
  addCustomPreset,
  CURRENT_PRESET_LIBRARY_SCHEMA_VERSION,
  DEFAULT_PRESET_LIBRARY_STATE,
  dedupeName,
  deleteCustomPreset,
  duplicateCustomPreset,
  loadPresetLibrary,
  type PresetKVStore,
  type PresetLibraryState,
  recordRecent,
  resetBuiltinDerivedState,
  savePresetLibrary,
  toggleFavorite,
  updateCustomPreset,
  validateCustomPreset,
} from './presetStore';

function createFakeKv(initial?: Record<string, string>): PresetKVStore {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    async getAppSetting(key) {
      return map.get(key) ?? null;
    },
    async setAppSetting(key, value) {
      map.set(key, value);
    },
  };
}

const baseInput = {
  name: 'My Card',
  width: 100,
  height: 50,
  unit: 'px' as const,
  orientation: 'landscape' as const,
};

describe('loadPresetLibrary', () => {
  it('returns the default state when nothing is persisted', async () => {
    const kv = createFakeKv();
    expect(await loadPresetLibrary(kv)).toEqual(DEFAULT_PRESET_LIBRARY_STATE);
  });

  it('returns the default state on corrupted (non-JSON) data', async () => {
    const kv = createFakeKv({ 'presets:library': 'not json{{{' });
    expect(await loadPresetLibrary(kv)).toEqual(DEFAULT_PRESET_LIBRARY_STATE);
  });

  it('returns the default state when getAppSetting rejects', async () => {
    const kv: PresetKVStore = {
      async getAppSetting() {
        throw new Error('IPC failure');
      },
      async setAppSetting() {},
    };
    expect(await loadPresetLibrary(kv)).toEqual(DEFAULT_PRESET_LIBRARY_STATE);
  });

  it('drops an individual corrupted preset entry rather than the whole library', async () => {
    const kv = createFakeKv({
      'presets:library': JSON.stringify({
        schemaVersion: 1,
        presets: [
          {
            id: 'good',
            name: 'Good',
            category: 'custom',
            width: 10,
            height: 10,
            unit: 'px',
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'bad',
            name: '',
            category: 'custom',
            width: -5,
            height: 10,
            unit: 'px',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        favorites: {},
        recentIds: [],
      }),
    });
    const state = await loadPresetLibrary(kv);
    expect(state.presets).toHaveLength(1);
    expect(state.presets[0]?.id).toBe('good');
  });

  it('sanitizes malformed favorites/recentIds shapes instead of throwing', async () => {
    const kv = createFakeKv({
      'presets:library': JSON.stringify({
        schemaVersion: 1,
        presets: [],
        favorites: { a: 'not-a-number', b: 123 },
        recentIds: [1, 2, 'valid'],
      }),
    });
    const state = await loadPresetLibrary(kv);
    expect(state.favorites).toEqual({ b: 123 });
    expect(state.recentIds).toEqual(['valid']);
  });

  it('round-trips through savePresetLibrary', async () => {
    const kv = createFakeKv();
    const { state } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    await savePresetLibrary(kv, state);
    const loaded = await loadPresetLibrary(kv);
    expect(loaded.presets).toHaveLength(1);
    expect(loaded.presets[0]?.name).toBe('My Card');
    expect(loaded.schemaVersion).toBe(CURRENT_PRESET_LIBRARY_SCHEMA_VERSION);
  });
});

describe('validateCustomPreset', () => {
  it('accepts a well-formed custom preset', () => {
    const { preset } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    expect(validateCustomPreset(preset)).toBeNull();
  });

  it('rejects non-objects, wrong category, and bad dimensions', () => {
    expect(validateCustomPreset(null)).not.toBeNull();
    expect(validateCustomPreset('x')).not.toBeNull();
    expect(validateCustomPreset({ id: 'x', name: 'x', category: 'blank' })).not.toBeNull();
    expect(
      validateCustomPreset({
        id: 'x',
        name: 'x',
        category: 'custom',
        width: -1,
        height: 10,
        unit: 'px',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).not.toBeNull();
  });
});

describe('addCustomPreset', () => {
  it('generates an id, timestamps, and forces category "custom"', () => {
    const { preset, error } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    expect(error).toBeNull();
    expect(preset?.id).toBeTruthy();
    expect(preset?.category).toBe('custom');
    expect(preset?.createdAt).toBeGreaterThan(0);
    expect(preset?.updatedAt).toBe(preset?.createdAt);
  });

  it('rejects invalid dimensions without mutating state', () => {
    const { state, preset, error } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, {
      ...baseInput,
      width: 0,
    });
    expect(error).not.toBeNull();
    expect(preset).toBeNull();
    expect(state).toBe(DEFAULT_PRESET_LIBRARY_STATE);
  });

  it('auto-suffixes a duplicate name instead of overwriting', () => {
    const { state: s1 } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    const { preset } = addCustomPreset(s1, baseInput);
    expect(preset?.name).toBe('My Card (2)');
  });
});

describe('updateCustomPreset', () => {
  it('patches fields and bumps updatedAt', async () => {
    const { state: s1, preset } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    await new Promise((r) => setTimeout(r, 2));
    const { state: s2, error } = updateCustomPreset(s1, preset?.id ?? '', { width: 200 });
    expect(error).toBeNull();
    const updated = s2.presets.find((p) => p.id === preset?.id);
    expect(updated?.width).toBe(200);
    expect(updated?.updatedAt).toBeGreaterThan(preset?.createdAt ?? 0);
  });

  it('rejects a patch that produces invalid dimensions, leaving state unchanged', () => {
    const { state: s1, preset } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    const { state: s2, error } = updateCustomPreset(s1, preset?.id ?? '', { width: -10 });
    expect(error).not.toBeNull();
    expect(s2).toBe(s1);
  });

  it('errors on an unknown id without throwing', () => {
    const { error } = updateCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, 'nope', { width: 10 });
    expect(error).not.toBeNull();
  });
});

describe('duplicateCustomPreset', () => {
  it('appends "Copy" and gets its own id/timestamps', () => {
    const { state: s1, preset: original } = addCustomPreset(
      DEFAULT_PRESET_LIBRARY_STATE,
      baseInput,
    );
    const { preset: copy } = duplicateCustomPreset(s1, original?.id ?? '');
    expect(copy?.name).toBe('My Card Copy');
    expect(copy?.id).not.toBe(original?.id);
  });
});

describe('deleteCustomPreset', () => {
  it('removes the preset and cleans up its favorite/recent entries', () => {
    const { state: s1, preset } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    const s2 = toggleFavorite(s1, preset?.id ?? '');
    const s3 = recordRecent(s2, preset?.id ?? '');
    const s4 = deleteCustomPreset(s3, preset?.id ?? '');
    expect(s4.presets).toHaveLength(0);
    expect(s4.favorites[preset?.id ?? '']).toBeUndefined();
    expect(s4.recentIds).not.toContain(preset?.id);
  });
});

describe('toggleFavorite', () => {
  it('adds then removes a favorite timestamp', () => {
    const s1 = toggleFavorite(DEFAULT_PRESET_LIBRARY_STATE, 'a4');
    expect(s1.favorites.a4).toBeGreaterThan(0);
    const s2 = toggleFavorite(s1, 'a4');
    expect(s2.favorites.a4).toBeUndefined();
  });
});

describe('recordRecent', () => {
  it('dedupes and moves an existing id to the front', () => {
    let state: PresetLibraryState = DEFAULT_PRESET_LIBRARY_STATE;
    state = recordRecent(state, 'a');
    state = recordRecent(state, 'b');
    state = recordRecent(state, 'a');
    expect(state.recentIds).toEqual(['a', 'b']);
  });

  it('caps the list at 12 entries', () => {
    let state: PresetLibraryState = DEFAULT_PRESET_LIBRARY_STATE;
    for (let i = 0; i < 20; i++) {
      state = recordRecent(state, `id-${i}`);
    }
    expect(state.recentIds).toHaveLength(12);
    expect(state.recentIds[0]).toBe('id-19');
  });
});

describe('resetBuiltinDerivedState', () => {
  it('clears favorites/recents but keeps custom presets', () => {
    const { state: s1, preset } = addCustomPreset(DEFAULT_PRESET_LIBRARY_STATE, baseInput);
    const s2 = toggleFavorite(recordRecent(s1, preset?.id ?? ''), preset?.id ?? '');
    const s3 = resetBuiltinDerivedState(s2);
    expect(s3.favorites).toEqual({});
    expect(s3.recentIds).toEqual([]);
    expect(s3.presets).toHaveLength(1);
  });
});

describe('dedupeName', () => {
  it('returns the name unchanged when not taken', () => {
    expect(dedupeName(['A', 'B'], 'C')).toBe('C');
  });

  it('suffixes incrementally on collision', () => {
    expect(dedupeName(['C'], 'C')).toBe('C (2)');
    expect(dedupeName(['C', 'C (2)'], 'C')).toBe('C (3)');
  });
});
