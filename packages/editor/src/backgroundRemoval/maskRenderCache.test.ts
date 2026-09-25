import { ImageCache } from '@varve/engine';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRasterMaskRenderSources,
  maskRenderDimensions,
  maskRenderUrl,
  warmMaskRenderCache,
} from './maskRenderCache';

afterEach(() => vi.unstubAllGlobals());

describe('mask render cache sizing', () => {
  it('keeps small masks at source resolution', () => {
    expect(maskRenderDimensions(1024, 768)).toEqual({ width: 1024, height: 768 });
  });

  it('bounds a large landscape mask without changing its aspect ratio', () => {
    expect(maskRenderDimensions(8803, 5919)).toEqual({ width: 2048, height: 1377 });
  });

  it('bounds portrait and panoramic masks by their longest edge', () => {
    expect(maskRenderDimensions(1200, 4800)).toEqual({ width: 512, height: 2048 });
    expect(maskRenderDimensions(8000, 1000)).toEqual({ width: 2048, height: 256 });
  });

  it('returns a safe minimum for invalid metadata', () => {
    expect(maskRenderDimensions(0, Number.NaN)).toEqual({ width: 1, height: 1 });
  });

  it('keeps the full-resolution URL when no live render proxy is registered', () => {
    expect(maskRenderUrl('data:image/png;base64,full-resolution')).toBe(
      'data:image/png;base64,full-resolution',
    );
  });

  it('retains a warmed panoramic proxy only while its document mask is active', async () => {
    class ImmediateImage {
      onload: (() => void) | null = null;
      naturalWidth = 2048;
      naturalHeight = 410;
      private currentSrc = '';

      get src(): string {
        return this.currentSrc;
      }

      set src(value: string) {
        this.currentSrc = value;
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', ImmediateImage);

    const cache = new ImageCache();
    const fullMaskUrl = 'data:image/png;base64,panoramic-mask';
    const unrelatedUrl = 'data:image/png;base64,unrelated';
    cache.setLoaded(fullMaskUrl, { naturalWidth: 3000, naturalHeight: 600 } as HTMLImageElement);
    cache.setLoaded(unrelatedUrl, { naturalWidth: 1, naturalHeight: 1 } as HTMLImageElement);
    await warmMaskRenderCache(cache, fullMaskUrl, 3000, 600);

    const proxyUrl = maskRenderUrl(fullMaskUrl);
    expect(proxyUrl).not.toBe(fullMaskUrl);
    expect(cache.isLoaded(proxyUrl)).toBe(true);

    const activeSources = new Set<string>();
    addRasterMaskRenderSources(activeSources, [{ dataUrl: fullMaskUrl }]);
    cache.retainSources(activeSources);
    expect(cache.isLoaded(fullMaskUrl)).toBe(true);
    expect(cache.isLoaded(proxyUrl)).toBe(true);
    expect(cache.isLoaded(unrelatedUrl)).toBe(false);

    cache.retainSources([]);
    expect(cache.isLoaded(fullMaskUrl)).toBe(false);
    expect(cache.isLoaded(proxyUrl)).toBe(false);
  });
});
