import { describe, expect, it } from 'vitest';
import { makeFileEntry } from './memory';
import {
  compareBy,
  contentHash,
  DOCUMENT_EXT,
  DOCUMENT_EXTS,
  defaultViewState,
  detectFileKind,
  emptyFilter,
  evaluateSmartCollection,
  extractTrigrams,
  formatBytes,
  formatRelativeTime,
  fuzzyScore,
  fuzzySearch,
  isImportableKind,
  LEGACY_DOCUMENT_EXT,
  mergeViewState,
  stripExtension,
  uuid,
  withDocumentExt,
} from './pure';
import type { Collection, FileEntry } from './types';

describe('detectFileKind', () => {
  it('maps known extensions', () => {
    expect(detectFileKind('logo.strata')).toBe('strata');
    // .varve documents map to the same persisted kind for compatibility.
    expect(detectFileKind('logo.varve')).toBe('strata');
    expect(detectFileKind('UI.fig')).toBe('figma');
    expect(detectFileKind('drawing.AI')).toBe('illustrator');
    expect(detectFileKind('photo.png')).toBe('image');
    expect(detectFileKind('photo.JPEG')).toBe('image');
  });
  it('returns unknown for unknown or extensionless names', () => {
    expect(detectFileKind('readme')).toBe('unknown');
    expect(detectFileKind('archive.zip')).toBe('unknown');
  });
});

describe('document extensions', () => {
  it('prefers .varve and keeps .strata openable', () => {
    expect(DOCUMENT_EXT).toBe('varve');
    expect(LEGACY_DOCUMENT_EXT).toBe('strata');
    expect(DOCUMENT_EXTS).toEqual(['varve', 'strata']);
  });
});

describe('withDocumentExt', () => {
  it('appends the canonical extension', () => {
    expect(withDocumentExt('Brand Deck')).toBe('Brand Deck.varve');
    expect(withDocumentExt('Untitled 1')).toBe('Untitled 1.varve');
  });
  it('leaves existing document extensions untouched', () => {
    expect(withDocumentExt('Old.strata')).toBe('Old.strata');
    expect(withDocumentExt('New.VARVE')).toBe('New.VARVE');
  });
});

describe('stripExtension', () => {
  it('removes the last extension', () => {
    expect(stripExtension('logo.strata')).toBe('logo');
    expect(stripExtension('a.b.c')).toBe('a.b');
  });
  it('leaves dotfiles and extensionless names intact', () => {
    expect(stripExtension('.gitignore')).toBe('.gitignore');
    expect(stripExtension('README')).toBe('README');
  });
});

