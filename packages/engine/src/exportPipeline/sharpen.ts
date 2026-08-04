/**
 * Output sharpening stage for canonical export (Strata export pipeline,
 * Phase 4). Implements an explicit unsharp-mask stage — never an accidental
 * side-effect of the resize kernel.
 *
 * Semantics:
 *  - Applies AFTER the final resize (sharpen radius is expressed in output
 *    pixels), so there is exactly one resize pass and one sharpen pass.
 *  - Works in straight-alpha space; the blur (`gaussianBlurSeparable`) is
 *    premultiplied internally, and `protectAlpha` masks the correction by the
 *    source alpha so transparent-edge RGB garbage is never amplified and
 *    silhouettes are not damaged.
 *  - `luminanceOnly` computes a single luma delta and applies it to every
 *    channel, preserving hue; otherwise each channel is sharpened separately.
 *  - `threshold` suppresses corrections on pixels whose luma delta is small,
 *    so smooth gradients and noise are left alone.
 *  - Optional linear-light working space for physically correct edge response.
 */

import type { SharpenMode } from '@varve/shared';
import { gaussianBlurSeparable } from '../blur';

export interface SharpenImageOptions {
  mode?: SharpenMode;
  /** 0..1 unsharp-mask amount. */
  amount?: number;
  /** Radius in output pixels. */
  radius?: number;
  /** 0..1 threshold; pixels with smaller luma delta are untouched. */
  threshold?: number;
  /** Sharpen luminance only, protecting hue. */
  luminanceOnly?: boolean;
  /** Mask the correction by alpha so transparent RGB garbage is not amplified. */
  protectAlpha?: boolean;
  workingSpace?: 'srgb' | 'linear-srgb';
}

export interface SharpenResult {
  imageData: ImageData;
  applied: boolean;
}

const LUMINANCE: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, v));
}

function lumaOf(r: number, g: number, b: number): number {
  return LUMINANCE[0] * r + LUMINANCE[1] * g + LUMINANCE[2] * b;
}

/**
 * Apply output sharpening. Returns the input untouched (copied) when the mode
 * is `none` or the amount is effectively zero, so callers can skip encoding
 * work in the common path.
 */
export function sharpenImageData(
  source: ImageData,
  options: SharpenImageOptions = {},
): SharpenResult {
  const mode = options.mode ?? 'none';
  const amount = options.amount ?? 0.5;
  const radius = options.radius ?? 1;
  const threshold = options.threshold ?? 0.02;
  const luminanceOnly = options.luminanceOnly ?? true;
  const protectAlpha = options.protectAlpha ?? true;
  const workingSpace = options.workingSpace ?? 'srgb';

  if (mode === 'none' || amount <= 0 || radius <= 0) {
    return {
      imageData: new ImageData(new Uint8ClampedArray(source.data), source.width, source.height),
      applied: false,
    };
  }

  const blurred = gaussianBlurSeparable(source, radius);
  const w = source.width;
  const h = source.height;
  const src = source.data;
  const blr = blurred.data;
  const out = new Uint8ClampedArray(src.length);

  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] as number;
    let r = (src[i] as number) / 255;
    let g = (src[i + 1] as number) / 255;
    let b = (src[i + 2] as number) / 255;
    const br = (blr[i] as number) / 255;
    const bg = (blr[i + 1] as number) / 255;
    const bb = (blr[i + 2] as number) / 255;

    if (a === 0) {
      // Fully transparent pixels: never emit their hidden RGB into output.
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    if (workingSpace === 'linear-srgb') {
      r = srgbToLinear(r);
      g = srgbToLinear(g);
      b = srgbToLinear(b);
    }

    let dr: number;
    let dg: number;
    let db: number;
    if (luminanceOnly) {
      const blurredLuma = lumaOf(br, bg, bb);
      const luma = lumaOf(r, g, b);
      const delta = luma - blurredLuma;
      dr = delta;
      dg = delta;
      db = delta;
    } else {
      dr = r - br;
      dg = g - bg;
      db = b - bb;
    }

    const magnitude = Math.abs(lumaOf(dr, dg, db));
    let factor = magnitude > threshold ? amount : 0;
    if (protectAlpha && a > 0) factor *= a / 255;

    let nr = r + factor * dr;
    let ng = g + factor * dg;
    let nb = b + factor * db;

    if (workingSpace === 'linear-srgb') {
      nr = linearToSrgb(nr);
      ng = linearToSrgb(ng);
      nb = linearToSrgb(nb);
    }

    out[i] = Math.round(clamp01(nr) * 255);
    out[i + 1] = Math.round(clamp01(ng) * 255);
    out[i + 2] = Math.round(clamp01(nb) * 255);
    out[i + 3] = a;
  }

  return {
    imageData: new ImageData(out, w, h),
    applied: true,
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
