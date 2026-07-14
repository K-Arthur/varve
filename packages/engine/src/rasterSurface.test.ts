// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRasterSurface,
  DEFAULT_RASTER_SURFACE_POLICY,
  encodeRasterSurface,
  fitRasterDimensions,
} from './rasterSurface';

describe('fitRasterDimensions', () => {
  it('preserves requested dimensions inside the allocation policy', () => {
    expect(fitRasterDimensions(800, 600)).toEqual({
      width: 800,
      height: 600,
      scaleFactor: 1,
      constrainedBy: [],
    });
  });

  it('constrains both per-axis size and total backing-store area', () => {
    const fitted = fitRasterDimensions(16_000, 16_000);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(
      DEFAULT_RASTER_SURFACE_POLICY.maxPixels,
    );
    expect(fitted.constrainedBy).toContain('area');
  });

  it('constrains a very wide export without changing its aspect ratio', () => {
    const fitted = fitRasterDimensions(40_000, 2_000);
    expect(fitted.width).toBe(DEFAULT_RASTER_SURFACE_POLICY.maxDimension);
    expect(fitted.width / fitted.height).toBeCloseTo(20, 2);
    expect(fitted.constrainedBy).toContain('dimension');
  });
});

describe('portable raster surface', () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  afterEach(() => {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
    vi.restoreAllMocks();
  });

  it('falls back to an HTML canvas when OffscreenCanvas is unavailable', async () => {
    // @ts-expect-error exercising an older webview without OffscreenCanvas
    delete globalThis.OffscreenCanvas;
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((callback) => callback(new Blob(['html'], { type: 'image/png' })));

    const surface = createRasterSurface(32, 16);
    expect(surface.backend).toBe('html');
    expect(await encodeRasterSurface(surface, 'image/png')).toBeInstanceOf(Blob);
    expect(toBlob).toHaveBeenCalledOnce();
  });

  it('falls back when OffscreenCanvas exists but cannot create a 2D context', () => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        width: number;
        height: number;
        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
        }
        getContext() {
          return null;
        }
      },
    );
    expect(createRasterSurface(20, 10).backend).toBe('html');
  });
});
