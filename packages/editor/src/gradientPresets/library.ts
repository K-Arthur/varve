/**
 * User-level gradient preset library.
 *
 * Persists imported/custom gradient presets (plus favorites and recents)
 * through the platform's cross-backend app-setting store, mirroring
 * `presetLibrary.ts` for document-size presets. Built-in presets are composed
 * in at read time and never persisted.
 *
 * Persistence is best-effort: a platform-less environment (unit tests) keeps
 * state in memory for the session. Presets are always stored by stable id and
 * normalized through `@strata/scene`'s `makeGradientPreset`, so corrupt
 * entries are dropped on load rather than surfaced.
 */
import type { Platform } from '@strata/platform';
import type { GradientPreset } from '@strata/scene';
import { gradientPresetContentHash, makeGradientPreset } from '@strata/scene';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { GRADIENT_BUILTIN_PRESETS } from './builtin';

const GRADIENT_LIBRARY_KEY = 'presets:gradient-map';
const GRADIENT_LIBRARY_SCHEMA_VERSION = 1;
const MAX_RECENTS = 12;

export interface GradientLibraryState {
  schemaVersion: number;
  presets: GradientPreset[];
  favorites: Record<string, number>;
  recentIds: string[];
}

export const DEFAULT_GRADIENT_LIBRARY_STATE: GradientLibraryState = {
  schemaVersion: GRADIENT_LIBRARY_SCHEMA_VERSION,
  presets: [],
  favorites: {},
  recentIds: [],
};

export interface AddGradientPresetResult {
  addedIds: string[];
  /** incoming id → existing id for content-identical presets */
  merged: Map<string, string>;
}

export interface UseGradientPresetLibraryResult {
  /** All presets: built-ins first, then user presets (deduped by content). */
  presets: GradientPreset[];
  userPresets: GradientPreset[];
  favoriteIds: Set<string>;
  recentIds: string[];
  addPresets: (presets: GradientPreset[]) => AddGradientPresetResult;
  updatePreset: (
    id: string,
    patch: Partial<
      Pick<GradientPreset, 'name' | 'colorStops' | 'opacityStops' | 'interpolation' | 'smoothness'>
    >,
  ) => void;
  duplicatePreset: (id: string) => string | null;
  deletePreset: (id: string) => void;
  toggleFavorite: (id: string) => void;
  recordRecent: (id: string) => void;
}

function sanitizeState(raw: unknown): GradientLibraryState {
  const state = DEFAULT_GRADIENT_LIBRARY_STATE;
  if (!raw || typeof raw !== 'object') return state;
  const obj = raw as Partial<GradientLibraryState>;
  const presets: GradientPreset[] = [];
  if (Array.isArray(obj.presets)) {
    for (const item of obj.presets) {
      if (!item || typeof item !== 'object') continue;
      if (!Array.isArray((item as { colorStops?: unknown }).colorStops)) continue;
      try {
        const normalized = makeGradientPreset(item as Parameters<typeof makeGradientPreset>[0]);
        if (normalized.colorStops.length === 0) continue;
        presets.push(normalized);
      } catch {
        // drop corrupt entries
      }
    }
  }
  const favorites: Record<string, number> = {};
  if (obj.favorites && typeof obj.favorites === 'object') {
    for (const [id, ts] of Object.entries(obj.favorites)) {
      if (typeof ts === 'number') favorites[id] = ts;
    }
  }
  const recentIds = Array.isArray(obj.recentIds)
    ? obj.recentIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENTS)
    : [];
  return { schemaVersion: GRADIENT_LIBRARY_SCHEMA_VERSION, presets, favorites, recentIds };
}

async function loadGradientLibrary(platform: Platform | undefined): Promise<GradientLibraryState> {
  if (!platform) return DEFAULT_GRADIENT_LIBRARY_STATE;
  try {
    const raw = await platform.getAppSetting(GRADIENT_LIBRARY_KEY);
    if (!raw) return DEFAULT_GRADIENT_LIBRARY_STATE;
    return sanitizeState(JSON.parse(raw));
  } catch {
    return DEFAULT_GRADIENT_LIBRARY_STATE;
  }
}

