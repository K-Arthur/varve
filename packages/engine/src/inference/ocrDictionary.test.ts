import { beforeEach, describe, expect, it } from 'vitest';
import { clearDictionaryCache, getCachedDictionary, loadOcrDictionary } from './ocrDictionary';

beforeEach(() => {
  clearDictionaryCache();
});

describe('loadOcrDictionary', () => {
  it('parses a one-char-per-line dictionary', async () => {
    // Mock fetch with a tiny inline dictionary.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string) => new Response('0\n1\n2\na\nb\nc\n')) as typeof fetch;
    try {
      const dict = await loadOcrDictionary('https://example.com/dict.txt');
      // trailing newline produces no empty entry
      expect(dict).toEqual(['0', '1', '2', 'a', 'b', 'c']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('caches the dictionary and returns the same array', async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;
    globalThis.fetch = (async (_url: string) => {
      callCount++;
      return new Response('x\ny\n');
    }) as typeof fetch;
    try {
      const a = await loadOcrDictionary('https://example.com/cached.txt');
      const b = await loadOcrDictionary('https://example.com/cached.txt');
      expect(a).toBe(b); // same reference (cached)
      expect(callCount).toBe(1);
      expect(getCachedDictionary('https://example.com/cached.txt')).toBe(a);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws when fetch fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    try {
      await expect(loadOcrDictionary('https://example.com/fail.txt')).rejects.toThrow(
        /network down|Failed to load/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validates expected line count', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('a\nb\nc\n')) as typeof fetch;
    try {
      await expect(loadOcrDictionary('https://example.com/d.txt', 10)).rejects.toThrow(
        /expected 10/,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
