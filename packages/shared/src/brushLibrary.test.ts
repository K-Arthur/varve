import { describe, expect, it } from 'vitest';
import {
  addBrushEntry,
  type BrushLibraryEntry,
  DEFAULT_BRUSH_LIBRARY_STATE,
  dedupeBrushName,
  deleteBrushEntry,
  loadBrushLibrary,
  MAX_BRUSH_RECENTS,
  normalizeSearchText,
  recordBrushRecent,
  sanitizeBrushLibraryState,
  saveBrushLibrary,
  searchBrushes,
  toggleBrushFavorite,
  updateBrushEntry,
} from './brushLibrary';

const entry = (id: string, name = id): Omit<BrushLibraryEntry, 'createdAt' | 'updatedAt'> => ({
  id,
  name,
  category: 'custom',
  tags: [],
  preset: { id, name },
});

function memoryStore(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set('brushes:library', initial);
  return {
    map,
    getAppSetting: async (k: string) => map.get(k) ?? null,
    setAppSetting: async (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe('brush library state', () => {
  it('adds and updates entries by stable id', () => {
    let state = addBrushEntry(DEFAULT_BRUSH_LIBRARY_STATE, entry('a', 'Soft Round'));
    state = updateBrushEntry(state, 'a', { name: 'Kevin Soft Round' });
    expect(state.entries[0]!.id).toBe('a');
    expect(state.entries[0]!.name).toBe('Kevin Soft Round');
  });

  it('keeps favourites through a rename', () => {
    let state = addBrushEntry(DEFAULT_BRUSH_LIBRARY_STATE, entry('a', 'Soft Round'));
    state = toggleBrushFavorite(state, 'a');
    state = updateBrushEntry(state, 'a', { name: 'Renamed' });
    // Favourites key on id, so a rename cannot orphan them.
    expect(state.favorites.a).toBeDefined();
  });

  it('drops favourites and recents when an entry is deleted', () => {
    let state = addBrushEntry(DEFAULT_BRUSH_LIBRARY_STATE, entry('a'));
    state = toggleBrushFavorite(state, 'a');
    state = recordBrushRecent(state, 'a');
    state = deleteBrushEntry(state, 'a');
    expect(state.entries).toHaveLength(0);
    expect(state.favorites.a).toBeUndefined();
    expect(state.recentIds).not.toContain('a');
  });

  it('toggles a favourite off again', () => {
    let state = toggleBrushFavorite(DEFAULT_BRUSH_LIBRARY_STATE, 'built-in-round');
    expect(state.favorites['built-in-round']).toBeDefined();
    state = toggleBrushFavorite(state, 'built-in-round');
    expect(state.favorites['built-in-round']).toBeUndefined();
  });

  it('keeps recents most-recent-first without duplicates', () => {
    let state = recordBrushRecent(DEFAULT_BRUSH_LIBRARY_STATE, 'a');
    state = recordBrushRecent(state, 'b');
    state = recordBrushRecent(state, 'a');
    expect(state.recentIds).toEqual(['a', 'b']);
  });

  it('caps the recents list', () => {
    let state = DEFAULT_BRUSH_LIBRARY_STATE;
    for (let i = 0; i < MAX_BRUSH_RECENTS + 8; i++) state = recordBrushRecent(state, `b${i}`);
    expect(state.recentIds).toHaveLength(MAX_BRUSH_RECENTS);
  });

  it('does not overwrite an entry created earlier when re-added', () => {
    const first = addBrushEntry(DEFAULT_BRUSH_LIBRARY_STATE, entry('a', 'One'));
    const second = addBrushEntry(first, entry('a', 'Two'));
    expect(second.entries).toHaveLength(1);
    expect(second.entries[0]!.createdAt).toBe(first.entries[0]!.createdAt);
  });

  it('suffixes a duplicate name rather than shadowing it', () => {
    expect(dedupeBrushName(['Ink'], 'Ink')).toBe('Ink 2');
    expect(dedupeBrushName(['Ink', 'Ink 2'], 'Ink')).toBe('Ink 3');
    expect(dedupeBrushName(['Ink'], 'Pencil')).toBe('Pencil');
  });
});

describe('brush library persistence', () => {
  it('round-trips through a key-value store', async () => {
    const kv = memoryStore();
    const state = addBrushEntry(DEFAULT_BRUSH_LIBRARY_STATE, entry('a', 'Ink'));
    await saveBrushLibrary(kv, state);
    const loaded = await loadBrushLibrary(kv);
    expect(loaded.entries[0]!.name).toBe('Ink');
  });

  it('falls back to an empty library rather than failing to open', async () => {
    expect((await loadBrushLibrary(memoryStore('{not json'))).entries).toEqual([]);
  });

  it('discards entries that are not usable brushes', () => {
    const state = sanitizeBrushLibraryState({
      entries: [entry('a'), { id: 'b' }, { name: 'no id', preset: {} }, entry('a')],
    });
    expect(state.entries.map((e) => e.id)).toEqual(['a']);
  });

  it('coerces an unknown category to custom', () => {
    const state = sanitizeBrushLibraryState({
      entries: [{ ...entry('a'), category: 'not-a-category' }],
    });
    expect(state.entries[0]!.category).toBe('custom');
  });
});

describe('brush search', () => {
  const items = [
    { id: 'a', name: 'Soft Round', category: 'basic', tags: ['smooth'] },
    { id: 'b', name: 'Ínk Pen', category: 'ink', tags: ['liner'] },
    { id: 'c', name: 'Rough Charcoal', category: 'texture', tags: ['grain', 'dry'] },
  ];

  it('returns everything for an empty query', () => {
    expect(searchBrushes(items, '   ')).toHaveLength(3);
  });

  it('matches accent-insensitively and case-insensitively', () => {
    expect(searchBrushes(items, 'ink').map((i) => i.id)).toEqual(['b']);
    expect(searchBrushes(items, 'ÍNK').map((i) => i.id)).toEqual(['b']);
  });

  it('matches category and tags, not just name', () => {
    expect(searchBrushes(items, 'texture').map((i) => i.id)).toEqual(['c']);
    expect(searchBrushes(items, 'liner').map((i) => i.id)).toEqual(['b']);
  });

  it('narrows with each additional term', () => {
    expect(searchBrushes(items, 'charcoal dry').map((i) => i.id)).toEqual(['c']);
    expect(searchBrushes(items, 'charcoal ink')).toHaveLength(0);
  });

  it('collapses whitespace in the query', () => {
    expect(normalizeSearchText('  Ínk   Pen ')).toBe('ink pen');
    expect(searchBrushes(items, '  soft    round ').map((i) => i.id)).toEqual(['a']);
  });
});
