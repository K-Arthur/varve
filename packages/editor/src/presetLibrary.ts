/**
 * Custom-preset library hook for the editor — loads/persists user-created
 * frame/document presets, favorites, and recents via the platform's
 * cross-backend app-setting store (`@strata/shared`'s presetStore). When no
 * platform is available (e.g. component tests), state stays in-memory only
 * for the session, mirroring onboardingStore's optional-platform handling.
 *
 * Mutators read the current library state directly from this hook's closure
 * (rather than a setState updater) so they can synchronously return the
 * result (e.g. the newly created preset, or a validation error) to the
 * caller — safe here since preset edits are one-at-a-time user actions, not
 * rapid concurrent updates.
 */
import type { Platform } from '@strata/platform';
import {
  type AddCustomPresetResult,
  addCustomPreset as addCustomPresetPure,
  type CustomPreset,
  DEFAULT_PRESET_LIBRARY_STATE,
  deleteCustomPreset as deleteCustomPresetPure,
  duplicateCustomPreset as duplicateCustomPresetPure,
  loadPresetLibrary,
  type PresetLibraryState,
  type PresetMutationResult,
  recordRecent as recordRecentPure,
  resetBuiltinDerivedState as resetBuiltinDerivedStatePure,
  savePresetLibrary,
  toggleFavorite as toggleFavoritePure,
  updateCustomPreset as updateCustomPresetPure,
} from '@strata/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UsePresetLibraryResult {
  customPresets: CustomPreset[];
  favoriteIds: Set<string>;
  recentIds: string[];
  addCustomPreset: (
    input: Omit<CustomPreset, 'id' | 'category' | 'createdAt' | 'updatedAt'>,
  ) => AddCustomPresetResult;
  updateCustomPreset: (
    id: string,
    patch: Partial<Omit<CustomPreset, 'id' | 'category' | 'createdAt'>>,
  ) => PresetMutationResult;
  duplicateCustomPreset: (id: string) => AddCustomPresetResult;
  deleteCustomPreset: (id: string) => void;
  toggleFavorite: (presetId: string) => void;
  recordRecent: (presetId: string) => void;
  resetBuiltinDerivedState: () => void;
}

export function usePresetLibrary(platform: Platform | undefined): UsePresetLibraryResult {
  const [libState, setLibState] = useState<PresetLibraryState>(DEFAULT_PRESET_LIBRARY_STATE);
  const libStateRef = useRef(libState);
  libStateRef.current = libState;

  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    void loadPresetLibrary(platform).then((loaded) => {
      if (!cancelled) setLibState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const persist = useCallback(
    (next: PresetLibraryState) => {
      // Update the ref eagerly (not just via the render-time assignment
      // above) so multiple mutator calls within the same synchronous batch
      // (e.g. one act()/event handler calling addCustomPreset then
      // toggleFavorite) each read the latest state instead of clobbering
      // each other from a stale pre-batch snapshot.
      libStateRef.current = next;
      setLibState(next);
      if (platform) void savePresetLibrary(platform, next);
    },
    [platform],
  );

  const addCustomPreset = useCallback<UsePresetLibraryResult['addCustomPreset']>(
    (input) => {
      const result = addCustomPresetPure(libStateRef.current, input);
      if (!result.error) persist(result.state);
      return result;
    },
    [persist],
  );

  const updateCustomPreset = useCallback<UsePresetLibraryResult['updateCustomPreset']>(
    (id, patch) => {
      const result = updateCustomPresetPure(libStateRef.current, id, patch);
      if (!result.error) persist(result.state);
      return result;
    },
    [persist],
  );

  const duplicateCustomPreset = useCallback<UsePresetLibraryResult['duplicateCustomPreset']>(
    (id) => {
      const result = duplicateCustomPresetPure(libStateRef.current, id);
      if (!result.error) persist(result.state);
      return result;
    },
    [persist],
  );

  const deleteCustomPreset = useCallback(
    (id: string) => {
      persist(deleteCustomPresetPure(libStateRef.current, id));
    },
    [persist],
  );

  const toggleFavorite = useCallback(
    (presetId: string) => {
      persist(toggleFavoritePure(libStateRef.current, presetId));
    },
    [persist],
  );

  const recordRecent = useCallback(
    (presetId: string) => {
      persist(recordRecentPure(libStateRef.current, presetId));
    },
    [persist],
  );

  const resetBuiltinDerivedState = useCallback(() => {
    persist(resetBuiltinDerivedStatePure(libStateRef.current));
  }, [persist]);

  const favoriteIds = useMemo(() => new Set(Object.keys(libState.favorites)), [libState.favorites]);

  return {
    customPresets: libState.presets,
    favoriteIds,
    recentIds: libState.recentIds,
    addCustomPreset,
    updateCustomPreset,
    duplicateCustomPreset,
    deleteCustomPreset,
    toggleFavorite,
    recordRecent,
    resetBuiltinDerivedState,
  };
}
