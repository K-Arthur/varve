/**
 * Canonical pixel buffer descriptor — the contract for what a block of
 * raster pixels means.
 *
 * Every boundary that produces or consumes raster pixels (decode, cache,
 * compositor, effects, export, print, thumbnails) can describe its buffers
 * with `PixelBufferDescriptor` instead of assuming "Uint8ClampedArray ==
 * sRGB 8-bit". The descriptor names the format (channel type), the colour
 * encoding (primaries/transfer/provenance — see @varve/shared
 * rasterColorEncoding), and the alpha semantics (straight vs premultiplied).
 *
 * Storage itself is provided by the module that owns the pixels (an
 * `ImageData`, a Float32Array, an OffscreenCanvas); this module defines the
 * descriptor, memory accounting, and safe conversions between the formats
 * the pipeline actually uses.
 */

import type { RasterAlphaMode, RasterColorEncoding } from '@varve/shared';

/** Channel layout + precision of a pixel buffer. */
export type PixelBufferFormat = 'rgba8' | 'rgba16' | 'rgba16f' | 'rgba32f';

/** Explicit description of a raster pixel buffer. */
export interface PixelBufferDescriptor {
  width: number;
  height: number;
  format: PixelBufferFormat;
  /** What the colour channels mean. Never omitted. */
  colorEncoding: RasterColorEncoding;
  alphaMode: RasterAlphaMode;
}

/** Bytes per pixel per format (RGBA = 4 channels). */
export const BYTES_PER_PIXEL: Record<PixelBufferFormat, number> = {
  rgba8: 4,
  rgba16: 8,
  rgba16f: 8,
  rgba32f: 16,
};

/** Byte size of an entire buffer of the given format. */
export function pixelBufferBytes(w: number, h: number, format: PixelBufferFormat): number {
  return w * h * BYTES_PER_PIXEL[format];
}

/** Human-readable format label for diagnostics. */
export function pixelFormatLabel(format: PixelBufferFormat): string {
  switch (format) {
    case 'rgba8':
      return '8-bit RGBA';
    case 'rgba16':
      return '16-bit RGBA';
    case 'rgba16f':
      return 'half-float RGBA';
    case 'rgba32f':
      return 'float32 RGBA';
  }
}

/**
 * Convert an 8-bit `ImageData`-style buffer to float32 RGBA (0-1 range),
 * preserving alpha exactly and colour values un-clamped (sources are 0-255
 * so nothing can exceed; out-of-gamut only appears after conversion).
 */
export function rgba8ToRgba32f(source: Uint8ClampedArray | Uint8Array, target: Float32Array): void {
  const n = source.length;
  for (let i = 0; i < n; i += 1) {
    target[i] = source[i]! / 255;
  }
}

/** Convert a float32 RGBA buffer (0-1) to 8-bit, clamping per channel. */
export function rgba32fToRgba8(source: Float32Array, target: Uint8ClampedArray): void {
  const n = source.length;
  for (let i = 0; i < n; i += 1) {
    const v = source[i]!;
    target[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
  }
}

/** 16-bit unsigned RGBA (0-65535) <-> float32 (0-1) conversion. */
export function rgba16ToRgba32f(source: Uint16Array, target: Float32Array): void {
  const n = source.length;
  for (let i = 0; i < n; i += 1) {
    target[i] = source[i]! / 65535;
  }
}

/** float32 (0-1) → 16-bit unsigned RGBA, clamping. */
export function rgba32fToRgba16(source: Float32Array, target: Uint16Array): void {
  const n = source.length;
  for (let i = 0; i < n; i += 1) {
    const v = source[i]!;
    target[i] = v <= 0 ? 0 : v >= 1 ? 65535 : Math.round(v * 65535);
  }
}

/** Alpha as-is straight vs premultiplied un-premultiply (in place, 0-1). */
export function unpremultiplyRgba32f(pixels: Float32Array): void {
  const n = pixels.length;
  for (let i = 0; i < n; i += 4) {
    const a = pixels[i + 3]!;
    if (a <= 0) {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      continue;
    }
    if (a >= 1) continue;
    pixels[i] = pixels[i]! / a;
    pixels[i + 1] = pixels[i + 1]! / a;
    pixels[i + 2] = pixels[i + 2]! / a;
  }
}

/** Alpha premultiply (in place, 0-1). */
export function premultiplyRgba32f(pixels: Float32Array): void {
  const n = pixels.length;
  for (let i = 0; i < n; i += 4) {
    const a = pixels[i + 3]!;
    pixels[i] = pixels[i]! * a;
    pixels[i + 1] = pixels[i + 1]! * a;
    pixels[i + 2] = pixels[i + 2]! * a;
  }
}

/** Memory-budget guard: true when a buffer of this size is within budget. */
export function isWithinPixelBudget(
  w: number,
  h: number,
  format: PixelBufferFormat,
  budgetBytes: number,
): boolean {
  return pixelBufferBytes(w, h, format) <= budgetBytes;
}
