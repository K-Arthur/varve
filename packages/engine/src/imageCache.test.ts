import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImageCache, ImageCache, resetImageCache } from './imageCache';
import { ImageLoadError } from './imageErrors';

class MockImage {
  crossOrigin: string | null = null;
  loading = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 100;
  naturalHeight = 100;
  width = 100;
  height = 100;
  private _src = '';

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => MockImage.dispatch(this));
  }

  /** Overridden per-test to control which loads succeed/fail. */
  static dispatch(_img: MockImage): void {
    throw new Error('MockImage.dispatch must be set by the test');
  }
}

describe('ImageCache cross-origin loading', () => {
  let originalImage: typeof Image;

  beforeEach(() => {
    originalImage = globalThis.Image;
    globalThis.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it('requests data: URLs without crossOrigin (always same-origin, no CORS dance needed)', async () => {
    const seen: (string | null)[] = [];
    MockImage.dispatch = (img) => {
      seen.push(img.crossOrigin);
      img.onload?.();
    };

    const cache = new ImageCache();
    await cache.load('data:image/png;base64,AAAA');

    expect(seen).toEqual([null]);
  });

  it('first attempts a cross-origin URL with crossOrigin=anonymous, and succeeds untainted when the server allows it', async () => {
    const seen: (string | null)[] = [];
    MockImage.dispatch = (img) => {
      seen.push(img.crossOrigin);
      img.onload?.();
    };

    const cache = new ImageCache();
    const img = await cache.load('https://cdn.example.com/logo.png');

    expect(seen).toEqual(['anonymous']);
    expect(img).toBeInstanceOf(MockImage);
  });

  it('falls back to a non-CORS request when the anonymous attempt fails, so the image still displays on screen', async () => {
    const seen: (string | null)[] = [];
    let calls = 0;
    MockImage.dispatch = (img) => {
      seen.push(img.crossOrigin);
      calls++;
      if (calls === 1) {
        img.onerror?.();
      } else {
        img.onload?.();
      }
    };

    const cache = new ImageCache();
    const img = await cache.load('https://no-cors.example.com/photo.jpg');

    expect(seen).toEqual(['anonymous', null]);
    expect(img).toBeInstanceOf(MockImage);
    expect(cache.state('https://no-cors.example.com/photo.jpg')).toBe('loaded');
  });

  it('reports an error state when both the CORS and fallback attempts fail', async () => {
    MockImage.dispatch = (img) => img.onerror?.();
    // Classification probes the dead server; make the probes fail fast so
    // the test does not wait on network timeouts.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));

    const cache = new ImageCache();
    await expect(cache.load('https://dead.example.com/missing.png')).rejects.toBeInstanceOf(
      ImageLoadError,
    );
    expect(cache.state('https://dead.example.com/missing.png')).toBe('error');
    // The failure is typed as unavailable (offline), not a generic error.
    expect(cache.failureCode('https://dead.example.com/missing.png')).toBe('unavailable');
  });
});

describe('ImageCache memory budget', () => {
  function image(width: number, height: number): HTMLImageElement {
    return {
      naturalWidth: width,
      naturalHeight: height,
      width,
      height,
    } as HTMLImageElement;
  }

  it('evicts least-recently-used decoded images to remain within the byte budget', () => {
    const cache = new ImageCache({ maxEntries: 10, maxBytes: 800 });
    cache.setLoaded('first', image(10, 10));
    cache.setLoaded('second', image(10, 10));
    cache.getImage('first');
    cache.setLoaded('third', image(10, 10));

    expect(cache.has('first')).toBe(true);
    expect(cache.has('second')).toBe(false);
    expect(cache.has('third')).toBe(true);
    expect(cache.stats).toMatchObject({ bytes: 800, evictions: 1 });
  });

  it('returns but does not retain an image larger than the entire budget', async () => {
    const originalImage = globalThis.Image;
    globalThis.Image = MockImage as unknown as typeof Image;
    MockImage.dispatch = (img) => {
      img.naturalWidth = 100;
      img.naturalHeight = 100;
      img.onload?.();
    };

    try {
      const cache = new ImageCache({ maxBytes: 1_000 });
      const loaded = await cache.load('data:image/png;base64,AAAA');
      expect(loaded).toBeInstanceOf(MockImage);
      expect(cache.has('data:image/png;base64,AAAA')).toBe(false);
      expect(cache.stats).toMatchObject({ bytes: 0, misses: 1, rejectedOversize: 1 });
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it('resets byte accounting on explicit eviction and clear', () => {
    const cache = new ImageCache({ maxBytes: 10_000 });
    cache.setLoaded('one', image(10, 10));
    cache.evict('one');
    expect(cache.stats.bytes).toBe(0);

    cache.setLoaded('two', image(10, 10));
    cache.clear();
    expect(cache.stats).toMatchObject({ entries: 0, bytes: 0 });
  });

  it('notifies subscribers before rejecting an oversized decoded image', () => {
    const cache = new ImageCache({ maxBytes: 100 });
    let observedLoaded = false;
    cache.subscribe('large', () => {
      observedLoaded = cache.isLoaded('large');
    });

    cache.setLoaded('large', image(10, 10));

    expect(observedLoaded).toBe(true);
    expect(cache.has('large')).toBe(false);
  });

  it('evicts immediately when the decoded-image byte limit is reduced', () => {
    const cache = new ImageCache({ maxEntries: 10, maxBytes: 800 });
    cache.setLoaded('first', image(10, 10));
    cache.setLoaded('second', image(10, 10));

    cache.setLimits({ maxBytes: 400 });

    expect(cache.stats).toMatchObject({ entries: 1, bytes: 400, evictions: 1 });
  });

  it('keeps explicit URL subscriptions across cache eviction and reload', () => {
    const cache = new ImageCache({ maxEntries: 1, maxBytes: 10_000 });
    let notifications = 0;
    const unsubscribe = cache.subscribe('first', () => notifications++);

    cache.setLoaded('first', image(10, 10));
    cache.setLoaded('second', image(10, 10));
    cache.setLoaded('first', image(10, 10));

    expect(notifications).toBe(2);
    unsubscribe();
  });

  it('reset clears the previous singleton before replacing it', () => {
    resetImageCache();
    const previous = getImageCache();
    previous.setLoaded('one', image(10, 10));

    resetImageCache();

    expect(previous.size).toBe(0);
    expect(previous.stats.bytes).toBe(0);
    expect(getImageCache()).not.toBe(previous);
  });
});

describe('ImageCache pending-load invalidation', () => {
  let originalImage: typeof Image;

  beforeEach(() => {
    originalImage = globalThis.Image;
    globalThis.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
  });

  it('does not repopulate the cache when a cancelled decode finishes late', async () => {
    const created: MockImage[] = [];
    MockImage.dispatch = (img) => created.push(img);

    const cache = new ImageCache();
    const pending = cache.load('data:image/png;base64,cancelled');
    await Promise.resolve();

    cache.cancel('data:image/png;base64,cancelled');
    created[0]?.onload?.();
    await pending;

    expect(cache.isLoaded('data:image/png;base64,cancelled')).toBe(false);
    expect(cache.stats.bytes).toBe(0);
  });

  it('does not let an older cancelled decode overwrite a successful retry', async () => {
    const created: MockImage[] = [];
    MockImage.dispatch = (img) => created.push(img);

    const cache = new ImageCache();
    const first = cache.load('data:image/png;base64,retry');
    await Promise.resolve();
    cache.cancel('data:image/png;base64,retry');

    const second = cache.load('data:image/png;base64,retry');
    await Promise.resolve();
    created[1]?.onload?.();
    const secondImage = await second;
    created[0]?.onload?.();
    await first;

    expect(cache.getImage('data:image/png;base64,retry')).toBe(secondImage);
    expect(cache.stats.bytes).toBe(100 * 100 * 4);
  });

  it('does not repopulate the cache when clear races a pending decode', async () => {
    const created: MockImage[] = [];
    MockImage.dispatch = (img) => created.push(img);

    const cache = new ImageCache();
    const pending = cache.load('data:image/png;base64,cleared');
    await Promise.resolve();

    cache.clear();
    created[0]?.onload?.();
    await pending;

    expect(cache.has('data:image/png;base64,cleared')).toBe(false);
    expect(cache.stats.bytes).toBe(0);
  });

  it('does not let a late pending load overwrite a synchronously published replacement', async () => {
    const created: MockImage[] = [];
    MockImage.dispatch = (img) => created.push(img);

    const cache = new ImageCache();
    const pending = cache.load('data:image/png;base64,replaced');
    await Promise.resolve();

    const replacement = {
      naturalWidth: 2,
      naturalHeight: 2,
      width: 2,
      height: 2,
    } as HTMLImageElement;
    cache.setLoaded('data:image/png;base64,replaced', replacement);
    created[0]?.onload?.();
    await pending;

    expect(cache.getImage('data:image/png;base64,replaced')).toBe(replacement);
  });
});

describe('ImageCache at-size representations', () => {
  let originalImage: typeof Image;
  let originalCreateImageBitmap: typeof createImageBitmap;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalImage = globalThis.Image;
    globalThis.Image = MockImage as unknown as typeof Image;
    originalCreateImageBitmap = globalThis.createImageBitmap;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.Image = originalImage;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.fetch = originalFetch;
  });

  function mockBitmap(close = vi.fn(), width = 2048, height = 1536): ImageBitmap {
    return { width, height, close, closed: false } as unknown as ImageBitmap;
  }

  it('releases full and at-size entries outside the active source set', () => {
    const cache = new ImageCache({ maxBytes: 10 * 1024 * 1024 });
    const active = 'data:image/png;base64,active';
    const closed = 'data:image/png;base64,closed';
    cache.setLoaded(active, mockBitmap(vi.fn(), 100, 100));
    cache.setLoaded(cache.atSizeKey(active, 512), mockBitmap(vi.fn(), 50, 50));
    cache.setLoaded(closed, mockBitmap(vi.fn(), 100, 100));

    expect(cache.retainSources([active])).toBe(1);
    expect(cache.isLoaded(active)).toBe(true);
    expect(cache.isLoadedAtSize(active, 512)).toBe(true);
    expect(cache.isLoaded(closed)).toBe(false);
  });

  // These fixtures are opaque payloads — the assertions below are about
  // bitmap ownership, not bytes. They must still be *valid* base64, because
  // the cache decodes data: URLs in memory rather than fetching them (a
  // fetch of a data: URL is a connect-src operation the demo CSP refuses).
  function mockFetchBlob(): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      blob: () => Promise.resolve(new Blob(['bytes'], { type: 'image/jpeg' })),
    }) as unknown as typeof fetch;
  }

  it('decodes the at-size representation under its own key and leaves the full entry untouched', async () => {
    const src = 'data:image/jpeg;base64,BIG';
    const bitmap = mockBitmap();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    mockFetchBlob();

    const cache = new ImageCache();
    const result = await cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });

    expect(result).toBe(bitmap);
    expect(cache.isLoadedAtSize(src, 2048)).toBe(true);
    expect(cache.getImageAtSize(src, 2048)).toBe(bitmap);
    // The full-size entry is a different key and was never decoded.
    expect(cache.has(src)).toBe(false);
    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 2048, resizeHeight: 1365, resizeQuality: 'high' }),
    );
    // Byte accounting uses the small bitmap, not the source dims.
    expect(cache.stats.bytes).toBe(2048 * 1536 * 4);
  });

  it('preserves aspect ratio and orientation-normalized dims from the source', async () => {
    const src = 'data:image/jpeg;base64,PORTRAIT';
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(mockBitmap(vi.fn(), 1365, 2048));
    mockFetchBlob();

    const cache = new ImageCache();
    await cache.loadAtSize(src, 2048, { width: 3000, height: 4500 });

    expect(globalThis.createImageBitmap).toHaveBeenCalledWith(
      expect.any(Blob),
      expect.objectContaining({ resizeWidth: 1365, resizeHeight: 2048 }),
    );
  });

  it('falls back to the full-size load when the source fits the cap', async () => {
    const src = 'data:image/png;base64,SMALL';
    MockImage.dispatch = (img) => img.onload?.();
    const cache = new ImageCache();
    const result = await cache.loadAtSize(src, 2048, { width: 800, height: 600 });

    // Small source: the full-size element IS the representation, stored
    // under the at-size key so the consumer lookup path stays uniform.
    expect(result).toBeInstanceOf(MockImage);
    expect(cache.isLoadedAtSize(src, 2048)).toBe(true);
    expect(globalThis.createImageBitmap).not.toHaveBeenCalled();
  });

  it('falls back to the full-size load for non-inline sources', async () => {
    MockImage.dispatch = (img) => img.onload?.();
    const cache = new ImageCache();
    const result = await cache.loadAtSize('https://example.com/photo.jpg', 2048);

    expect(result).toBeInstanceOf(MockImage);
    expect(cache.isLoaded('https://example.com/photo.jpg')).toBe(true);
  });

  it('falls back to the HTML image loader when createImageBitmap is unavailable', async () => {
    const src = 'data:image/png;base64,NO_BITMAP_API';
    MockImage.dispatch = (img) => img.onload?.();
    globalThis.createImageBitmap = undefined as unknown as typeof createImageBitmap;

    const cache = new ImageCache();
    const result = await cache.loadAtSize(src, 256, { width: 4000, height: 3000 });

    expect(result).toBeInstanceOf(MockImage);
    expect(cache.isLoadedAtSize(src, 256)).toBe(true);
  });

  it('deduplicates concurrent at-size loads and marks failures typed', async () => {
    const src = 'data:image/jpeg;base64,FAIL';
    let resolveBitmap: (b: ImageBitmap) => void = () => undefined;
    globalThis.createImageBitmap = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBitmap = resolve as (b: ImageBitmap) => void;
        }),
    );
    mockFetchBlob();

    const cache = new ImageCache();
    const first = cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });
    const second = cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });

    expect(cache.pendingCount).toBe(1);
    // Flush the fetch microtask so createImageBitmap has been invoked and
    // captured the resolver.
    await Promise.resolve();
    await Promise.resolve();
    resolveBitmap(mockBitmap());
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(cache.stats.hits).toBe(1);
  });

  it('closes at-size bitmaps on eviction and clear (exactly-once ownership)', async () => {
    const src = 'data:image/jpeg;base64,EVICTED0';
    const close = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(mockBitmap(close, 2048, 2048));
    mockFetchBlob();
    const cache = new ImageCache({ maxBytes: 2048 * 2048 * 4 });
    await cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });

    cache.evict(cache.atSizeKey(src, 2048));
    expect(close).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes a stale at-size bitmap when cancellation wins the race', async () => {
    const src = 'data:image/jpeg;base64,CANCELLED0';
    let resolveBitmap: (bitmap: ImageBitmap) => void = () => undefined;
    const close = vi.fn();
    globalThis.createImageBitmap = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBitmap = resolve as (bitmap: ImageBitmap) => void;
        }),
    );
    mockFetchBlob();

    const cache = new ImageCache();
    const pending = cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });
    await Promise.resolve();
    await Promise.resolve();
    cache.cancel(cache.atSizeKey(src, 2048));
    resolveBitmap(mockBitmap(close));
    await pending;

    expect(close).toHaveBeenCalledTimes(1);
    expect(cache.isLoadedAtSize(src, 2048)).toBe(false);
  });

  it('does not close an oversized bitmap returned to the immediate caller', async () => {
    const src = 'data:image/jpeg;base64,OVERSIZED0';
    const close = vi.fn();
    const bitmap = mockBitmap(close, 2048, 2048);
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    mockFetchBlob();

    const cache = new ImageCache({ maxBytes: 1_000 });
    await expect(cache.loadAtSize(src, 2048, { width: 6000, height: 4000 })).resolves.toBe(bitmap);

    expect(close).not.toHaveBeenCalled();
    expect(cache.isLoadedAtSize(src, 2048)).toBe(false);
  });

  it('closes a replaced retained bitmap exactly once', () => {
    const firstClose = vi.fn();
    const first = mockBitmap(firstClose, 10, 10);
    const second = mockBitmap(vi.fn(), 10, 10);
    const cache = new ImageCache({ maxBytes: 10_000 });

    cache.setLoaded('same-source', first);
    cache.setLoaded('same-source', second);

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(cache.getImage('same-source')).toBe(second);
  });

  it('never returns a closed at-size bitmap', async () => {
    const src = 'data:image/jpeg;base64,CLOSED';
    const bitmap = mockBitmap();
    globalThis.createImageBitmap = vi.fn().mockResolvedValue(bitmap);
    mockFetchBlob();
    const cache = new ImageCache();

    await cache.loadAtSize(src, 2048, { width: 6000, height: 4000 });
    bitmap.close();
    (bitmap as unknown as { closed: boolean }).closed = true;

    expect(cache.getImageAtSize(src, 2048)).toBeNull();
  });

  it('keeps the closest resident proxy visible while a new bucket is pending', () => {
    const src = 'data:image/jpeg;base64,PROGRESSIVE';
    const cache = new ImageCache();
    const low = mockBitmap(vi.fn(), 512, 256);
    const high = mockBitmap(vi.fn(), 4096, 2048);
    cache.setLoaded(cache.atSizeKey(src, 512), low);
    cache.setLoaded(cache.atSizeKey(src, 4096), high);

    expect(cache.getClosestImageAtSize(src, 2048)).toBe(high);
    expect(cache.getClosestImageAtSize(src, 8192)).toBe(high);
  });

  it('partitions full-size entries by color variant', () => {
    const src = 'data:image/jpeg;base64,COLOR-VARIANT';
    const srgb = { colorKey: 'srgb-source' };
    const p3 = { colorKey: 'display-p3-working' };
    const cache = new ImageCache();
    const first = mockBitmap(vi.fn(), 10, 10);
    const second = mockBitmap(vi.fn(), 10, 10);
    cache.setLoaded(src, first, srgb);
    cache.setLoaded(src, second, p3);

    expect(cache.getImage(src, srgb)).toBe(first);
    expect(cache.getImage(src, p3)).toBe(second);
    expect(cache.getImage(src)).toBeNull();
    expect(cache.isLoaded(src, srgb)).toBe(true);
    expect(cache.isLoaded(src, p3)).toBe(true);
    expect(cache.atSizeKey(src, 2048, srgb)).not.toBe(cache.atSizeKey(src, 2048, p3));
  });
});
