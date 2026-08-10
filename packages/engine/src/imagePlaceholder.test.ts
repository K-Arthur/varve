import { getImageCache, resetImageCache } from '@varve/engine';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FAILED_PLACEHOLDER_FILL,
  imagePlaceholderFill,
  LOADING_PLACEHOLDER_FILL,
} from './imagePlaceholder';
import { registerImageResourceHandle, resetImageResourceRegistry } from './imageResourceRegistry';

afterEach(() => {
  resetImageCache();
  resetImageResourceRegistry();
});

describe('imagePlaceholderFill', () => {
  it('returns the loading placeholder for unknown and loading sources', () => {
    expect(imagePlaceholderFill('data:image/png;base64,AAA')).toBe(LOADING_PLACEHOLDER_FILL);
    expect(imagePlaceholderFill('https://x.example.com/a.png')).toBe(LOADING_PLACEHOLDER_FILL);
  });

  it('returns the failed placeholder for sources in the error state', () => {
    const cache = getImageCache();
    (cache as unknown as { cache: Map<string, unknown> }).cache.set('data:image/png;base64,BAD', {
      state: 'error',
      image: null,
      error: new Error('boom'),
    });
    expect(imagePlaceholderFill('data:image/png;base64,BAD')).toBe(FAILED_PLACEHOLDER_FILL);
  });

  it('returns the loading placeholder for loaded sources only when absent (no entry case)', () => {
    // A loaded source never reaches the placeholder; the helper is only
    // consulted when replay resolved no image.
    const cache = getImageCache();
    cache.setLoaded('data:image/png;base64,OK', {
      src: 'data:image/png;base64,OK',
      naturalWidth: 1,
      naturalHeight: 1,
    } as unknown as HTMLImageElement);
    // The cache entry exists but replay could still miss it in edge cases;
    // a loaded entry must not be reported as failed.
    expect(imagePlaceholderFill('data:image/png;base64,OK')).toBe(LOADING_PLACEHOLDER_FILL);
  });

  it('resolves resource handles before consulting the cache', () => {
    registerImageResourceHandle('asset-abcdef0123456789', 'data:image/png;base64,AAA');
    expect(imagePlaceholderFill('asset-abcdef0123456789')).toBe(LOADING_PLACEHOLDER_FILL);
  });
});
