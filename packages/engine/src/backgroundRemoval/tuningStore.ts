/**
 * Persistence layer for category tuning profiles.
 *
 * Uses localStorage for small payload (profiles are tiny — a few hundred
 * bytes each — unlike model blobs which need IndexedDB).
 */

import type { CategoryProfile } from './categoryTuning';

const TUNING_STORE_KEY = 'varve-bg-category-tuning';
const LEGACY_TUNING_STORE_KEY = 'strata-bg-category-tuning';
const STORE_VERSION = 1;

export interface TuningStoreData {
  profiles: CategoryProfile[];
  version: number;
}

function defaultStore(): TuningStoreData {
  return { profiles: [], version: STORE_VERSION };
}

function readStore(): TuningStoreData {
  try {
    const raw =
      localStorage.getItem(TUNING_STORE_KEY) ?? localStorage.getItem(LEGACY_TUNING_STORE_KEY);
    if (!raw) return defaultStore();
    const parsed = JSON.parse(raw) as TuningStoreData;
    if (!Array.isArray(parsed.profiles)) return defaultStore();
    return parsed;
  } catch {
    return defaultStore();
  }
}

function writeStore(data: TuningStoreData): void {
  try {
    localStorage.setItem(TUNING_STORE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently degrade
  }
}

export function loadTuningProfiles(): CategoryProfile[] {
  return readStore().profiles;
}

export function saveTuningProfile(profile: CategoryProfile): void {
  const store = readStore();
  const idx = store.profiles.findIndex((p) => p.categoryId === profile.categoryId);
  if (idx >= 0) {
    store.profiles[idx] = profile;
  } else {
    store.profiles.push(profile);
  }
  writeStore(store);
}

export function deleteTuningProfile(categoryId: string): void {
  const store = readStore();
  store.profiles = store.profiles.filter((p) => p.categoryId !== categoryId);
  writeStore(store);
}

export function getTuningStats(): {
  totalProfiles: number;
  totalUses: number;
  avgSatisfaction: number;
} {
  const profiles = loadTuningProfiles();
  if (profiles.length === 0) {
    return { totalProfiles: 0, totalUses: 0, avgSatisfaction: 0 };
  }
  let totalUses = 0;
  let totalSat = 0;
  for (const p of profiles) {
    totalUses += p.useCount;
    totalSat += p.satisfactionScore;
  }
  return {
    totalProfiles: profiles.length,
    totalUses,
    avgSatisfaction: totalSat / profiles.length,
  };
}
