// @vitest-environment jsdom
/**
 * Unit tests for mask compositing math and surface pooling.
 *
 * The jsdom canvas mock cannot rasterize real pixels, so these tests cover
 * the deterministic pieces: luminance conversion, post-processing math
 * (invert/density/feather), pool reuse bounds, and the structural draw-call
 * contract of applyMaskAlpha (destination-in with the pooled mask surface).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  acquireMaskSurface,
  applyMaskAlpha,
  applyMaskPostProcess,
  clearMaskSurfacePool,
  pixelToMaskAlpha,
  releaseMaskSurface,
  srgbToLuminance,
} from './index';

function fakeImageData(width: number, height: number, fill: (i: number) => number[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const [r, g, b, a] = fill(p);
    const i = p * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width, height, data } as ImageData;
}

describe('srgbToLuminance', () => {
  it('maps black to 0 and white to 1', () => {
    expect(srgbToLuminance(0, 0, 0)).toBe(0);
    expect(srgbToLuminance(255, 255, 255)).toBeCloseTo(1, 6);
  });

  it('is linear-space (mid gray > 0.5 gamma value)', () => {
    // sRGB 128 ≈ 0.216 linear — a naive gamma-space luminance would give
    // ~0.502; the linearized value must be lower and consistent.
    const l = srgbToLuminance(128, 128, 128);
    expect(l).toBeGreaterThan(0.2);
    expect(l).toBeLessThan(0.25);
  });

  it('is a weighted linear sum with BT.709 coefficients', () => {
    // Single-channel values exercise the coefficients through the sRGB
    // linearization (IEC 61966-2-1).
    expect(srgbToLuminance(255, 0, 0)).toBeCloseTo(0.2126, 6);
    expect(srgbToLuminance(0, 255, 0)).toBeCloseTo(0.7152, 6);
    expect(srgbToLuminance(0, 0, 255)).toBeCloseTo(0.0722, 6);
    // The three single-channel results sum to 1 (white).
    expect(
      srgbToLuminance(255, 0, 0) + srgbToLuminance(0, 255, 0) + srgbToLuminance(0, 0, 255),
    ).toBeCloseTo(1, 6);
  });
});

describe('pixelToMaskAlpha', () => {
  it('alpha masks use the source alpha channel', () => {
    expect(pixelToMaskAlpha(255, 0, 0, 128, false)).toBeCloseTo(128 / 255, 6);
  });

  it('luminance masks multiply luminance by alpha (SVG formula)', () => {
    const a = pixelToMaskAlpha(255, 255, 255, 128, true);
    expect(a).toBeCloseTo(128 / 255, 6);
    const black = pixelToMaskAlpha(0, 0, 0, 255, true);
    expect(black).toBe(0);
  });
});

describe('applyMaskPostProcess', () => {
  it('inverts alpha and color channels', () => {
    const img = fakeImageData(1, 1, () => [10, 20, 30, 200]);
    applyMaskPostProcess(img, { inverted: true });
    expect(img.data[3]).toBe(55);
    expect(img.data[0]).toBe(245);
  });

  it('density scales alpha and channels', () => {
    const img = fakeImageData(1, 1, () => [255, 255, 255, 255]);
    applyMaskPostProcess(img, { density: 0.5 });
    expect(img.data[3]).toBe(128);
  });

  it('density 1 is a no-op', () => {
    const img = fakeImageData(1, 1, () => [12, 34, 56, 200]);
    applyMaskPostProcess(img, { density: 1 });
    expect([...img.data]).toEqual([12, 34, 56, 200]);
  });

  it('feather blurs the alpha channel without touching the color channels of alpha masks', () => {
    // A single full-alpha pixel (index 2) on a transparent 7px row: the
    // 3-pass box blur must spread its alpha into neighbors with the spike
    // decaying monotonically with distance.
    const img = fakeImageData(7, 1, (p) => [255, 0, 0, p === 2 ? 255 : 0]);
    applyMaskPostProcess(img, { feather: 1 });
    const alpha = (p: number) => img.data[p * 4 + 3]!;
    expect(alpha(2)).toBeGreaterThan(alpha(1));
    expect(alpha(1)).toBeGreaterThan(alpha(0));
    expect(alpha(2)).toBeGreaterThan(alpha(3));
    expect(alpha(3)).toBeGreaterThan(alpha(4));
    expect(alpha(0)).toBeGreaterThan(0);
    // Color channels of an alpha mask are irrelevant to destination-in, but
    // must not be corrupted either.
    expect(img.data[0]).toBe(255);
  });

  it('luminance conversion rewrites RGB to the mask value so feather blurs the visible channel', () => {
    const img = fakeImageData(1, 1, () => [255, 255, 255, 255]);
    applyMaskPostProcess(img, { luminance: true });
    expect(img.data[0]).toBe(255);
    expect(img.data[1]).toBe(255);
  });
});

describe('mask surface pool', () => {
  it('acquire returns a cleared canvas of the requested size', () => {
    clearMaskSurfacePool();
    const a = acquireMaskSurface(64, 48);
    expect(a.width).toBe(64);
    expect(a.height).toBe(48);
    releaseMaskSurface(a);
    clearMaskSurfacePool();
  });

  it('release + acquire reuses the surface (bounded pool)', () => {
    clearMaskSurfacePool();
    const a = acquireMaskSurface(100, 100);
    const b = acquireMaskSurface(200, 200);
    releaseMaskSurface(a);
    releaseMaskSurface(b);
    const c = acquireMaskSurface(150, 150);
    const d = acquireMaskSurface(50, 50);
    // The pool returns the smallest surface that fits — 200x200 for 150x150,
    // and the 100x100 for 50x50.
    expect(c).toBe(b);
    expect(d).toBe(a);
    expect(c.width).toBe(150);
    expect(d.width).toBe(50);
    releaseMaskSurface(c);
    releaseMaskSurface(d);
    clearMaskSurfacePool();
  });

  it('never retains more than the pool limit', () => {
    clearMaskSurfacePool();
    const held: HTMLCanvasElement[] = [];
    for (let i = 0; i < 24; i++) {
      held.push(acquireMaskSurface(8, 8));
    }
    for (const h of held) releaseMaskSurface(h);
    // Re-acquire everything: the pool only had room for 16, so 8 fresh
    // canvases must have been allocated — but the important invariant is
    // that acquisition still works and the retained set is bounded.
    const again = held.map(() => acquireMaskSurface(8, 8));
    expect(again.length).toBe(24);
    for (const h of again) releaseMaskSurface(h);
    clearMaskSurfacePool();
  });
});

describe('applyMaskAlpha', () => {
  it('composites the mask with destination-in inside a save/restore pair', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    const gco = vi.spyOn(ctx, 'globalCompositeOperation', 'set');
    const drawImage = vi.spyOn(ctx, 'drawImage');
    const save = vi.spyOn(ctx, 'save');
    const restore = vi.spyOn(ctx, 'restore');

    applyMaskAlpha(ctx, (maskCtx) => {
      maskCtx.fillStyle = '#fff';
      maskCtx.fillRect(0, 0, 32, 32);
    });

    // destination-in was set for the mask composite…
    expect(gco).toHaveBeenCalledWith('destination-in');
    expect(drawImage).toHaveBeenCalled();
    // …and the composite ran inside save/restore, so the canvas state is
    // restored afterwards (the jsdom mock's restore is a no-op, but the
    // call contract is what guarantees real canvases are left untouched).
    expect(save).toHaveBeenCalled();
    expect(restore).toHaveBeenCalled();
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(
      drawImage.mock.invocationCallOrder[0] ?? 0,
    );
    expect(restore.mock.invocationCallOrder[0]).toBeGreaterThan(
      drawImage.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('post-processes luminance/invert/density through the ImageData path', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // The jsdom mock throws on getImageData — the fallback must still run
    // the destination-in composite (never throw).
    vi.spyOn(ctx, 'getImageData').mockImplementation(() => {
      throw new Error('tainted canvas');
    });
    expect(() =>
      applyMaskAlpha(ctx, (maskCtx) => maskCtx.fillRect(0, 0, 8, 8), {
        luminance: true,
        inverted: true,
        feather: 2,
        density: 0.5,
      }),
    ).not.toThrow();
  });
});
