import { describe, expect, it } from 'vitest';
import {
  compareBy,
  contentHash,
  defaultViewState,
  detectFileKind,
  emptyFilter,
  formatBytes,
  formatRelativeTime,
  isImportableKind,
  mergeViewState,
  stripExtension,
  uuid,
} from './pure';

describe('detectFileKind', () => {
  it('maps known extensions', () => {
    expect(detectFileKind('logo.strata')).toBe('strata');
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
