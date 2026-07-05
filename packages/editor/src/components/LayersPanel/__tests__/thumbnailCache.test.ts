import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThumbnailCache, thumbnailCacheKey } from '../thumbnailCache';

describe('ThumbnailCache', () => {
  let cache: ThumbnailCache;

  beforeEach(() => {
    cache = new ThumbnailCache(3);
  });

  it('stores and retrieves values', () => {
    cache.set('key1', 'data:image/png;base64,abc');
    expect(cache.get('key1')).toBe('data:image/png;base64,abc');
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('evicts LRU entries when over capacity', () => {
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    // Cache is now at capacity [a, b, c]
    cache.set('d', 'url-d');
    // 'a' should be evicted (oldest)
    expect(cache.get('a')).toBeUndefined();
    // b, c, d should still be present
    expect(cache.get('b')).toBe('url-b');
    expect(cache.get('c')).toBe('url-c');
    expect(cache.get('d')).toBe('url-d');
  });

  it('evicts LRU correctly when old entries are re-accessed', () => {
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    // Access 'a' to make it most recently used
    cache.get('a');
    // Now order is [b, c, a]
    cache.set('d', 'url-d');
    // 'b' should be evicted (least recently used)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('url-a');
    expect(cache.get('c')).toBe('url-c');
    expect(cache.get('d')).toBe('url-d');
  });

  it('invalidate removes entries for node ID', () => {
    cache.set('node1:rect:123', 'url-1');
    cache.set('node1:ellipse:456', 'url-2');
    cache.set('node2:rect:789', 'url-3');
    cache.invalidate('node1');
    expect(cache.get('node1:rect:123')).toBeUndefined();
    expect(cache.get('node1:ellipse:456')).toBeUndefined();
    expect(cache.get('node2:rect:789')).toBe('url-3');
  });

  it('clear removes all entries', () => {
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('set re-orders LRU on repeated set', () => {
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    // Re-set 'a' — moves to most recently used
    cache.set('a', 'url-a-v2');
    // Now order is [b, c, a]. Adding 'd' should evict 'b'.
    cache.set('d', 'url-d');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('url-a-v2');
  });

  it('get updates lastUsed timestamp', () => {
    const now = Date.now();
    vi.setSystemTime(now);
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    cache.set('c', 'url-c');
    // Advance time
    vi.setSystemTime(now + 1000);
    cache.get('a');
    // Now 'a' has later timestamp than 'b' and 'c'
    cache.set('d', 'url-d');
    // 'b' should be evicted (oldest now)
    expect(cache.get('b')).toBeUndefined();
    // 'a' should still be there
    expect(cache.get('a')).toBe('url-a');
  });

  it('has returns true for existing keys', () => {
    cache.set('key1', 'data-url');
    expect(cache.has('key1')).toBe(true);
  });

  it('has returns false for missing keys', () => {
    expect(cache.has('nonexistent')).toBe(false);
  });
});

describe('thumbnailCacheKey', () => {
  it('produces same key for same node/kind/fill', () => {
    const k1 = thumbnailCacheKey({
      id: 'abc',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    const k2 = thumbnailCacheKey({
      id: 'abc',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    expect(k1).toBe(k2);
  });

  it('produces different key for different fills', () => {
    const k1 = thumbnailCacheKey({
      id: 'abc',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    const k2 = thumbnailCacheKey({
      id: 'abc',
      kind: 'shape',
      fill: { space: 'rgb', r: 0, g: 0, b: 255, a: 255 },
    });
    expect(k1).not.toBe(k2);
  });

  it('produces different key for different kinds', () => {
    const k1 = thumbnailCacheKey({
      id: 'abc',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    const k2 = thumbnailCacheKey({
      id: 'abc',
      kind: 'text',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    expect(k1).not.toBe(k2);
  });

  it('produces different key for different node IDs', () => {
    const k1 = thumbnailCacheKey({
      id: 'node1',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    const k2 = thumbnailCacheKey({
      id: 'node2',
      kind: 'shape',
      fill: { space: 'rgb', r: 255, g: 0, b: 0, a: 255 },
    });
    expect(k1).not.toBe(k2);
  });

  it('handles undefined fill', () => {
    const k1 = thumbnailCacheKey({ id: 'abc', kind: 'shape' });
    const k2 = thumbnailCacheKey({ id: 'abc', kind: 'shape', fill: undefined });
    expect(k1).toBe(k2);
  });
});
