/**
 * User's brush library — custom presets, favourites, recents and tags.
 *
 * This is *user* state, not document state: which brushes someone has starred
 * follows them between files, so none of it is written into a `.varve`. It
 * mirrors presetStore's shape and persistence so both libraries behave the
 * same way and share one mental model.
 *
 * Presets are addressed by a stable id that is independent of the display
 * name, so renaming "Soft Round" to "Kevin Soft Round" cannot break a
 * favourite, a recent entry or a document that references it.
 */

export interface BrushKVStore {
  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;
}

export type BrushCategory =
  | 'basic'
  | 'ink'
  | 'pencil'
  | 'paint'
  | 'texture'
  | 'smudge'
  | 'custom'
  | 'imported';

export const BRUSH_CATEGORIES: readonly BrushCategory[] = [
  'basic',
  'ink',
  'pencil',
  'paint',
  'texture',
  'smudge',
  'custom',
  'imported',
] as const;

export interface BrushLibraryEntry {
  /** Stable id, matching the BrushPreset it describes. */
  id: string;
  name: string;
  category: BrushCategory;
  tags: string[];
  /** Serialized BrushPreset. Kept opaque here so shared stays scene-agnostic. */
  preset: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  /** Set when this entry is an editable copy of a built-in brush. */
  derivedFrom?: string;
}

export interface BrushLibraryState {
  schemaVersion: number;
  /** User-created and imported brushes. Built-ins never live here. */
  entries: BrushLibraryEntry[];
  /** Any brush id (built-in or custom) -> when it was favourited. */
  favorites: Record<string, number>;
  /** Any brush id, most-recent first. */
  recentIds: string[];
}

const APP_SETTING_KEY = 'brushes:library';
export const CURRENT_BRUSH_LIBRARY_SCHEMA_VERSION = 1;
export const MAX_BRUSH_RECENTS = 16;

export const DEFAULT_BRUSH_LIBRARY_STATE: BrushLibraryState = {
  schemaVersion: CURRENT_BRUSH_LIBRARY_SCHEMA_VERSION,
  entries: [],
  favorites: {},
  recentIds: [],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function sanitizeEntry(raw: unknown): BrushLibraryEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.name !== 'string' || !raw.name) return null;
  if (!isRecord(raw.preset)) return null;
  const category = BRUSH_CATEGORIES.includes(raw.category as BrushCategory)
    ? (raw.category as BrushCategory)
    : 'custom';
  return {
    id: raw.id,
    name: raw.name,
    category,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    preset: raw.preset,
    createdAt: Number.isFinite(raw.createdAt) ? (raw.createdAt as number) : Date.now(),
    updatedAt: Number.isFinite(raw.updatedAt) ? (raw.updatedAt as number) : Date.now(),
    derivedFrom: typeof raw.derivedFrom === 'string' ? raw.derivedFrom : undefined,
  };
}

export function sanitizeBrushLibraryState(raw: unknown): BrushLibraryState {
  if (!isRecord(raw)) return { ...DEFAULT_BRUSH_LIBRARY_STATE };
  const entries: BrushLibraryEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.entries)) {
    for (const candidate of raw.entries) {
      const entry = sanitizeEntry(candidate);
      if (!entry || seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  const favorites: Record<string, number> = {};
  if (isRecord(raw.favorites)) {
    for (const [id, at] of Object.entries(raw.favorites)) {
      if (typeof id === 'string' && Number.isFinite(at)) favorites[id] = at as number;
    }
  }
  const recentIds = Array.isArray(raw.recentIds)
    ? raw.recentIds.filter((id): id is string => typeof id === 'string').slice(0, MAX_BRUSH_RECENTS)
    : [];
  return {
    schemaVersion: CURRENT_BRUSH_LIBRARY_SCHEMA_VERSION,
    entries,
    favorites,
    recentIds,
  };
}

export async function loadBrushLibrary(kv: BrushKVStore): Promise<BrushLibraryState> {
  try {
    const raw = await kv.getAppSetting(APP_SETTING_KEY);
    if (!raw) return { ...DEFAULT_BRUSH_LIBRARY_STATE };
    return sanitizeBrushLibraryState(JSON.parse(raw));
  } catch {
    // A corrupt library must not stop the editor from opening.
    return { ...DEFAULT_BRUSH_LIBRARY_STATE };
  }
}

export async function saveBrushLibrary(kv: BrushKVStore, state: BrushLibraryState): Promise<void> {
  try {
    await kv.setAppSetting(APP_SETTING_KEY, JSON.stringify(state));
  } catch {
    // Best-effort: the caller's in-memory state still reflects the change.
  }
}

export function addBrushEntry(
  state: BrushLibraryState,
  entry: Omit<BrushLibraryEntry, 'createdAt' | 'updatedAt'>,
): BrushLibraryState {
  const now = Date.now();
  const existing = state.entries.findIndex((e) => e.id === entry.id);
  const full: BrushLibraryEntry = { ...entry, createdAt: now, updatedAt: now };
  if (existing >= 0) {
    const entries = [...state.entries];
    entries[existing] = { ...full, createdAt: state.entries[existing]!.createdAt };
    return { ...state, entries };
  }
  return { ...state, entries: [...state.entries, full] };
}

export function updateBrushEntry(
  state: BrushLibraryState,
  id: string,
  patch: Partial<Omit<BrushLibraryEntry, 'id' | 'createdAt'>>,
): BrushLibraryState {
  return {
    ...state,
    entries: state.entries.map((e) =>
      e.id === id ? { ...e, ...patch, id: e.id, updatedAt: Date.now() } : e,
    ),
  };
}

export function deleteBrushEntry(state: BrushLibraryState, id: string): BrushLibraryState {
  const favorites = { ...state.favorites };
  delete favorites[id];
  return {
    ...state,
    entries: state.entries.filter((e) => e.id !== id),
    favorites,
    recentIds: state.recentIds.filter((r) => r !== id),
  };
}

export function toggleBrushFavorite(state: BrushLibraryState, id: string): BrushLibraryState {
  const favorites = { ...state.favorites };
  if (favorites[id]) delete favorites[id];
  else favorites[id] = Date.now();
  return { ...state, favorites };
}

export function recordBrushRecent(state: BrushLibraryState, id: string): BrushLibraryState {
  const recentIds = [id, ...state.recentIds.filter((r) => r !== id)].slice(0, MAX_BRUSH_RECENTS);
  return { ...state, recentIds };
}

/** Auto-suffix a name so saving never silently shadows an existing brush. */
export function dedupeBrushName(existingNames: readonly string[], name: string): string {
  if (!existingNames.includes(name)) return name;
  let n = 2;
  while (existingNames.includes(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

/**
 * Normalize text for search: case-folded, accent-stripped and
 * whitespace-collapsed, so "Ínk  Pen" finds "ink pen".
 */
export function normalizeSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export interface BrushSearchable {
  id: string;
  name: string;
  category: string;
  tags?: readonly string[];
}

/**
 * Filter brushes by a free-text query across name, category and tags.
 *
 * Every whitespace-separated term must match somewhere, so "ink round" narrows
 * rather than widening the way a plain OR would.
 */
export function searchBrushes<T extends BrushSearchable>(items: readonly T[], query: string): T[] {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [...items];
  const terms = normalized.split(' ');
  return items.filter((item) => {
    const haystack = normalizeSearchText(
      `${item.name} ${item.category} ${(item.tags ?? []).join(' ')}`,
    );
    return terms.every((term) => haystack.includes(term));
  });
}
