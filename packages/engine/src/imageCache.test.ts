import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImageCache, ImageCache, resetImageCache } from './imageCache';

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

    const cache = new ImageCache();
    await expect(cache.load('https://dead.example.com/missing.png')).rejects.toThrow(
      'Failed to load image',
    );
    expect(cache.state('https://dead.example.com/missing.png')).toBe('error');
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
});
