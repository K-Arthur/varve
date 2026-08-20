/**
 * Brush library hook — the editor's view of user brush state.
 *
 * Mirrors `usePresetLibrary`: mutators read the current state from a ref so a
 * caller can make several edits in one event handler without them clobbering
 * each other, and persistence is best-effort so a storage failure never blocks
 * an edit the user already saw succeed.
 */
import type { Platform } from '@varve/platform';
import type { BrushPreset } from '@varve/scene';
import { clampBrushPreset, validateBrushPreset } from '@varve/scene';
import {
  addBrushEntry,
  type BrushCategory,
  type BrushLibraryEntry,
  type BrushLibraryState,
  DEFAULT_BRUSH_LIBRARY_STATE,
  dedupeBrushName,
  deleteBrushEntry,
  loadBrushLibrary,
  recordBrushRecent,
  saveBrushLibrary,
  toggleBrushFavorite,
  updateBrushEntry,
} from '@varve/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseBrushLibraryResult {
  entries: BrushLibraryEntry[];
  /** Custom presets, decoded and clamped, keyed by id. */
  presets: Record<string, BrushPreset>;
  favoriteIds: Set<string>;
  recentIds: string[];
  saveBrush: (preset: BrushPreset, category?: BrushCategory, tags?: string[]) => BrushPreset;
  renameBrush: (id: string, name: string) => void;
  deleteBrush: (id: string) => void;
  toggleFavorite: (id: string) => void;
  recordRecent: (id: string) => void;
  importPresets: (presets: readonly BrushPreset[]) => void;
}

export function useBrushLibrary(platform: Platform | undefined): UseBrushLibraryResult {
  const [state, setState] = useState<BrushLibraryState>(DEFAULT_BRUSH_LIBRARY_STATE);
  const ref = useRef(state);
  ref.current = state;

  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    void loadBrushLibrary(platform).then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const persist = useCallback(
    (next: BrushLibraryState) => {
      ref.current = next;
      setState(next);
      if (platform) void saveBrushLibrary(platform, next);
    },
    [platform],
  );

  const saveBrush = useCallback<UseBrushLibraryResult['saveBrush']>(
    (preset, category = 'custom', tags = []) => {
      const existingNames = ref.current.entries
        .filter((e) => e.id !== preset.id)
        .map((e) => e.name);
      const named = { ...clampBrushPreset(preset), name: dedupeBrushName(existingNames, preset.name) };
      persist(
        addBrushEntry(ref.current, {
          id: named.id,
          name: named.name,
          category,
          tags,
          preset: named as unknown as Record<string, unknown>,
          derivedFrom: preset.id.startsWith('built-in-') ? preset.id : undefined,
        }),
      );
      return named;
    },
    [persist],
  );

  const renameBrush = useCallback(
    (id: string, name: string) => {
      const current = ref.current.entries.find((e) => e.id === id);
      if (!current) return;
      // The id is the identity; renaming must not disturb favourites or refs.
      const preset = { ...(current.preset as unknown as BrushPreset), name };
      persist(updateBrushEntry(ref.current, id, { name, preset: preset as unknown as Record<string, unknown> }));
    },
    [persist],
  );

  const deleteBrush = useCallback(
    (id: string) => persist(deleteBrushEntry(ref.current, id)),
    [persist],
  );
  const toggleFavorite = useCallback(
    (id: string) => persist(toggleBrushFavorite(ref.current, id)),
    [persist],
  );
  const recordRecent = useCallback(
    (id: string) => persist(recordBrushRecent(ref.current, id)),
    [persist],
  );

  const importPresets = useCallback<UseBrushLibraryResult['importPresets']>(
    (presets) => {
      let next = ref.current;
      for (const preset of presets) {
        next = addBrushEntry(next, {
          id: preset.id,
          name: preset.name,
          category: 'imported',
          tags: [],
          preset: clampBrushPreset(preset) as unknown as Record<string, unknown>,
        });
      }
      persist(next);
    },
    [persist],
  );

  const presets = useMemo(() => {
    const out: Record<string, BrushPreset> = {};
    for (const entry of state.entries) {
      // Entries are persisted user data, so validate on the way back in
      // rather than trusting whatever was on disk.
      const preset = validateBrushPreset(entry.preset);
      if (preset) out[entry.id] = preset;
    }
    return out;
  }, [state.entries]);

  const favoriteIds = useMemo(() => new Set(Object.keys(state.favorites)), [state.favorites]);

  return {
    entries: state.entries,
    presets,
    favoriteIds,
    recentIds: state.recentIds,
    saveBrush,
    renameBrush,
    deleteBrush,
    toggleFavorite,
    recordRecent,
    importPresets,
  };
}
