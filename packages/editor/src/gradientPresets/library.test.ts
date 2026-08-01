/**
 * Gradient preset library tests — pure store helpers + the hook with a memory
 * platform (persistence round-trip, dedup, favorites, recents).
 */
import { createMemoryPlatform } from '@strata/platform';
import type { GradientPreset } from '@strata/scene';
import { makeGradientPreset } from '@strata/scene';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useGradientPresetLibrary } from './library';

const rgb = (r: number, g = r, b = r) => ({ space: 'rgb' as const, r, g, b, a: 255 });

function preset(name: string, id: string, color: number): GradientPreset {
  return makeGradientPreset({
    id,
    name,
    colorStops: [
      { position: 0, color: rgb(0) },
      { position: 1, color: rgb(color) },
    ],
  });
}

describe('useGradientPresetLibrary', () => {
  it('composes built-ins plus user presets', async () => {
    const platform = createMemoryPlatform();
    const { result } = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    // 12 built-ins present by default.
    expect(result.current.presets.length).toBeGreaterThanOrEqual(12);
    expect(result.current.userPresets).toHaveLength(0);
  });

  it('adds presets and persists across instances', async () => {
    const platform = createMemoryPlatform();
    const first = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    let added: string[] = [];
    act(() => {
      added = first.result.current.addPresets([preset('Mine', 'gpreset-mine', 40)]).addedIds;
    });
    expect(added).toEqual(['gpreset-mine']);

    // New hook instance on the same platform sees the persisted preset.
    const second = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    expect(second.result.current.userPresets.map((p) => p.id)).toEqual(['gpreset-mine']);
  });

  it('merges content-identical presets instead of duplicating', async () => {
    const platform = createMemoryPlatform();
    const { result } = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    const a = preset('A', 'gpreset-1', 40);
    const sameContent = makeGradientPreset({
      id: 'gpreset-2',
      name: 'A copy',
      colorStops: a.colorStops,
    });
    let merged: Map<string, string> | undefined;
    act(() => {
      merged = result.current.addPresets([a, sameContent]).merged;
    });
    expect(result.current.userPresets).toHaveLength(1);
    expect(merged?.get('gpreset-1')).toBe('gpreset-2');
  });

  it('supports update, duplicate, delete, favorite, and recent', async () => {
    const platform = createMemoryPlatform();
    const { result } = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      result.current.addPresets([preset('One', 'gpreset-one', 40)]);
    });
    act(() => {
      result.current.updatePreset('gpreset-one', { name: 'Renamed' });
    });
    expect(result.current.userPresets[0]!.name).toBe('Renamed');

    act(() => {
      result.current.toggleFavorite('gpreset-one');
    });
    expect(result.current.favoriteIds.has('gpreset-one')).toBe(true);

    act(() => {
      result.current.recordRecent('gpreset-one');
    });
    expect(result.current.recentIds).toContain('gpreset-one');

    const dupId = act(() => result.current.duplicatePreset('gpreset-one'));
    expect(dupId).toBeTruthy();
    expect(result.current.userPresets).toHaveLength(2);

    act(() => {
      result.current.deletePreset('gpreset-one');
    });
    expect(result.current.userPresets).toHaveLength(1);
    expect(result.current.favoriteIds.has('gpreset-one')).toBe(false);
  });

  it('drops corrupt persisted entries on load', async () => {
    const platform = createMemoryPlatform();
    await platform.setAppSetting(
      'presets:gradient-map',
      JSON.stringify({
        presets: [{ id: 'bad', colorStops: 'nope' }, 'garbage'],
        favorites: { x: 'y' },
      }),
    );
    const { result } = renderHook(() => useGradientPresetLibrary(platform));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.userPresets).toHaveLength(0);
    expect(result.current.favoriteIds.size).toBe(0);
  });
});
