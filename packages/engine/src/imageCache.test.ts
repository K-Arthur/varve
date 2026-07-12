import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageCache } from './imageCache';

class MockImage {
  crossOrigin: string | null = null;
  loading = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
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
