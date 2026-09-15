import { describe, expect, it } from 'vitest';
import { computeUpscalePreview, upscalePreviewRegion } from './imageEnhancement';

/** A source with sharp 1px detail — the thing a lossy round-trip destroys. */
function checkerboard(w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const v = (x + y) % 2 === 0 ? 255 : 0;
      const o = (y * w + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  return img;
}

describe('computeUpscalePreview', () => {
  it('magnifies a source region instead of downsampling first', () => {
    const src = checkerboard(1000, 563);
    const out = computeUpscalePreview(src, {
      method: 'lanczos3',
      scale: 2,
      preview: true,
      previewMaxDimension: 512,
    });
    const region = upscalePreviewRegion(src, { scale: 2, previewMaxDimension: 512 });

    // The preview is exactly the chosen region at the chosen scale...
    expect(out.width).toBe(region.width * 2);
    expect(out.height).toBe(region.height * 2);
    // ...and bounded, so cost does not track the source size.
    expect(out.width).toBeLessThanOrEqual(512);
  });

  it('keeps preview cost bounded as the scale factor grows', () => {
    const src = checkerboard(1000, 563);
    for (const scale of [1.5, 2, 3, 4]) {
      const out = computeUpscalePreview(src, {
        method: 'lanczos3',
        scale,
        preview: true,
        previewMaxDimension: 512,
      });
      expect(out.width).toBeLessThanOrEqual(520);
      expect(out.height).toBeLessThanOrEqual(520);
    }
    // Lanczos3 over four scales on a 1000×563 source is heavy compute; the
    // default 5s test timeout is flaky under parallel load (seen 2026-08-10:
    // 5010ms). This is a correctness test, not a timing assertion.
  }, 30_000);

  it('preserves detail rather than round-tripping through a smaller image', () => {
    // A downsample-then-upscale preview blurs 1px checks into flat grey. Real
    // magnification keeps the extremes, so contrast must survive.
    const src = checkerboard(1000, 563);
    const out = computeUpscalePreview(src, {
      method: 'nearest',
      scale: 2,
      preview: true,
      previewMaxDimension: 512,
    });
    let min = 255;
    let max = 0;
    for (let i = 0; i < out.width * out.height; i += 1) {
      const v = out.data[i * 4] as number;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(max - min).toBeGreaterThan(200);
  });

  it('returns the centre of the source as the previewed region', () => {
    const region = upscalePreviewRegion({ width: 1000, height: 600 }, { scale: 2 });
    expect(region.x).toBe(Math.floor((1000 - region.width) / 2));
    expect(region.y).toBe(Math.floor((600 - region.height) / 2));
  });
});
