import { describe, expect, it } from 'vitest';
import type { SpotColorDef, SpotLibrary } from './colorManagement';
import type { Document } from './document';
import {
  addSpotToLibrary,
  allSpotDefs,
  createSpotLibrary,
  deleteSpotLibrary,
  duplicateSpotLibrary,
  findSpotDef,
  findSpotLibrary,
  importSpotLibrary,
  removeSpotFromLibrary,
  renameSpotLibrary,
  resolveSpotRef,
  searchSpots,
  spotDefToRef,
  spotTintPreview,
  stabilizeSpotRef,
  updateSpotDef,
  validateSpotDef,
} from './spotLibraries';

function makeDoc(): Document {
  return {
    id: 'd1',
    name: 't',
    formatVersion: '2.14',
    rootChildren: [],
    nodes: {},
    components: {},
    nextId: 1,
  };
}

function def(id: string, name: string, library = 'lib-a'): SpotColorDef {
  return {
    id,
    name,
    library,
    processFallback: { c: 0, m: 255, y: 255, k: 0 },
    provenance: 'user',
  };
}

function docWithLibrary(): { doc: Document; library: SpotLibrary } {
  const { doc, library } = createSpotLibrary(makeDoc(), 'Test Lib');
  const withSpot = addSpotToLibrary(doc, library.id, def('s1', 'Ink One'));
  return { doc: withSpot.doc, library };
}

describe('createSpotLibrary', () => {
  it('creates a project library with a stable id', () => {
    const { doc, library } = createSpotLibrary(makeDoc(), 'Pantone C', 'project');
    expect(doc.spotLibraries).toHaveLength(1);
    expect(library.kind).toBe('project');
    expect(library.spots).toEqual([]);
    expect(findSpotLibrary(doc, library.id)?.name).toBe('Pantone C');
  });
});

describe('addSpotToLibrary', () => {
  it('adds a spot and updates by id', () => {
    const { doc, library } = docWithLibrary();
    expect(allSpotDefs(doc)).toHaveLength(1);
    const updated = addSpotToLibrary(doc, library.id, def('s1', 'Ink One Renamed'));
    expect(updated.notice).toContain('updated');
    expect(allSpotDefs(updated.doc)[0]?.name).toBe('Ink One Renamed');
  });

  it('keeps same-name spots with distinct ids apart (no name-based merging)', () => {
    const { doc, library } = docWithLibrary();
    const second = addSpotToLibrary(doc, library.id, { ...def('s2', 'Ink One'), id: 's2' });
    expect(second.notice).toContain('keeping both inks with distinct ids');
    expect(allSpotDefs(second.doc)).toHaveLength(2);
  });
});

describe('resolveSpotRef', () => {
  it('resolves by stable id first', () => {
    const { doc } = docWithLibrary();
    const resolved = resolveSpotRef(doc, {
      space: 'spot',
      spotId: 's1',
      name: 'Completely Different Name',
      tint: 100,
      a: 255,
    });
    expect(resolved?.name).toBe('Ink One');
  });

  it('falls back to name for legacy refs', () => {
    const { doc } = docWithLibrary();
    const resolved = resolveSpotRef(doc, {
      space: 'spot',
      name: 'Ink One',
      tint: 50,
      a: 255,
    });
    expect(resolved?.id).toBe('s1');
  });

  it('returns undefined for unknown inks (never silently converts)', () => {
    const { doc } = docWithLibrary();
    expect(
      resolveSpotRef(doc, { space: 'spot', name: 'No Such Ink', tint: 100, a: 255 }),
    ).toBeUndefined();
  });
});

describe('stabilizeSpotRef', () => {
  it('embeds an unknown ink as a project definition (artwork stays visible)', () => {
    const doc = makeDoc();
    const result = stabilizeSpotRef(doc, {
      space: 'spot',
      name: 'Foreign Ink 300',
      tint: 80,
      a: 255,
      processFallback: { c: 10, m: 20, y: 30, k: 40 },
    });
    expect(result.ref.spotId).toBeTruthy();
    const embedded = findSpotDef(result.doc, result.ref.spotId!);
    expect(embedded?.name).toBe('Foreign Ink 300');
    expect(embedded?.provenance).toBe('migration');
  });

  it('is a no-op for already-stable refs', () => {
    const { doc } = docWithLibrary();
    const ref = spotDefToRef(def('s1', 'Ink One'), 100);
    const result = stabilizeSpotRef(doc, ref);
    expect(result.ref.spotId).toBe('s1');
    expect(result.doc).toBe(doc);
  });
});

