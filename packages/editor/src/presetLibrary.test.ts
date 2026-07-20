/**
 * usePresetLibrary tests — custom-preset CRUD, favorites/recents, and
 * cross-platform persistence via the app-setting KV store.
 */
import type { Platform } from '@strata/platform';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePresetLibrary } from './presetLibrary';

function createFakePlatform(): Platform {
  const map = new Map<string, string>();
  return {
    getAppSetting: async (key: string) => map.get(key) ?? null,
    setAppSetting: async (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Platform;
}

const baseInput = {
  name: 'My Card',
  width: 100,
  height: 50,
  unit: 'px' as const,
  orientation: 'landscape' as const,
};

describe('usePresetLibrary', () => {
  it('starts empty with no platform', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    expect(result.current.customPresets).toEqual([]);
    expect(result.current.favoriteIds.size).toBe(0);
    expect(result.current.recentIds).toEqual([]);
  });

  it('adds a custom preset and reflects it immediately', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    act(() => {
      result.current.addCustomPreset(baseInput);
    });
    expect(result.current.customPresets).toHaveLength(1);
    expect(result.current.customPresets[0]?.name).toBe('My Card');
  });

  it('rejects invalid dimensions and surfaces the error', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    let addResult: ReturnType<typeof result.current.addCustomPreset> | undefined;
    act(() => {
      addResult = result.current.addCustomPreset({ ...baseInput, width: -5 });
    });
    expect(addResult?.error).not.toBeNull();
    expect(result.current.customPresets).toHaveLength(0);
  });

  it('updates, duplicates, and deletes a custom preset', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    let id = '';
    act(() => {
      const { preset } = result.current.addCustomPreset(baseInput);
      id = preset?.id ?? '';
    });

    act(() => {
      result.current.updateCustomPreset(id, { width: 200 });
    });
    expect(result.current.customPresets.find((p) => p.id === id)?.width).toBe(200);

    act(() => {
      result.current.duplicateCustomPreset(id);
    });
    expect(result.current.customPresets).toHaveLength(2);
    expect(result.current.customPresets[1]?.name).toBe('My Card Copy');

    act(() => {
      result.current.deleteCustomPreset(id);
    });
    expect(result.current.customPresets).toHaveLength(1);
    expect(result.current.customPresets[0]?.name).toBe('My Card Copy');
  });

  it('toggles favorites and records recents', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    act(() => {
      result.current.toggleFavorite('a4');
    });
    expect(result.current.favoriteIds.has('a4')).toBe(true);
    act(() => {
      result.current.toggleFavorite('a4');
    });
    expect(result.current.favoriteIds.has('a4')).toBe(false);

    act(() => {
      result.current.recordRecent('ig-post');
    });
    expect(result.current.recentIds).toEqual(['ig-post']);
  });

  it('resetBuiltinDerivedState clears favorites/recents but keeps custom presets', () => {
    const { result } = renderHook(() => usePresetLibrary(undefined));
    act(() => {
      result.current.addCustomPreset(baseInput);
      result.current.toggleFavorite('a4');
      result.current.recordRecent('a4');
    });
    act(() => {
      result.current.resetBuiltinDerivedState();
    });
    expect(result.current.favoriteIds.size).toBe(0);
    expect(result.current.recentIds).toEqual([]);
    expect(result.current.customPresets).toHaveLength(1);
  });

  it('loads persisted state from the platform on mount', async () => {
    const platform = createFakePlatform();
    const { result: first } = renderHook(() => usePresetLibrary(platform));
    act(() => {
      first.current.addCustomPreset(baseInput);
    });
    await waitFor(() => expect(first.current.customPresets).toHaveLength(1));

    const { result: second } = renderHook(() => usePresetLibrary(platform));
    await waitFor(() => expect(second.current.customPresets).toHaveLength(1));
    expect(second.current.customPresets[0]?.name).toBe('My Card');
  });

  it('persists mutations through to the platform store', async () => {
    const platform = createFakePlatform();
    const { result } = renderHook(() => usePresetLibrary(platform));
    act(() => {
      result.current.toggleFavorite('a4');
    });
    const raw = await platform.getAppSetting('presets:library');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? '{}').favorites.a4).toBeGreaterThan(0);
  });
});