describe('contentHash', () => {
  it('is deterministic for the same input', () => {
    expect(contentHash('{"a":1}')).toBe(contentHash('{"a":1}'));
  });
  it('differs across inputs', () => {
    expect(contentHash('{"a":1}')).not.toBe(contentHash('{"a":2}'));
  });
  it('returns an 8-char hex string', () => {
    expect(contentHash('x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('defaultViewState + mergeViewState', () => {
  it('defaults to Recent, grid, opened-desc, empty filter', () => {
    const v = defaultViewState();
    expect(v.section).toBe('recent');
    expect(v.view).toBe('grid');
    expect(v.sort).toEqual({ key: 'opened', direction: 'desc' });
    expect(v.filter.query).toBe('');
    expect(v.sidebarCollapsed).toBe(false);
  });
  it('merges a partial over defaults without losing nested fields', () => {
    const merged = mergeViewState({ view: 'list', sort: { key: 'name', direction: 'desc' } });
    expect(merged.view).toBe('list');
    expect(merged.sort).toEqual({ key: 'name', direction: 'desc' });
    expect(merged.section).toBe('recent');
    expect(merged.filter.query).toBe('');
  });
  it('survives undefined input', () => {
    expect(mergeViewState(undefined).section).toBe('recent');
  });
});

describe('compareBy', () => {
  const base = { updatedAt: 0, createdAt: 0, name: '', openedAt: 0, size: 0 };
  const a = { ...base, name: 'apple', updatedAt: 100, openedAt: 50, size: 10 };
  const b = { ...base, name: 'Banana', updatedAt: 50, openedAt: 100, size: 50 };

  it('sorts name asc case-insensitively', () => {
    const cmp = compareBy('name', 'asc');
    expect([a, b].sort(cmp)).toEqual([a, b]);
  });
  it('sorts updated desc (newest first)', () => {
    const cmp = compareBy('updated', 'desc');
    expect([a, b].sort(cmp)).toEqual([a, b]);
  });
  it('sorts opened asc', () => {
    const cmp = compareBy('opened', 'asc');
    expect([a, b].sort(cmp)).toEqual([a, b]);
  });
  it('sorts size desc', () => {
    const cmp = compareBy('size', 'desc');
    expect([a, b].sort(cmp)).toEqual([b, a]);
  });
});

describe('formatRelativeTime', () => {
  const now = 1_000_000_000_000;
  it('just now for <1min', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now');
  });
  it('minutes', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
  });
  it('hours', () => {
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 hr ago');
  });
  it('yesterday for 1-2 days', () => {
    expect(formatRelativeTime(now - 36 * 3_600_000, now)).toBe('yesterday');
  });
  it('days', () => {
    expect(formatRelativeTime(now - 3 * 24 * 3_600_000, now)).toBe('3 days ago');
  });
});

describe('formatBytes', () => {
  it('bytes / KB / MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1_500_000)).toBe('1.4 MB');
  });
});

describe('emptyFilter + isImportableKind', () => {
  it('emptyFilter returns the no-op filter', () => {
    const f = emptyFilter();
    expect(f.query).toBe('');
    expect(f.kinds).toEqual([]);
    expect(f.projectId).toBe('all');
  });
  it('flags foreign formats as importable', () => {
    expect(isImportableKind('figma')).toBe(true);
    expect(isImportableKind('illustrator')).toBe(true);
    expect(isImportableKind('image')).toBe(true);
    expect(isImportableKind('strata')).toBe(false);
    expect(isImportableKind('unknown')).toBe(false);
  });
});

describe('uuid', () => {
  it('produces unique-ish ids', () => {
    const set = new Set(Array.from({ length: 50 }, () => uuid()));
    expect(set.size).toBe(50);
  });
});

describe('extractTrigrams', () => {
  it('extracts padded trigrams from a string', () => {
    const trigrams = extractTrigrams('cat');
    expect(trigrams.length).toBe(4);
    expect(trigrams).toContain('  c');
    expect(trigrams).toContain(' ca');
    expect(trigrams).toContain('cat');
    expect(trigrams).toContain('at ');
  });

  it('returns empty array for empty string', () => {
    expect(extractTrigrams('')).toEqual([]);
  });
});

describe('fuzzyScore', () => {
  it('returns 1 for exact substring match', () => {
    expect(fuzzyScore('cat', 'category')).toBe(1);
  });

  it('returns 0 for empty query or candidate', () => {
    expect(fuzzyScore('', 'hello')).toBe(0);
    expect(fuzzyScore('hello', '')).toBe(0);
  });

  it('scores typos partially', () => {
    const score = fuzzyScore('ctr', 'cat');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 for completely unrelated strings', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(0);
  });

  it('gives prefix bonus', () => {
    const prefixScore = fuzzyScore('cat', 'category');
    const nonPrefixScore = fuzzyScore('cat', 'cart');
    expect(prefixScore).toBeGreaterThan(nonPrefixScore);
  });
});

describe('fuzzySearch', () => {
  const items = ['Apple', 'Banana', 'Apricot', 'Cherry'];

  it('returns all items when query is empty', () => {
    expect(fuzzySearch('', items, (s) => s)).toEqual(items);
  });

  it('filters and sorts by relevance', () => {
    const results = fuzzySearch('ap', items, (s) => s);
    expect(results).toContain('Apple');
    expect(results).toContain('Apricot');
    expect(results[0]).toBe('Apple');
  });

  it('tolerates typos', () => {
    const results = fuzzySearch('aple', items, (s) => s, 0.2);
    expect(results).toContain('Apple');
  });

  it('returns empty for no matches above threshold', () => {
    expect(fuzzySearch('zzz', items, (s) => s)).toEqual([]);
  });
});

describe('evaluateSmartCollection', () => {
  const files: FileEntry[] = [
    makeFileEntry({
      id: '1',
      name: 'Logo Design',
      kind: 'strata',
      projectId: 'proj1',
      updatedAt: 1000,
    }),
    makeFileEntry({
      id: '2',
      name: 'Hero Image',
      kind: 'image',
      projectId: 'proj2',
      updatedAt: 2000,
    }),
    makeFileEntry({
      id: '3',
      name: 'Old File',
      kind: 'strata',
      projectId: 'proj1',
      updatedAt: 500,
      trashedAt: 100,
    }),
  ];

  it('returns empty for manual collection', () => {
    const collection: Collection = {
      id: 'c1',
      name: 'Manual',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'manual' },
    };
    expect(evaluateSmartCollection(collection, files)).toEqual([]);
  });

  it('filters by query', () => {
    const collection: Collection = {
      id: 'c2',
      name: 'Logo',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'smart', query: 'logo' },
    };
    const result = evaluateSmartCollection(collection, files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Logo Design');
  });

  it('filters by kind', () => {
    const collection: Collection = {
      id: 'c3',
      name: 'Images',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'smart', kinds: ['image'] },
    };
    const result = evaluateSmartCollection(collection, files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Hero Image');
  });

  it('filters by projectId', () => {
    const collection: Collection = {
      id: 'c4',
      name: 'Proj1 Files',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'smart', projectIds: ['proj1'] },
    };
    const result = evaluateSmartCollection(collection, files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Logo Design');
  });

  it('filters by date range', () => {
    const collection: Collection = {
      id: 'c5',
      name: 'Recent',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'smart', dateFrom: 1500 },
    };
    const result = evaluateSmartCollection(collection, files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Hero Image');
  });

  it('excludes trashed files', () => {
    const collection: Collection = {
      id: 'c6',
      name: 'All Varve',
      createdAt: 0,
      updatedAt: 0,
      ordering: '',
      filter: { type: 'smart', kinds: ['strata'] },
    };
    const result = evaluateSmartCollection(collection, files);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Logo Design');
  });
});
