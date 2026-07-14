import { describe, it, expect } from 'vitest';
import { FontCatalog, diffCatalogs } from './fontCatalog';
import type { FontCatalogEntry } from './fontCatalog';
import type { FontIdentity, ParsedFontMetadata } from './fontIdentity';
import { fontIdentityKey } from './fontIdentity';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIdentity(overrides: Partial<FontIdentity> = {}): FontIdentity {
  return {
    contentHash: 'abc12345',
    postScriptName: 'Inter-Regular',
    familyName: 'Inter',
    subfamilyName: 'Regular',
    fullName: 'Inter Regular',
    ...overrides,
  };
}

function makeMeta(overrides: Partial<ParsedFontMetadata> = {}): ParsedFontMetadata {
  const identity = overrides.identity ?? makeIdentity();
  return {
    identity,
    format: 'woff2',
    fileSize: 100_000,
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    lineGap: 0,
    glyphCount: 1500,
    isVariable: false,
    axes: [],
    namedInstances: [],
    openTypeFeatures: [],
    unicodeRanges: [],
    scripts: ['latn'],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'system',
    ...overrides,
  };
}

function makeId(overrides: Partial<FontIdentity> = {}): string {
  return fontIdentityKey(makeIdentity(overrides));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FontCatalog', () => {
  // -- Basic CRUD ----------------------------------------------------------

  describe('addEntry / getEntry / hasEntry / removeEntry / size', () => {
    it('adds an entry and retrieves it by id', () => {
      const catalog = new FontCatalog();
      const meta = makeMeta();
      const entry = catalog.addEntry(meta);

      expect(entry.id).toBe(makeId());
      expect(catalog.hasEntry(entry.id)).toBe(true);
      expect(catalog.getEntry(entry.id)).toBe(entry);
      expect(catalog.size()).toBe(1);
    });

    it('returns undefined for missing entries', () => {
      const catalog = new FontCatalog();
      expect(catalog.getEntry('nonexistent')).toBeUndefined();
      expect(catalog.hasEntry('nonexistent')).toBe(false);
    });

    it('removes an entry and returns true', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      expect(catalog.removeEntry(id)).toBe(true);
      expect(catalog.size()).toBe(0);
      expect(catalog.hasEntry(id)).toBe(false);
    });

    it('returns false when removing a nonexistent entry', () => {
      const catalog = new FontCatalog();
      expect(catalog.removeEntry('missing')).toBe(false);
    });

    it('all() returns all entries', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta());
      catalog.addEntry(
        makeMeta({ identity: makeIdentity({ postScriptName: 'Bold', fullName: 'Inter Bold' }) }),
      );
      expect(catalog.all()).toHaveLength(2);
    });
  });

  // -- Upsert behaviour ----------------------------------------------------

  describe('upsert (same identity replaces)', () => {
    it('replaces metadata but preserves runtime state on duplicate identity', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta({ fileSize: 100 }));

      // Mutate runtime state
      catalog.setActive(id, true);
      catalog.setFavorite(id, true);
      catalog.addTag(id, 'ui');

      // Upsert with same identity but different fileSize
      const updated = catalog.addEntry(makeMeta({ fileSize: 200 }));

      expect(updated.id).toBe(id);
      expect(updated.fileSize).toBe(200);
      expect(updated.isActive).toBe(true);
      expect(updated.isFavorite).toBe(true);
      expect(updated.tags).toContain('ui');
      expect(catalog.size()).toBe(1);
    });

    it('creates a new entry for a different identity', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta());
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: 'ffff0001', postScriptName: 'Other-Regular' }),
        }),
      );
      expect(catalog.size()).toBe(2);
    });
  });

  // -- families() ----------------------------------------------------------

  describe('families()', () => {
    it('returns unique sorted family names', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Zeta' }) }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Alpha',
            postScriptName: 'Alpha-Regular',
            fullName: 'Alpha Regular',
          }),
        }),
      );
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Alpha',
            postScriptName: 'Alpha-Bold',
            fullName: 'Alpha Bold',
            subfamilyName: 'Bold',
          }),
        }),
      );

      expect(catalog.families()).toEqual(['Alpha', 'Zeta']);
    });
  });

  // -- getEntriesForFamily -------------------------------------------------

  describe('getEntriesForFamily()', () => {
    it('returns all entries for a given family', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Inter' }) }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Inter',
            postScriptName: 'Inter-Bold',
            fullName: 'Inter Bold',
            subfamilyName: 'Bold',
          }),
        }),
      );
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Roboto',
            postScriptName: 'Roboto-Regular',
            fullName: 'Roboto Regular',
          }),
        }),
      );

      const interEntries = catalog.getEntriesForFamily('Inter');
      expect(interEntries).toHaveLength(2);
    });

    it('is case-insensitive', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Inter' }) }));
      expect(catalog.getEntriesForFamily('inter')).toHaveLength(1);
    });
  });

  // -- Runtime state -------------------------------------------------------

  describe('setFavorite / setRecentlyUsed / setActive', () => {
    it('sets and reads favorite flag', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.setFavorite(id, true);
      expect(catalog.getEntry(id)!.isFavorite).toBe(true);

      catalog.setFavorite(id, false);
      expect(catalog.getEntry(id)!.isFavorite).toBe(false);
    });

    it('sets recentlyUsedAt timestamp', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      const before = Date.now();
      catalog.setRecentlyUsed(id);
      const entry = catalog.getEntry(id)!;
      expect(entry.recentlyUsedAt).toBeGreaterThanOrEqual(before);
    });

    it('sets active flag', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.setActive(id, true);
      expect(catalog.getEntry(id)!.isActive).toBe(true);
    });

    it('ignores state changes for nonexistent entries', () => {
      const catalog = new FontCatalog();
      catalog.setFavorite('missing', true);
      catalog.setRecentlyUsed('missing');
      catalog.setActive('missing', true);
      expect(catalog.size()).toBe(0);
    });
  });

  // -- Tags ----------------------------------------------------------------

  describe('addTag / removeTag', () => {
    it('adds a tag and avoids duplicates', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.addTag(id, 'ui');
      catalog.addTag(id, 'ui');
      catalog.addTag(id, 'heading');
      expect(catalog.getEntry(id)!.tags).toEqual(['ui', 'heading']);
    });

    it('removes a tag', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.addTag(id, 'ui');
      catalog.addTag(id, 'body');
      catalog.removeTag(id, 'ui');
      expect(catalog.getEntry(id)!.tags).toEqual(['body']);
    });
  });

  // -- Search: full-text query ---------------------------------------------

  describe('search() full-text query', () => {
    it('matches by family name', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Inter' }) }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Roboto',
            postScriptName: 'Roboto-Regular',
            fullName: 'Roboto Regular',
          }),
        }),
      );

      const results = catalog.search({ query: 'inter' });
      expect(results).toHaveLength(1);
      expect(results[0]!.identity.familyName).toBe('Inter');
    });

    it('matches by PostScript name', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            postScriptName: 'FiraCode-Regular',
            familyName: 'Fira Code',
            fullName: 'Fira Code Regular',
          }),
        }),
      );

      const results = catalog.search({ query: 'FiraCode' });
      expect(results).toHaveLength(1);
    });

    it('matches by vendor', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ vendor: 'Google Fonts' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '00000001', postScriptName: 'Other' }),
          vendor: 'Adobe',
        }),
      );

      const results = catalog.search({ query: 'Adobe' });
      expect(results).toHaveLength(1);
      expect(results[0]!.vendor).toBe('Adobe');
    });

    it('matches by designer', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ designer: 'Rasmus Andersson' }));

      const results = catalog.search({ query: 'Rasmus' });
      expect(results).toHaveLength(1);
    });

    it('matches by description', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ description: 'A variable sans-serif font' }));

      const results = catalog.search({ query: 'variable sans' });
      expect(results).toHaveLength(1);
    });

    it('returns empty for no matches', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta());
      expect(catalog.search({ query: 'nonexistent' })).toHaveLength(0);
    });

    it('returns all entries when no filter provided', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta());
      catalog.addEntry(
        makeMeta({ identity: makeIdentity({ contentHash: '11111111', postScriptName: 'Other' }) }),
      );
      expect(catalog.search()).toHaveLength(2);
    });
  });

  // -- Search: filters -----------------------------------------------------

  describe('search() filtering', () => {
    it('filters by single source', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ source: 'system' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          source: 'bundled',
        }),
      );
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '22222222', postScriptName: 'B' }),
          source: 'system',
        }),
      );

      const results = catalog.search({ source: 'system' });
      expect(results).toHaveLength(2);
    });

    it('filters by multiple sources', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ source: 'system' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          source: 'bundled',
        }),
      );
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '22222222', postScriptName: 'B' }),
          source: 'remote',
        }),
      );

      const results = catalog.search({ source: ['system', 'bundled'] });
      expect(results).toHaveLength(2);
    });

    it('filters by category', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ category: 'sans-serif' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          category: 'serif',
        }),
      );

      expect(catalog.search({ category: 'serif' })).toHaveLength(1);
    });

    it('filters by isActive', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.addEntry(
        makeMeta({ identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }) }),
      );
      catalog.setActive(id, true);

      expect(catalog.search({ isActive: true })).toHaveLength(1);
      expect(catalog.search({ isActive: false })).toHaveLength(1);
    });

    it('filters by isVariable', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ isVariable: true }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          isVariable: false,
        }),
      );

      expect(catalog.search({ isVariable: true })).toHaveLength(1);
    });

    it('filters by hasColorGlyphs', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ hasColorGlyphs: true }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          hasColorGlyphs: false,
        }),
      );

      expect(catalog.search({ hasColorGlyphs: true })).toHaveLength(1);
    });

    it('filters by embeddingRights', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ embeddingRights: 'installable' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          embeddingRights: 'restricted',
        }),
      );

      expect(catalog.search({ embeddingRights: 'installable' })).toHaveLength(1);
      expect(catalog.search({ embeddingRights: ['restricted'] })).toHaveLength(1);
    });

    it('filters by minGlyphCount', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ glyphCount: 500 }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          glyphCount: 2000,
        }),
      );

      expect(catalog.search({ minGlyphCount: 1000 })).toHaveLength(1);
    });

    it('filters by scripts (at least one must match)', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ scripts: ['latn', 'cyrl'] }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          scripts: ['arab'],
        }),
      );

      expect(catalog.search({ scripts: ['cyrl'] })).toHaveLength(1);
      expect(catalog.search({ scripts: ['latn', 'arab'] })).toHaveLength(2);
    });

    it('combines multiple filters', () => {
      const catalog = new FontCatalog();
      const id1 = makeIdentity({ postScriptName: 'A', familyName: 'F1' });
      const id2 = makeIdentity({ contentHash: '11111111', postScriptName: 'B', familyName: 'F2' });
      catalog.addEntry(
        makeMeta({ identity: id1, source: 'system', category: 'sans-serif', isVariable: true }),
      );
      catalog.addEntry(
        makeMeta({ identity: id2, source: 'bundled', category: 'sans-serif', isVariable: true }),
      );
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            contentHash: '22222222',
            postScriptName: 'C',
            familyName: 'F3',
          }),
          source: 'system',
          category: 'serif',
          isVariable: true,
        }),
      );

      const results = catalog.search({
        source: 'system',
        category: 'sans-serif',
        isVariable: true,
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.identity.familyName).toBe('F1');
    });

    it('filters by isFavorite', () => {
      const catalog = new FontCatalog();
      const { id } = catalog.addEntry(makeMeta());
      catalog.addEntry(
        makeMeta({ identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }) }),
      );
      catalog.setFavorite(id, true);

      expect(catalog.search({ isFavorite: true })).toHaveLength(1);
      expect(catalog.search({ isFavorite: false })).toHaveLength(1);
    });
  });

  // -- Sort ----------------------------------------------------------------

  describe('search() sorting', () => {
    it('sorts by family ascending', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Zeta' }) }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Alpha',
            postScriptName: 'Alpha-Regular',
            fullName: 'Alpha Regular',
          }),
        }),
      );

      const results = catalog.search(undefined, { field: 'family', direction: 'asc' });
      expect(results.map((e) => e.identity.familyName)).toEqual(['Alpha', 'Zeta']);
    });

    it('sorts by family descending', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Alpha' }) }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Zeta',
            postScriptName: 'Zeta-Regular',
            fullName: 'Zeta Regular',
          }),
        }),
      );

      const results = catalog.search(undefined, { field: 'family', direction: 'desc' });
      expect(results.map((e) => e.identity.familyName)).toEqual(['Zeta', 'Alpha']);
    });

    it('sorts by recentlyUsed descending (most recent first)', () => {
      const catalog = new FontCatalog();
      const e1 = catalog.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Old' }) }));
      const e2 = catalog.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'New',
            postScriptName: 'New-Regular',
            fullName: 'New Regular',
          }),
        }),
      );

      // Simulate different timestamps
      catalog.setRecentlyUsed(e1.id);
      const entry1 = catalog.getEntry(e1.id)!;
      entry1.recentlyUsedAt = Date.now() - 10_000;
      catalog.setRecentlyUsed(e2.id);

      const results = catalog.search(undefined, { field: 'recentlyUsed', direction: 'desc' });
      expect(results[0]!.identity.familyName).toBe('New');
    });

    it('sorts by source ascending', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ source: 'system' }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          source: 'bundled',
        }),
      );

      const results = catalog.search(undefined, { field: 'source', direction: 'asc' });
      expect(results[0]!.source).toBe('bundled');
    });

    it('sorts by size ascending', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ fileSize: 500 }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          fileSize: 200,
        }),
      );

      const results = catalog.search(undefined, { field: 'size', direction: 'asc' });
      expect(results[0]!.fileSize).toBe(200);
    });

    it('sorts by glyphCount descending', () => {
      const catalog = new FontCatalog();
      catalog.addEntry(makeMeta({ glyphCount: 500 }));
      catalog.addEntry(
        makeMeta({
          identity: makeIdentity({ contentHash: '11111111', postScriptName: 'A' }),
          glyphCount: 3000,
        }),
      );

      const results = catalog.search(undefined, { field: 'glyphCount', direction: 'desc' });
      expect(results[0]!.glyphCount).toBe(3000);
    });
  });

  // -- merge() -------------------------------------------------------------

  describe('merge()', () => {
    it('adds entries from another catalog', () => {
      const a = new FontCatalog();
      const b = new FontCatalog();
      a.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Alpha' }) }));
      b.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Beta',
            postScriptName: 'Beta-Regular',
            fullName: 'Beta Regular',
          }),
        }),
      );

      a.merge(b);
      expect(a.size()).toBe(2);
    });

    it('preserves runtime state from both sides on conflict', () => {
      const a = new FontCatalog();
      const b = new FontCatalog();

      const entryA = a.addEntry(makeMeta());
      a.setFavorite(entryA.id, true);

      const entryB = b.addEntry(makeMeta());
      b.setActive(entryB.id, true);

      a.merge(b);
      const merged = a.getEntry(entryA.id)!;
      expect(merged.isFavorite).toBe(true);
      expect(merged.isActive).toBe(true);
    });

    it('unions tags from both catalogs', () => {
      const a = new FontCatalog();
      const b = new FontCatalog();

      const e = a.addEntry(makeMeta());
      a.addTag(e.id, 'ui');

      b.addEntry(makeMeta());
      b.addTag(e.id, 'heading');

      a.merge(b);
      expect(a.getEntry(e.id)!.tags).toEqual(expect.arrayContaining(['ui', 'heading']));
    });
  });

  // -- diffCatalogs --------------------------------------------------------

  describe('diffCatalogs()', () => {
    it('detects added entries', () => {
      const old = new FontCatalog();
      const new_ = new FontCatalog();
      new_.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'New' }) }));

      const diff = diffCatalogs(old, new_);
      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it('detects removed entries', () => {
      const old = new FontCatalog();
      const new_ = new FontCatalog();
      old.addEntry(makeMeta({ identity: makeIdentity({ familyName: 'Old' }) }));

      const diff = diffCatalogs(old, new_);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(1);
      expect(diff.changed).toHaveLength(0);
    });

    it('detects changed entries (metadata differs)', () => {
      const old = new FontCatalog();
      const new_ = new FontCatalog();
      old.addEntry(makeMeta({ fileSize: 100 }));
      new_.addEntry(makeMeta({ fileSize: 200 }));

      const diff = diffCatalogs(old, new_);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(1);
    });

    it('reports no changes for identical metadata', () => {
      const old = new FontCatalog();
      const new_ = new FontCatalog();
      old.addEntry(makeMeta());
      new_.addEntry(makeMeta());

      const diff = diffCatalogs(old, new_);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it('handles complex multi-operation diff', () => {
      const old = new FontCatalog();
      const new_ = new FontCatalog();

      // Kept
      old.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Keep',
            postScriptName: 'Keep-Reg',
            fullName: 'Keep Regular',
          }),
        }),
      );
      new_.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Keep',
            postScriptName: 'Keep-Reg',
            fullName: 'Keep Regular',
          }),
        }),
      );

      // Removed
      old.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Gone',
            postScriptName: 'Gone-Reg',
            fullName: 'Gone Regular',
          }),
        }),
      );

      // Added
      new_.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Brand',
            postScriptName: 'Brand-Reg',
            fullName: 'Brand Regular',
          }),
        }),
      );

      // Changed
      old.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Tweak',
            postScriptName: 'Tweak-Reg',
            fullName: 'Tweak Regular',
          }),
          fileSize: 100,
        }),
      );
      new_.addEntry(
        makeMeta({
          identity: makeIdentity({
            familyName: 'Tweak',
            postScriptName: 'Tweak-Reg',
            fullName: 'Tweak Regular',
          }),
          fileSize: 999,
        }),
      );

      const diff = diffCatalogs(old, new_);
      expect(diff.added).toHaveLength(1);
      expect(diff.removed).toHaveLength(1);
      expect(diff.changed).toHaveLength(1);
    });
  });
});
