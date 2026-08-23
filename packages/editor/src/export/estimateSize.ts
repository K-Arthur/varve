/**
 * Conservative file-size estimate for export jobs shown in the batch preview.
 *
 * This is a heuristic for UI display only — not authoritative. The estimate
 * uses output pixel dimensions and format-specific compression assumptions.
 * Vector formats use a content-independent base estimate since their size
 * depends on path complexity, not pixel area.
 */

import type { ExportFormat } from '@varve/scene/export';

/**
 * Bytes-per-pixel multiplier for raster formats. Accounts for channel count
 * (RGBA = 4 bytes) and typical compression. Values are intentionally
 * conservative overestimates to avoid surprising the user.
 */
const RASTER_BPP: Partial<Record<ExportFormat, number>> = {
  png: 1.8,
  jpeg: 1.2,
  webp: 0.9,
  avif: 0.7,
  gif: 1.5,
  tiff: 3.0,
  bmp: 4.0,
};

const VECTOR_BASE_KB: Partial<Record<ExportFormat, number>> = {
  svg: 12,
  pdf: 40,
  'pdf-x1a': 60,
  'pdf-x3': 60,
  'pdf-x4': 60,
  eps: 20,
  psd: 30,
};

/**
 * Estimate encoded output bytes for a given export job.
 *
 * Raster formats: `width × height × bytesPerPixel × compressionFactor`.
 * Vector formats: fixed base estimate in KB (content-dependent variance
 * is too high for pixel-area-based estimation).
 * Code formats: minimal output, return a small baseline.
 */
export function estimateExportBytes(
  width: number,
  height: number,
  format: ExportFormat,
): number {
  const px = Math.max(1, width) * Math.max(1, height);

  const bpp = RASTER_BPP[format];
  if (bpp !== undefined) {
    return Math.round(px * bpp);
  }

  const vectorKB = VECTOR_BASE_KB[format];
  if (vectorKB !== undefined) {
    return vectorKB * 1024;
  }

  // Code, svg-component, and unknown formats: small baseline.
  return 4 * 1024;
}
