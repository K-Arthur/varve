/**
 * usePresetLibrary tests (Home) — custom-preset CRUD, favorites/recents, and
 * persistence via the platform's app-setting KV store.
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
  name: 'My Print Preset',
  width: 100,
  height: 50,
  unit: 'mm' as const,
  orientation: 'landscape' as const,
};

describe('usePresetLibrary (home)', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => usePresetLibrary(createFakePlatform()));
    expect(result.current.customPresets).toEqual([]);
    expect(result.current.favoriteIds.size).toBe(0);
    expect(result.current.recentIds).toEqual([]);
  });

  it('adds, updates, duplicates, and deletes a custom preset', () => {
    const { result } = renderHook(() => usePresetLibrary(createFakePlatform()));
    let id = '';
    act(() => {
      const { preset } = result.current.addCustomPreset(baseInput);
      id = preset?.id ?? '';
    });
    expect(result.current.customPresets).toHaveLength(1);

    act(() => {
      result.current.updateCustomPreset(id, { width: 150 });
    });
    expect(result.current.customPresets.find((p) => p.id === id)?.width).toBe(150);

    act(() => {
      result.current.duplicateCustomPreset(id);
    });
    expect(result.current.customPresets).toHaveLength(2);

    act(() => {
      result.current.deleteCustomPreset(id);
    });
    expect(result.current.customPresets).toHaveLength(1);
  });

  it('rejects invalid dimensions', () => {
    const { result } = renderHook(() => usePresetLibrary(createFakePlatform()));
    let error: string | null = null;
    act(() => {
      error = result.current.addCustomPreset({ ...baseInput, width: 0 }).error;
    });
    expect(error).not.toBeNull();
    expect(result.current.customPresets).toHaveLength(0);
  });

  it('handles favorites/recents/reset without touching custom presets, even across multiple synchronous mutations', () => {
    const { result } = renderHook(() => usePresetLibrary(createFakePlatform()));
    act(() => {
      result.current.addCustomPreset(baseInput);
      result.current.toggleFavorite('a4');
      result.current.recordRecent('a4');
    });
    expect(result.current.customPresets).toHaveLength(1);
    expect(result.current.favoriteIds.has('a4')).toBe(true);
    expect(result.current.recentIds).toEqual(['a4']);

    act(() => {
      result.current.resetBuiltinDerivedState();
    });
    expect(result.current.favoriteIds.size).toBe(0);
    expect(result.current.recentIds).toEqual([]);
    expect(result.current.customPresets).toHaveLength(1);
  });

  it('persists across remounts via the platform store', async () => {
    const platform = createFakePlatform();
    const { result: first } = renderHook(() => usePresetLibrary(platform));
    act(() => {
      first.current.addCustomPreset(baseInput);
    });
    await waitFor(() => expect(first.current.customPresets).toHaveLength(1));

    const { result: second } = renderHook(() => usePresetLibrary(platform));
    await waitFor(() => expect(second.current.customPresets).toHaveLength(1));
    expect(second.current.customPresets[0]?.name).toBe('My Print Preset');
  });
});
