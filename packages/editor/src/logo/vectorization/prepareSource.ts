/**
 * Non-destructive source preparation for vectorization.
 *
 * All operations are pure functions over ImageData: they allocate a new
 * buffer, never mutate the input, and never touch the placed image node in
 * the document. The prepared pixels exist only in the panel preview session
 * and are released when the preview is replaced or discarded.
 */

import type { SourcePrepSettings } from './settings';

/** Maximum preview dimension (long edge). Full-resolution tracing happens only on Apply. */
export const MAX_PREVIEW_DIM = 1024;

export function grayscale(data: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i] as number;
    const g = data.data[i + 1] as number;
    const b = data.data[i + 2] as number;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    out.data[i] = luma;
    out.data[i + 1] = luma;
    out.data[i + 2] = luma;
  }
  return out;
}

export function invert(data: ImageData): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let i = 0; i < data.data.length; i += 4) {
    out.data[i] = 255 - (data.data[i] as number);
    out.data[i + 1] = 255 - (data.data[i + 1] as number);
    out.data[i + 2] = 255 - (data.data[i + 2] as number);
  }
  return out;
}

export function contrast(data: ImageData, factor: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const mid = 128;
  for (let i = 0; i < data.data.length; i += 4) {
    out.data[i] = Math.max(0, Math.min(255, ((data.data[i] as number) - mid) * factor + mid));
    out.data[i + 1] = Math.max(
      0,
      Math.min(255, ((data.data[i + 1] as number) - mid) * factor + mid),
    );
    out.data[i + 2] = Math.max(
      0,
      Math.min(255, ((data.data[i + 2] as number) - mid) * factor + mid),
    );
  }
  return out;
}

export function brightness(data: ImageData, delta: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  for (let i = 0; i < data.data.length; i += 4) {
    out.data[i] = Math.max(0, Math.min(255, (data.data[i] as number) + delta));
    out.data[i + 1] = Math.max(0, Math.min(255, (data.data[i + 1] as number) + delta));
    out.data[i + 2] = Math.max(0, Math.min(255, (data.data[i + 2] as number) + delta));
  }
  return out;
}

/** Separable box blur (radius in pixels, clamped to 0-4 for preview bounds). */
export function boxBlur(data: ImageData, radius: number): ImageData {
  const r = Math.max(0, Math.min(4, Math.round(radius)));
  if (r === 0) return new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const { width, height } = data;
  const horizontal = new Uint8ClampedArray(data.data);
  const vertical = new Uint8ClampedArray(data.data);
  const kernelSize = r * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let k = -r; k <= r; k += 1) {
        const px = Math.max(0, Math.min(width - 1, x + k));
        const i = (y * width + px) * 4;
        accR += data.data[i] as number;
        accG += data.data[i + 1] as number;
        accB += data.data[i + 2] as number;
        accA += data.data[i + 3] as number;
      }
      const i = (y * width + x) * 4;
      horizontal[i] = accR / kernelSize;
      horizontal[i + 1] = accG / kernelSize;
      horizontal[i + 2] = accB / kernelSize;
      horizontal[i + 3] = accA / kernelSize;
    }
  }
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;
      for (let k = -r; k <= r; k += 1) {
        const py = Math.max(0, Math.min(height - 1, y + k));
        const i = (py * width + x) * 4;
        accR += horizontal[i] as number;
        accG += horizontal[i + 1] as number;
        accB += horizontal[i + 2] as number;
        accA += horizontal[i + 3] as number;
      }
      const i = (y * width + x) * 4;
      vertical[i] = accR / kernelSize;
      vertical[i + 1] = accG / kernelSize;
      vertical[i + 2] = accB / kernelSize;
      vertical[i + 3] = accA / kernelSize;
    }
  }
  return new ImageData(vertical, width, height);
}

/** Binary threshold; opaque pixels above the value become foreground (alpha kept). */
export function threshold(data: ImageData, value: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const t = Math.max(1, Math.min(254, value));
  for (let i = 0; i < data.data.length; i += 4) {
    const luma =
      0.299 * (data.data[i] as number) +
      0.587 * (data.data[i + 1] as number) +
      0.114 * (data.data[i + 2] as number);
    const on = luma >= t;
    out.data[i] = on ? 255 : 0;
    out.data[i + 1] = on ? 255 : 0;
    out.data[i + 2] = on ? 255 : 0;
  }
  return out;
}

/** Apply the full preparation stack in a deterministic order. */
export function prepareImageData(data: ImageData, prep: SourcePrepSettings): ImageData {
  let current = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  if (prep.denoise > 0) current = boxBlur(current, prep.denoise);
  if (prep.grayscale) current = grayscale(current);
  if (prep.contrast !== 1) current = contrast(current, prep.contrast);
  if (prep.brightness !== 0) current = brightness(current, prep.brightness);
  if (prep.invert) current = invert(current);
  if (prep.threshold) current = threshold(current, 128);
  return current;
}

/** Downscale an HTMLImageElement to a bounded canvas (returns canvas + ctx). */
export function downscaleSource(
  image: HTMLImageElement,
  maxDim: number = MAX_PREVIEW_DIM,
): HTMLCanvasElement {
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}