describe('spotDefToRef and tint preview', () => {
  it('carries stable ids and clamps tint', () => {
    const ref = spotDefToRef(def('s1', 'Ink One'), 150);
    expect(ref.spotId).toBe('s1');
    expect(ref.library).toBe('lib-a');
    expect(ref.tint).toBe(100);
  });

  it('previews tint as linear ink coverage over paper', () => {
    const d = def('s1', 'Red');
    const full = spotTintPreview(d, 100);
    expect(full.r).toBe(255);
    expect(full.g).toBe(0);
    expect(full.b).toBe(0);
    const none = spotTintPreview(d, 0);
    expect(none).toEqual({ r: 255, g: 255, b: 255 });
    const half = spotTintPreview(d, 50);
    expect(half.g).toBeGreaterThan(0);
    expect(half.g).toBeLessThan(255);
  });
});

describe('library lifecycle', () => {
  it('renames, duplicates, and deletes libraries without touching spot ids', () => {
    const { doc, library } = docWithLibrary();
    const renamed = renameSpotLibrary(doc, library.id, 'Renamed');
    expect(renamed.found).toBe(true);
    expect(findSpotLibrary(renamed.doc, library.id)?.name).toBe('Renamed');

    const dup = duplicateSpotLibrary(renamed.doc, library.id);
    expect(dup.library).toBeTruthy();
    expect(dup.library!.id).not.toBe(library.id);
    expect(dup.library!.spots).toHaveLength(1);
    expect(dup.library!.spots[0]!.id).toBe('s1');

    const removed = deleteSpotLibrary(dup.doc, library.id);
    expect(removed.removed).toBe(true);
    expect(allSpotDefs(removed.doc)).toHaveLength(1);
  });

  it('removes a single spot', () => {
    const { doc, library } = docWithLibrary();
    const out = removeSpotFromLibrary(doc, library.id, 's1');
    expect(out.removed).toBe(true);
    expect(allSpotDefs(out.doc)).toHaveLength(0);
  });

  it('updates a spot definition in place', () => {
    const { doc, library } = docWithLibrary();
    const out = updateSpotDef(doc, library.id, 's1', { name: 'Ink One Pro' });
    expect(out.found).toBe(true);
    expect(findSpotDef(out.doc, 's1')?.name).toBe('Ink One Pro');
  });
});

describe('importSpotLibrary', () => {
  it('merges same-id libraries deterministically (destination wins)', () => {
    const { doc, library } = docWithLibrary();
    const incoming: SpotLibrary = {
      id: library.id,
      name: 'Test Lib',
      kind: 'imported',
      spots: [def('s1', 'Ink One'), def('s9', 'Ink Nine')],
    };
    const out = importSpotLibrary(doc, incoming);
    expect(out.warnings.some((w) => w.includes('merging'))).toBe(true);
    expect(allSpotDefs(out.doc)).toHaveLength(2);
    expect(findSpotDef(out.doc, 's1')?.name).toBe('Ink One');
    expect(findSpotDef(out.doc, 's9')).toBeTruthy();
  });

  it('avoids name collisions with fresh ids', () => {
    const { doc } = docWithLibrary();
    const incoming: SpotLibrary = {
      id: 'other-lib',
      name: 'Test Lib',
      kind: 'imported',
      spots: [],
    };
    const out = importSpotLibrary(doc, incoming);
    expect(out.warnings.some((w) => w.includes('already in use'))).toBe(true);
    const libs = out.doc.spotLibraries ?? [];
    expect(libs).toHaveLength(2);
    expect(libs[1]!.id).not.toBe(incoming.id);
  });
});

describe('searchSpots', () => {
  it('matches name, code, and aliases', () => {
    const { doc, library } = docWithLibrary();
    const withAlias = addSpotToLibrary(doc, library.id, {
      ...def('s2', 'Ink Two'),
      code: 'X-42',
      aliases: ['crimson'],
    });
    const results = searchSpots(withAlias.doc, 'crimson');
    expect(results.map((r) => r.spot.name)).toContain('Ink Two');
    const byCode = searchSpots(withAlias.doc, 'X-42');
    expect(byCode).toHaveLength(1);
  });
});

describe('validateSpotDef', () => {
  it('flags missing id/name/fallback', () => {
    expect(validateSpotDef({} as SpotColorDef)).toEqual(
      expect.arrayContaining(['spot id is required', 'spot name is required']),
    );
    expect(
      validateSpotDef({
        id: 's1',
        name: 'ok',
        library: '',
        processFallback: { c: 999, m: 0, y: 0, k: 0 },
      }),
    ).toContain('spot fallback channel c must be in [0, 255]');
  });
});
