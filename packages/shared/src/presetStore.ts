/**
 * Custom preset persistence: cross-platform (desktop/browser) via a small
 * key-value substrate, with schema versioning, corrupted-data-safe loading,
 * and pure CRUD reducers.
 *
 * Typed against a structural {getAppSetting, setAppSetting} interface rather
 * than importing @strata/platform's concrete Platform type, so @strata/shared
 * doesn't gain a new workspace dependency — @strata/editor and @strata/home
 * each pass their own `platform` instance, which satisfies this shape
 * structurally (see platform.ts's getAppSetting/setAppSetting).
 *
 * Load/save follow the same try/catch + default-merge idiom as
 * onboardingStore.ts; schema migration follows @strata/scene's
 * version.ts {from,to,migrate} shape at a much smaller scale.
 */
import { validateDimensions } from './presetAspectRatio';
import type { Preset } from './presetTypes';

export interface PresetKVStore {
  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;
}

export interface CustomPreset extends Preset {
  category: 'custom';
  createdAt: number;
  updatedAt: number;
}

export interface PresetLibraryState {
  schemaVersion: number;
  /** User-created presets only — built-in presets never live here. */
  presets: CustomPreset[];
  /** Any preset id (built-in or custom) -> the time it was favorited. */
  favorites: Record<string, number>;
  /** Any preset id, most-recently-used first, capped at MAX_RECENTS. */
  recentIds: string[];
}

const APP_SETTING_KEY = 'presets:library';
export const CURRENT_PRESET_LIBRARY_SCHEMA_VERSION = 1;
const MAX_RECENTS = 12;

export const DEFAULT_PRESET_LIBRARY_STATE: PresetLibraryState = {
  schemaVersion: CURRENT_PRESET_LIBRARY_SCHEMA_VERSION,
  presets: [],
  favorites: {},
  recentIds: [],
};

export interface PresetLibraryMigration {
  from: number;
  to: number;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

/** Schema migrations, applied in order of increasing `to`. Empty today (the
 *  schema starts at v1) — scaffolded so a future version bump has a home. */
export const PRESET_LIBRARY_MIGRATIONS: PresetLibraryMigration[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function migrateRaw(raw: Record<string, unknown>): Record<string, unknown> {
  let result = raw;
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  for (const migration of PRESET_LIBRARY_MIGRATIONS) {
    if (version < migration.to) {
      result = migration.migrate(result);
      version = migration.to;
    }
  }
  return { ...result, schemaVersion: CURRENT_PRESET_LIBRARY_SCHEMA_VERSION };
}

/**
 * Validate a candidate custom preset. Returns an error message, or null when
 * valid. Used both to reject bad input before a save and to filter corrupted
 * entries out of persisted data on load.
 */
export function validateCustomPreset(raw: unknown): string | null {
  if (!isRecord(raw)) return 'Preset must be an object.';
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return 'Preset must have a non-empty string id.';
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    return 'Preset must have a non-empty string name.';
  }
  if (raw.category !== 'custom') return 'Custom presets must have category "custom".';
  if (typeof raw.width !== 'number' || typeof raw.height !== 'number') {
    return 'Preset must have numeric width and height.';
  }
  const dimensionError = validateDimensions(raw.width, raw.height);
  if (dimensionError) return dimensionError;
  if (typeof raw.unit !== 'string') return 'Preset must have a unit.';
  if (typeof raw.createdAt !== 'number' || typeof raw.updatedAt !== 'number') {
    return 'Preset must have numeric createdAt/updatedAt timestamps.';
  }
  return null;
}

/** Coerce arbitrary persisted JSON into a well-formed state, dropping any
 *  individual corrupted preset/favorite/recent entry rather than discarding
 *  the whole library. */
function sanitizeLibraryState(raw: unknown): PresetLibraryState {
  if (!isRecord(raw)) return { ...DEFAULT_PRESET_LIBRARY_STATE };

  const presets = Array.isArray(raw.presets)
    ? (raw.presets.filter((p) => validateCustomPreset(p) === null) as CustomPreset[])
    : [];

  const favorites: Record<string, number> = isRecord(raw.favorites)
    ? Object.fromEntries(
        Object.entries(raw.favorites).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      )
    : {};

  const recentIds = Array.isArray(raw.recentIds)
    ? raw.recentIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENTS)
    : [];

  return { schemaVersion: CURRENT_PRESET_LIBRARY_SCHEMA_VERSION, presets, favorites, recentIds };
}

/** Load the custom-preset library, defaulting safely on missing/corrupted
 *  data (never throws). */
