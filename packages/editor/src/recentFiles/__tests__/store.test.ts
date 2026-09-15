import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addEntry,
  clearEntries,
  computeEntryId,
  labelWithFallback,
  loadEntries,
  removeEntry,
  sanitizeLabel,
  saveEntries,
  togglePinEntry,
} from '../store';
import type { FileLocator, RecentEntry } from '../types';

function makeEntry(
  overrides: Partial<RecentEntry> & { locator: FileLocator; label: string },
): RecentEntry {
  return {
    id: overrides.id ?? computeEntryId(overrides.locator),
    lastOpenedAt: overrides.lastOpenedAt ?? Date.now(),
    label: overrides.label,
    locator: overrides.locator,
    pinned: overrides.pinned,
    thumbnailKey: overrides.thumbnailKey,
  };
}

describe('recentFiles store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('basic CRUD', () => {
    it('starts empty', () => {
      expect(loadEntries()).toEqual([]);
    });

    it('adds an entry', () => {
      const entry = {
        locator: { kind: 'path' as const, path: '/docs/test.strata' },
        label: 'test',
      };
      const result = addEntry([], entry);
      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe('test');
      expect(result[0]!.id).toBeTruthy();
      expect(result[0]!.lastOpenedAt).toBeGreaterThan(0);
    });

    it('removes an entry by id', () => {
      const result = addEntry([], {
        locator: { kind: 'path', path: '/docs/a.strata' },
        label: 'A',
      });
      const id = result[0]!.id;
      const afterRemove = removeEntry(result, id);
      expect(afterRemove).toHaveLength(0);
    });

    it('clears all entries', () => {
      let entries: RecentEntry[] = [];
      entries = addEntry(entries, {
        locator: { kind: 'path', path: '/docs/a.strata' },
        label: 'A',
      });
      entries = addEntry(entries, {
        locator: { kind: 'path', path: '/docs/b.strata' },
        label: 'B',
      });
      expect(clearEntries()).toEqual([]);
      expect(loadEntries()).toEqual([]);
    });

    it('toggles pin', () => {
      let entries: RecentEntry[] = [];
      entries = addEntry(entries, {
        locator: { kind: 'path', path: '/docs/a.strata' },
        label: 'A',
      });
      const id = entries[0]!.id;
      expect(entries[0]!.pinned).toBeUndefined();
      entries = togglePinEntry(entries, id);
      expect(entries[0]!.pinned).toBe(true);
      entries = togglePinEntry(entries, id);
      expect(entries[0]!.pinned).toBe(false);
    });

    it('deduplicates by id on add', () => {
      let entries: RecentEntry[] = [];
      entries = addEntry(entries, {
        locator: { kind: 'path', path: '/docs/a.strata' },
        label: 'A',
      });
      const id = entries[0]!.id;
      entries = addEntry(entries, {
        id,
        locator: { kind: 'path', path: '/docs/a.strata' },
        label: 'A v2',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.label).toBe('A v2');
    });

    it('sorts by lastOpenedAt descending', async () => {
      const old = makeEntry({
        locator: { kind: 'path', path: '/docs/old.strata' },
        label: 'Old',
        lastOpenedAt: 100,
      });
      const recent = makeEntry({
        locator: { kind: 'path', path: '/docs/recent.strata' },
        label: 'Recent',
        lastOpenedAt: 200,
      });
      const saved = saveEntries([old, recent]);
      expect(saved[0]!.label).toBe('Recent');
      expect(saved[1]!.label).toBe('Old');
    });
  });

  describe('localStorage error handling', () => {
    it('returns empty on corrupt JSON', () => {
      localStorage.setItem('recentFiles.v1', '{broken');
      expect(loadEntries()).toEqual([]);
    });

    it('returns empty on non-object root', () => {
      localStorage.setItem('recentFiles.v1', '"string"');
      expect(loadEntries()).toEqual([]);
    });

    it('returns empty on missing entries array', () => {
      localStorage.setItem('recentFiles.v1', JSON.stringify({ version: 1 }));
      expect(loadEntries()).toEqual([]);
    });

    it('resets on newer schema version', () => {
      localStorage.setItem('recentFiles.v1', JSON.stringify({ version: 2, entries: [] }));
      expect(loadEntries()).toEqual([]);
    });

    it('filters out malformed entries', () => {
      localStorage.setItem(
        'recentFiles.v1',
        JSON.stringify({
          version: 1,
          entries: [
            { id: 'valid', label: 'OK', locator: { kind: 'path', path: '/ok' }, lastOpenedAt: 1 },
            { id: 'no-label', locator: { kind: 'path', path: '/bad' }, lastOpenedAt: 2 },
            { id: 'no-locator', label: 'Bad', lastOpenedAt: 3 },
            null,
            'string',
          ],
        }),
      );
      const entries = loadEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.id).toBe('valid');
    });
  });

  describe('quota enforcement', () => {
    it('caps at MAX_ENTRIES (15) and evicts oldest unpinned', () => {
      const entries: RecentEntry[] = [];
      const pinned: RecentEntry = makeEntry({
        id: 'pinned',
        label: 'Pinned',
        locator: { kind: 'path', path: '/pinned' },
        lastOpenedAt: 1,
        pinned: true,
      });
      entries.push(pinned);
      for (let i = 0; i < 20; i++) {
        entries.push(
          makeEntry({
            locator: { kind: 'path', path: `/docs/${i}.strata` },
            label: `File ${i}`,
            lastOpenedAt: 1000 + i,
          }),
        );
      }
      const saved = saveEntries(entries);
      expect(saved.length).toBeLessThanOrEqual(15);
      expect(saved.find((e) => e.id === 'pinned')).toBeDefined();
    });

    it('keeps pinned entries even when many exist', () => {
      const entries: RecentEntry[] = [];
      for (let i = 0; i < 3; i++) {
        entries.push(
          makeEntry({
            locator: { kind: 'path', path: `/pinned/${i}.strata` },
            label: `Pinned ${i}`,
            lastOpenedAt: 100 + i,
            pinned: true,
          }),
        );
      }
      for (let i = 0; i < 20; i++) {
        entries.push(
          makeEntry({
            locator: { kind: 'path', path: `/docs/${i}.strata` },
            label: `File ${i}`,
            lastOpenedAt: 1000 + i,
          }),
        );
      }
      const saved = saveEntries(entries);
      const pinnedCount = saved.filter((e) => e.pinned).length;
      expect(pinnedCount).toBe(3);
      expect(saved.length).toBe(15);
    });
  });

  describe('label sanitization', () => {
    it('removes bidi control characters', () => {
      const malicious = '\u202Eevil.exe\u202C';
      expect(sanitizeLabel(malicious)).toBe('evil.exe');
    });

    it('middle-truncates long labels', () => {
      const long = 'a'.repeat(100);
      const truncated = labelWithFallback(long, 10);
      expect(truncated.length).toBeLessThan(long.length);
      expect(truncated).toContain('\u2026');
    });

    it('passes through short labels', () => {
      expect(labelWithFallback('hello.strata')).toBe('hello.strata');
    });
  });

  describe('id generation', () => {
    it('produces stable ids for the same path', () => {
      const a = computeEntryId({ kind: 'path', path: '/docs/test.strata' });
      const b = computeEntryId({ kind: 'path', path: '/docs/test.strata' });
      expect(a).toBe(b);
    });

    it('normalizes paths for dedup', () => {
      const withSlash = computeEntryId({ kind: 'path', path: '/docs/test.strata/' });
      const without = computeEntryId({ kind: 'path', path: '/docs/test.strata' });
      expect(withSlash).toBe(without);
    });

    it('distinguishes path from remote kinds', () => {
      const path = computeEntryId({ kind: 'path', path: '/docs/test.strata' });
      const remote = computeEntryId({ kind: 'remote', url: '/docs/test.strata' });
      expect(path).not.toBe(remote);
    });
  });

  describe('in-memory fallback with throwing localStorage', () => {
    beforeEach(() => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('localStorage unavailable');
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('loads gracefully when localStorage throws', () => {
      expect(loadEntries()).toEqual([]);
    });

    it('saves to in-memory when localStorage throws', () => {
      const result = addEntry([], {
        locator: { kind: 'path', path: '/test.strata' },
        label: 'Test',
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.label).toBe('Test');
    });

    it('persists across reads within session', () => {
      addEntry([], { locator: { kind: 'path', path: '/test.strata' }, label: 'Test' });
      const entries = loadEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.label).toBe('Test');
    });
  });
});