async function saveGradientLibrary(
  platform: Platform | undefined,
  state: GradientLibraryState,
): Promise<void> {
  if (!platform) return;
  try {
    await platform.setAppSetting(GRADIENT_LIBRARY_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence
  }
}

/** Compose built-ins + user presets, deduped by content hash (user wins). */
function composePresets(userPresets: GradientPreset[]): GradientPreset[] {
  const seen = new Set<string>();
  const result: GradientPreset[] = [];
  for (const preset of [...userPresets, ...GRADIENT_BUILTIN_PRESETS]) {
    const hash = gradientPresetContentHash(preset);
    if (seen.has(hash)) continue;
    seen.add(hash);
    result.push(preset);
  }
  return result;
}

export function useGradientPresetLibrary(
  platform: Platform | undefined,
): UseGradientPresetLibraryResult {
  const [state, setState] = useState<GradientLibraryState>(DEFAULT_GRADIENT_LIBRARY_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;
    void loadGradientLibrary(platform).then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [platform]);

  const persist = useCallback(
    (next: GradientLibraryState) => {
      stateRef.current = next;
      setState(next);
      void saveGradientLibrary(platform, next);
    },
    [platform],
  );

  const addPresets = useCallback<UseGradientPresetLibraryResult['addPresets']>(
    (presets) => {
      const current = stateRef.current;
      const byHash = new Map<string, GradientPreset>();
      for (const p of current.presets) byHash.set(gradientPresetContentHash(p), p);
      const addedIds: string[] = [];
      const merged = new Map<string, string>();
      const next = [...current.presets];
      for (const incoming of presets) {
        const hash = gradientPresetContentHash(incoming);
        const match = byHash.get(hash);
        if (match) {
          merged.set(match.id, incoming.id);
          continue;
        }
        byHash.set(hash, incoming);
        next.push(incoming);
        addedIds.push(incoming.id);
      }
      persist({ ...current, presets: next });
      return { addedIds, merged };
    },
    [persist],
  );

  const updatePreset = useCallback<UseGradientPresetLibraryResult['updatePreset']>(
    (id, patch) => {
      const current = stateRef.current;
      persist({
        ...current,
        presets: current.presets.map((p) =>
          p.id === id ? makeGradientPreset({ ...p, ...patch }) : p,
        ),
      });
    },
    [persist],
  );

  const duplicatePreset = useCallback<UseGradientPresetLibraryResult['duplicatePreset']>(
    (id) => {
      const current = stateRef.current;
      const source = current.presets.find((p) => p.id === id);
      if (!source) return null;
      const copy = makeGradientPreset({
        ...source,
        id:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${source.id}-copy`,
        name: `${source.name} copy`,
      });
      persist({ ...current, presets: [...current.presets, copy] });
      return copy.id;
    },
    [persist],
  );

  const deletePreset = useCallback<UseGradientPresetLibraryResult['deletePreset']>(
    (id) => {
      const current = stateRef.current;
      const presets = current.presets.filter((p) => p.id !== id);
      const favorites = { ...current.favorites };
      delete favorites[id];
      const recentIds = current.recentIds.filter((r) => r !== id);
      persist({ ...current, presets, favorites, recentIds });
    },
    [persist],
  );

  const toggleFavorite = useCallback<UseGradientPresetLibraryResult['toggleFavorite']>(
    (id) => {
      const current = stateRef.current;
      const favorites = { ...current.favorites };
      if (favorites[id]) {
        delete favorites[id];
      } else {
        favorites[id] = Date.now();
      }
      persist({ ...current, favorites });
    },
    [persist],
  );

  const recordRecent = useCallback<UseGradientPresetLibraryResult['recordRecent']>(
    (id) => {
      const current = stateRef.current;
      const recentIds = [id, ...current.recentIds.filter((r) => r !== id)].slice(0, MAX_RECENTS);
      persist({ ...current, recentIds });
    },
    [persist],
  );

  const presets = useMemo(() => composePresets(state.presets), [state.presets]);
  const favoriteIds = useMemo(() => new Set(Object.keys(state.favorites)), [state.favorites]);

  return {
    presets,
    userPresets: state.presets,
    favoriteIds,
    recentIds: state.recentIds,
    addPresets,
    updatePreset,
    duplicatePreset,
    deletePreset,
    toggleFavorite,
    recordRecent,
  };
}
