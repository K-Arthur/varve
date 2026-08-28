/**
 * `fetch()` on a data: URL is a *connect* operation to the CSP. A policy that
 * allows `img-src data:` — which the /try demo has — still refuses it under
 * `connect-src 'self' blob:`, so every embedded image large enough to need an
 * at-size representation silently failed in the built demo while working in
 * dev. The cache decodes data URLs in memory instead; this pins that it never
 * reaches for the network to read bytes it already holds.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageCache } from './imageCache';

const PNG_64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l5fNwAAAAABJRU5ErkJggg==';
const DATA_URL = `data:image/png;base64,${PNG_64}`;

afterEach(() => vi.unstubAllGlobals());

describe('ImageCache at-size decode of embedded assets', () => {
  it('does not call fetch for a data: URL', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('CSP: connect-src blocked data:')));
    vi.stubGlobal('fetch', fetchSpy);

    const seen: Blob[] = [];
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn((blob: Blob) => {
        seen.push(blob);
        return Promise.resolve({ width: 1, height: 1, close() {} } as unknown as ImageBitmap);
      }),
    );

    const cache = new ImageCache();
    await cache.loadAtSize(DATA_URL, 32, { width: 200, height: 200 });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe('image/png');
    // 1x1 PNG is 70 bytes decoded; the base64 string is longer, so a
    // mistakenly un-decoded payload would not match.
    expect(seen[0]!.size).toBe(atob(PNG_64).length);
  });
});