export async function loadPresetLibrary(kv: PresetKVStore): Promise<PresetLibraryState> {
  try {
    const raw = await kv.getAppSetting(APP_SETTING_KEY);
    if (!raw) return { ...DEFAULT_PRESET_LIBRARY_STATE };
    const parsed: unknown = JSON.parse(raw);
    const migrated = migrateRaw(isRecord(parsed) ? parsed : {});
    return sanitizeLibraryState(migrated);
  } catch {
    return { ...DEFAULT_PRESET_LIBRARY_STATE };
  }
}

/** Persist the custom-preset library. Best-effort — a storage/IPC failure is
 *  swallowed, mirroring onboardingStore's handling. */
export async function savePresetLibrary(
  kv: PresetKVStore,
  state: PresetLibraryState,
): Promise<void> {
  try {
    await kv.setAppSetting(APP_SETTING_KEY, JSON.stringify(state));
  } catch {
    // Best-effort — caller's in-memory state still reflects the change.
  }
}

/** Auto-suffix a name to avoid silently overwriting/colliding with an
 *  existing one, e.g. "Card" -> "Card (2)" -> "Card (3)". */
export function dedupeName(existingNames: string[], name: string): string {
  if (!existingNames.includes(name)) return name;
  let n = 2;
  while (existingNames.includes(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

function generatePresetId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface PresetMutationResult {
  state: PresetLibraryState;
  error: string | null;
}

export interface AddCustomPresetResult extends PresetMutationResult {
  preset: CustomPreset | null;
}

export function addCustomPreset(
  state: PresetLibraryState,
  input: Omit<CustomPreset, 'id' | 'category' | 'createdAt' | 'updatedAt'>,
): AddCustomPresetResult {
  const dimensionError = validateDimensions(input.width, input.height);
  if (dimensionError) return { state, preset: null, error: dimensionError };
  const now = Date.now();
  const name = dedupeName(
    state.presets.map((p) => p.name),
    input.name,
  );
  const preset: CustomPreset = {
    ...input,
    name,
    id: generatePresetId(),
    category: 'custom',
    createdAt: now,
    updatedAt: now,
  };
  return { state: { ...state, presets: [...state.presets, preset] }, preset, error: null };
}

export function updateCustomPreset(
  state: PresetLibraryState,
  id: string,
  patch: Partial<Omit<CustomPreset, 'id' | 'category' | 'createdAt'>>,
): PresetMutationResult {
  const existing = state.presets.find((p) => p.id === id);
  if (!existing) return { state, error: `No custom preset with id "${id}".` };
  const next: CustomPreset = { ...existing, ...patch, updatedAt: Date.now() };
  const dimensionError = validateDimensions(next.width, next.height);
  if (dimensionError) return { state, error: dimensionError };
  return {
    state: { ...state, presets: state.presets.map((p) => (p.id === id ? next : p)) },
    error: null,
  };
}

export function duplicateCustomPreset(
  state: PresetLibraryState,
  id: string,
): AddCustomPresetResult {
  const existing = state.presets.find((p) => p.id === id);
  if (!existing) return { state, preset: null, error: `No custom preset with id "${id}".` };
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = existing;
  return addCustomPreset(state, { ...rest, name: `${existing.name} Copy` });
}

export function deleteCustomPreset(state: PresetLibraryState, id: string): PresetLibraryState {
  const { [id]: _removed, ...favorites } = state.favorites;
  return {
    ...state,
    presets: state.presets.filter((p) => p.id !== id),
    favorites,
    recentIds: state.recentIds.filter((recentId) => recentId !== id),
  };
}

/** Toggle favorite status for any preset id (built-in or custom). */
export function toggleFavorite(state: PresetLibraryState, presetId: string): PresetLibraryState {
  if (state.favorites[presetId] != null) {
    const { [presetId]: _removed, ...favorites } = state.favorites;
    return { ...state, favorites };
  }
  return { ...state, favorites: { ...state.favorites, [presetId]: Date.now() } };
}

/** Record a preset (built-in or custom) as recently used, deduping and
 *  capping the list at MAX_RECENTS. */
export function recordRecent(state: PresetLibraryState, presetId: string): PresetLibraryState {
  const withoutId = state.recentIds.filter((id) => id !== presetId);
  return { ...state, recentIds: [presetId, ...withoutId].slice(0, MAX_RECENTS) };
}

/** Reset favorites/recents back to empty, without touching user-created
 *  custom presets. */
export function resetBuiltinDerivedState(state: PresetLibraryState): PresetLibraryState {
  return { ...state, favorites: {}, recentIds: [] };
}
