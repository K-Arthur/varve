/**
 * File-size estimation for export previews.
 *
 * These are rough heuristics for the live preview dimension/size display,
 * not exact file sizes. Real sizes depend on image content and compression.
 *
 * Research basis: typical compression ratios for common raster formats:
 *   PNG (lossless):      ~0.5 bytes per channel per pixel (varies with content)
 *   JPEG (quality Q):    ~3 * Q/100 * 0.2 bytes per pixel
 *   WebP:                ~20-30% smaller than JPEG at same quality
 *   AVIF:                ~30-40% smaller than JPEG at same quality
 */
import type { RasterFormat } from './raster';

function clampQuality(q: number | undefined): number {
  if (q === undefined) return 90;
  return Math.max(1, Math.min(100, q));
}

export function estimateFileSize(
  width: number,
  height: number,
  format: RasterFormat,
  quality?: number,
): number {
  const pixels = width * height;
  const q = clampQuality(quality);
  const qf = q / 100;

  switch (format) {
    case 'png':
      // Lossless: ~0.5 BPP * pixels (content-dependent)
      return Math.round(pixels * 0.5);
    case 'jpeg': {
      // Lossy: ~3 channels * qf * 0.2 BPP
      const bpp = 3 * qf * 0.2;
      return Math.round(pixels * Math.max(bpp, 0.01));
    }
    case 'webp': {
      // WebP is ~25% smaller than JPEG at same quality
      const jpegSize = 3 * qf * 0.2 * pixels;
      return Math.round(jpegSize * 0.75);
    }
    case 'avif': {
      // AVIF is ~35% smaller than JPEG at same quality
      const jpegSize = 3 * qf * 0.2 * pixels;
      return Math.round(jpegSize * 0.65);
    }
  }
}
