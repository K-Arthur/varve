import { describe, it, expect, vi } from 'vitest';
import { FontCache, FontMetadataCache, FontBinaryCache } from './fontCache';
import type { ParsedFontMetadata, FontIdentity } from './fontIdentity';

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
    scripts: [],
    embeddingRights: 'installable',
    hasColorGlyphs: false,
    category: 'sans-serif',
    source: 'bundled',
    ...overrides,
  };
}

describe('FontCache', () => {
  it('get/set/has/delete basic lifecycle', () => {
    const cache = new FontCache<string>();
    cache.set('a', 'hello', 5);
    expect(cache.get('a')).toBe('hello');
    expect(cache.has('a')).toBe(true);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    expect(cache.get('a')).toBeUndefined();
  });

  it('returns undefined for missing keys', () => {
    const cache = new FontCache<number>();
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.has('missing')).toBe(false);
  });

  it('size and totalBytes track entries', () => {
    const cache = new FontCache<string>();
    cache.set('a', '1', 100);
    cache.set('b', '2', 200);
    cache.set('c', '3', 300);
    expect(cache.size()).toBe(3);
    expect(cache.totalBytes()).toBe(600);
  });

  it('clear removes all entries', () => {
    const cache = new FontCache<string>();
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.totalBytes()).toBe(0);
  });

  it('entries returns all live entries', () => {
    const cache = new FontCache<number>();
    cache.set('x', 42, 10);
    cache.set('y', 99, 20);
    const e = cache.entries();
    expect(e).toHaveLength(2);
    expect(e.find((e) => e.key === 'x')?.data).toBe(42);
    expect(e.find((e) => e.key === 'y')?.data).toBe(99);
  });
});

describe('FontCache LRU eviction', () => {
  it('evicts oldest entries when maxEntries exceeded', () => {
    const cache = new FontCache<string>({ maxEntries: 3 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4');
    expect(cache.size()).toBeLessThanOrEqual(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('LRU access preserves recently used entry', () => {
    vi.useFakeTimers();
    const cache = new FontCache<string>({ maxEntries: 3 });

    vi.advanceTimersByTime(1);
    cache.set('a', '1');
    vi.advanceTimersByTime(1);
    cache.set('b', '2');
    vi.advanceTimersByTime(1);
    cache.set('c', '3');

    // Touch 'a' to make it recent
    vi.advanceTimersByTime(1);
    cache.get('a');

    vi.advanceTimersByTime(1);
    cache.set('d', '4'); // should evict 'b' (oldest untouched)

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('d')).toBe(true);
    vi.useRealTimers();
  });

  it('evict returns the count of evicted entries', () => {
    const cache = new FontCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    // set auto-evicts, so only 2 remain; explicit evict is a no-op
    expect(cache.size()).toBeLessThanOrEqual(2);
    // Manually add past limit to test evict directly
    const cache2 = new FontCache<string>({ maxEntries: 100 });
    cache2.set('a', '1');
    cache2.set('b', '2');
    cache2.set('c', '3');
    const evicted = cache2.evict();
    expect(evicted).toBe(0);
    expect(cache2.size()).toBe(3);
  });
});

describe('FontCache TTL expiry', () => {
  it('returns undefined for expired entries', () => {
    vi.useFakeTimers();
    const cache = new FontCache<number>({ ttlMs: 100 });
    cache.set('a', 42);
    vi.advanceTimersByTime(150);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.has('a')).toBe(false);
    vi.useRealTimers();
  });

  it('does not expire entries within TTL', () => {
    vi.useFakeTimers();
    const cache = new FontCache<number>({ ttlMs: 500 });
    cache.set('a', 42);
    vi.advanceTimersByTime(100);
    expect(cache.get('a')).toBe(42);
    vi.useRealTimers();
  });
});

describe('FontCache maxBytes eviction', () => {
  it('evicts LRU entries when maxBytes exceeded', () => {
    const cache = new FontCache<string>({ maxBytes: 100 });
    cache.set('a', '1', 40);
    cache.set('b', '2', 40);
    cache.set('c', '3', 40);
    // set auto-evicts, total should be within budget
    expect(cache.totalBytes()).toBeLessThanOrEqual(100);
    expect(cache.size()).toBeLessThanOrEqual(3);
  });
});

describe('FontMetadataCache', () => {
  it('getByFamily returns metadata by family name', () => {
    const cache = new FontMetadataCache();
    cache.set('hash-abc', makeMeta(), 1000);
    const result = cache.getByFamily('Inter');
    expect(result).toBeDefined();
    expect(result!.identity.familyName).toBe('Inter');
  });

  it('getByHash returns metadata by content hash', () => {
    const cache = new FontMetadataCache();
    const meta = makeMeta({ identity: makeIdentity({ contentHash: 'deadbeef' }) });
    cache.set('deadbeef', meta, 1000);
    const result = cache.getByHash('deadbeef');
    expect(result).toBeDefined();
    expect(result!.identity.contentHash).toBe('deadbeef');
  });

  it('returns undefined for unknown family', () => {
    const cache = new FontMetadataCache();
    expect(cache.getByFamily('Nonexistent')).toBeUndefined();
  });

  it('returns undefined for unknown hash', () => {
    const cache = new FontMetadataCache();
    expect(cache.getByHash('ffffff')).toBeUndefined();
  });

  it('indexes update on delete', () => {
    const cache = new FontMetadataCache();
    cache.set('hash-1', makeMeta(), 1000);
    expect(cache.getByFamily('Inter')).toBeDefined();
    cache.delete('hash-1');
    expect(cache.getByFamily('Inter')).toBeUndefined();
  });

  it('indexes update on clear', () => {
    const cache = new FontMetadataCache();
    cache.set('h1', makeMeta(), 1000);
    cache.set('h2', makeMeta({ identity: makeIdentity({ familyName: 'Roboto' }) }), 1000);
    cache.clear();
    expect(cache.getByFamily('Inter')).toBeUndefined();
    expect(cache.getByFamily('Roboto')).toBeUndefined();
  });
});

describe('FontBinaryCache', () => {
  it('storeFontData and getFontData round-trip', () => {
    const cache = new FontBinaryCache();
    const buf = new ArrayBuffer(1024);
    cache.storeFontData('font-1', buf);
    const result = cache.getFontData('font-1');
    expect(result).toBe(buf);
    expect(result!.byteLength).toBe(1024);
  });

  it('tracks byte size from ArrayBuffer', () => {
    const cache = new FontBinaryCache();
    const buf = new ArrayBuffer(2048);
    cache.storeFontData('font-1', buf);
    expect(cache.totalBytes()).toBe(2048);
  });

  it('returns undefined for missing font', () => {
    const cache = new FontBinaryCache();
    expect(cache.getFontData('nonexistent')).toBeUndefined();
  });

  it('evicts under 50MB default budget', () => {
    const cache = new FontBinaryCache({ maxBytes: 200 });
    cache.storeFontData('f1', new ArrayBuffer(100));
    cache.storeFontData('f2', new ArrayBuffer(100));
    cache.storeFontData('f3', new ArrayBuffer(100));
    expect(cache.totalBytes()).toBeLessThanOrEqual(200);
  });
});
