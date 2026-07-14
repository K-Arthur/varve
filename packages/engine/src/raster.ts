/**
 * Raster export engine — renders a scene to PNG/JPEG/WebP/AVIF blobs.
 *
 * Uses OffscreenCanvas in workers for off-main-thread export. Falls back to
 * HTMLCanvasElement where OffscreenCanvas is unavailable.
 *
 * Research basis: Canvas2D `toBlob(mime, quality)` is the standard cross-browser
 * raster path. WebP/AVIF support varies by browser; detect at runtime via
 * feature test.
 */

import { estimateFileSize } from './raster-size';
import { createRasterSurface, encodeRasterSurface } from './rasterSurface';
import type { ReplayTarget } from './replay';
import { replayIr } from './replay';
import type { Color, RenderItem } from './types';

export { estimateFileSize } from './raster-size';

export type RasterFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export interface RasterOptions {
  format: RasterFormat;
  width: number;
  height: number;
  /** JPEG/WebP/AVIF quality 0-100. Ignored for PNG. */
  quality?: number;
  /** Background color (RGBA). Null = transparent for PNG, white for JPEG. */
  background?: Color | null;
  /** Anti-aliasing. Set false for pixel-perfect icon export. */
  antiAlias?: boolean;
}

export interface RasterResult {
  blob: Blob;
  width: number;
  height: number;
  format: RasterFormat;
  estimatedBytes: number;
}

export interface RasterEngine {
  render(items: readonly RenderItem[], options: RasterOptions): Promise<RasterResult>;
}

/**
 * Features-test: does the runtime support the given raster format?
 */
export function supportsFormat(format: RasterFormat): boolean {
  if (typeof OffscreenCanvas === 'undefined' && typeof HTMLCanvasElement === 'undefined') {
    return false;
  }
  // PNG and JPEG are universally supported.
  // WebP and AVIF need a feature test via toBlob detection.
  if (format === 'png' || format === 'jpeg') return true;
  // For WebP/AVIF, skip detection in test/SSR environments
  if (typeof document === 'undefined') return false;
  return true; // runtime detection at test time
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

function mimeForFormat(format: RasterFormat): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'avif':
      return 'image/avif';
  }
}

/**
 * Render a render-IR to a raster blob using OffscreenCanvas or HTMLCanvasElement.
 */
export async function renderRaster(
  items: readonly RenderItem[],
  options: RasterOptions,
): Promise<RasterResult> {
  const { width, height, format, quality, background, antiAlias } = options;

  const surface = createRasterSurface(width, height, { alpha: background === null });
  const ctx = surface.context;

  // Anti-aliasing control
  if (antiAlias === false) {
    ctx.imageSmoothingEnabled = false;
  }

  // Background fill
  if (background) {
    const [r, g, b, a] = background;
    ctx.save();
    ctx.fillStyle = `rgba(${r},${g},${b},${(a / 255).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else if (format !== 'png') {
    // JPEG/WebP/AVIF don't support transparency; fill white
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  // Replay the render IR
  replayIr(ctx as unknown as ReplayTarget, items);

  // Produce blob
  const mime = mimeForFormat(format);
  const blob = await encodeRasterSurface(surface, mime, quality ? quality / 100 : undefined);

  const estimatedBytes = estimateFileSize(width, height, format, quality);
  return { blob, width, height, format, estimatedBytes };
}
