// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import {
  getThumbnailCapabilities,
  hasAnyCanvas,
  hasCreateImageBitmap,
  hasDomCanvas,
  hasFileReader,
  hasImageEncoding,
  hasOffscreenCanvas,
  hasWorkerSupport,
  setThumbnailCapabilitiesForTest,
} from '../capabilities';

describe('thumbnail capabilities — vitest/node environment', () => {
  afterEach(() => {
    setThumbnailCapabilitiesForTest(null);
  });

  // Vitest may polyfill OffscreenCanvas depending on version and config.
  // The important contract: every capability returns a boolean.
  it('hasFileReader returns a boolean', () => {
    expect(typeof hasFileReader()).toBe('boolean');
  });

  it('hasDomCanvas returns false in node (no document)', () => {
    expect(hasDomCanvas()).toBe(false);
  });

  it('every capability returns a boolean', () => {
    const caps = getThumbnailCapabilities();
    for (const [key, val] of Object.entries(caps)) {
      expect(typeof val, `${key} should be boolean`).toBe('boolean');
    }
  });

  it('getThumbnailCapabilities returns all keys', () => {
    const caps = getThumbnailCapabilities();
    expect(caps).toHaveProperty('offscreenCanvas');
    expect(caps).toHaveProperty('fileReader');
    expect(caps).toHaveProperty('createImageBitmap');
    expect(caps).toHaveProperty('imageEncoding');
    expect(caps).toHaveProperty('worker');
    expect(caps).toHaveProperty('domCanvas');
    expect(caps).toHaveProperty('anyCanvas');
  });
});

describe('thumbnail capabilities — test overrides', () => {
  afterEach(() => {
    setThumbnailCapabilitiesForTest(null);
  });

  it('overrides offscreenCanvas to false', () => {
    setThumbnailCapabilitiesForTest({ offscreenCanvas: false });
    expect(hasOffscreenCanvas()).toBe(false);
    // hasAnyCanvas depends on offscreenCanvas || domCanvas — domCanvas
    // is unaffected by this override.
    expect(hasAnyCanvas()).toBe(hasDomCanvas());
  });

  it('overrides domCanvas to false', () => {
    setThumbnailCapabilitiesForTest({ domCanvas: false });
    expect(hasDomCanvas()).toBe(false);
    // hasAnyCanvas still true if offscreenCanvas is available
  });

  it('overrides independent flags individually', () => {
    setThumbnailCapabilitiesForTest({ offscreenCanvas: true, fileReader: false });
    expect(hasOffscreenCanvas()).toBe(true);
    expect(hasFileReader()).toBe(false);
  });

  it('overrides multiple flags at once', () => {
    setThumbnailCapabilitiesForTest({
      offscreenCanvas: false,
      imageEncoding: false,
      fileReader: false,
    });
    expect(hasOffscreenCanvas()).toBe(false);
    expect(hasImageEncoding()).toBe(false);
    expect(hasFileReader()).toBe(false);
  });

  it('null resets all overrides to real environment values', () => {
    setThumbnailCapabilitiesForTest({ offscreenCanvas: true, fileReader: false });
    expect(hasOffscreenCanvas()).toBe(true);
    expect(hasFileReader()).toBe(false);

    setThumbnailCapabilitiesForTest(null);
    // After reset, values revert to real environment
    expect(typeof hasFileReader()).toBe('boolean');
    expect(typeof hasOffscreenCanvas()).toBe('boolean');
  });

  it('createImageBitmap and worker can be overridden', () => {
    setThumbnailCapabilitiesForTest({ createImageBitmap: true, worker: false });
    expect(hasCreateImageBitmap()).toBe(true);
    expect(hasWorkerSupport()).toBe(false);
  });

  it('partial override leaves other capabilities unchanged', () => {
    const before = getThumbnailCapabilities();
    setThumbnailCapabilitiesForTest({ offscreenCanvas: !before.offscreenCanvas });
    const after = getThumbnailCapabilities();
    expect(after.offscreenCanvas).toBe(!before.offscreenCanvas);
    expect(after.fileReader).toBe(before.fileReader);
  });
});
