import { describe, expect, it } from 'vitest';
import { EmbeddingCache } from './embeddingCache';

describe('EmbeddingCache', () => {
  it('evicts least-recently-used entries at the entry bound', () => {
    const cache = new EmbeddingCache<number>({ maxEntries: 2, estimateBytes: () => 4 });
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.size).toBe(2);
  });

  it('evicts by memory estimate and reports accurate accounting', () => {
    const cache = new EmbeddingCache<number>({
      maxEntries: 5,
      maxBytes: 10,
      estimateBytes: (v) => v,
    });
    cache.set('a', 6);
    cache.set('b', 5);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(5);
    expect(cache.byteSize).toBe(5);
  });

  it('replacing a key does not double count its bytes', () => {
    const cache = new EmbeddingCache<number>({ maxEntries: 2, estimateBytes: (v) => v });
    cache.set('a', 4);
    cache.set('a', 7);
    expect(cache.size).toBe(1);
    expect(cache.byteSize).toBe(7);
  });
});
