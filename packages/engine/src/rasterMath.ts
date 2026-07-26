/**
 * Pure raster size math: format types, file-size estimation, and output-dimension
 * scaling. A leaf module — no imports from raster.ts or raster-size.ts — so it can be
 * shared by both without creating a cycle (raster.ts needs the calculations here;
 * this module needs none of raster.ts's rendering machinery).
 *
 * File-size estimates are rough heuristics for the live preview dimension/size
 * display, not exact file sizes. Real sizes depend on image content and compression.
 *
 * Research basis: typical compression ratios for common raster formats:
 *   PNG (lossless):      ~0.5 bytes per channel per pixel (varies with content)
 *   JPEG (quality Q):    ~3 * Q/100 * 0.2 bytes per pixel
 *   WebP:                ~20-30% smaller than JPEG at same quality
 *   AVIF:                ~30-40% smaller than JPEG at same quality
 */

export type RasterFormat = 'png' | 'jpeg' | 'webp' | 'avif';

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

/**
 * Compute output dimensions from scene bounds and export scale.
 */
export function computeOutputDimensions(
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.round(bounds.w * scale),
    height: Math.round(bounds.h * scale),
  };
}
