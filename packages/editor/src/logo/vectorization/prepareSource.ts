/**
 * Non-destructive source preparation for vectorization.
 *
 * All operations are pure functions over ImageData: they allocate a new
 * buffer, never mutate the input, and never touch the placed image node in
 * the document. The prepared pixels exist only in the panel preview session
 * and are released when the preview is replaced or discarded.
 *
 * Background removal is deliberately *physical*: only near-white pixels
 * connected to the image border through other near-white pixels are removed.
 * Enclosed white details (counters, highlights) survive, which is the
 * distinction between "remove the background" and "ignore a color".
 */

import type { SourcePrepSettings } from './settings';

/** Maximum preview dimension (long edge). Full-resolution tracing happens only on Apply. */
export const MAX_PREVIEW_DIM = 1024;

/** Near-white cutoff (all channels) used by border-connected removal. */
const NEAR_WHITE = 245;

export interface PrepareOptions {
  /** Trace threshold used by the fixed binarize stage (1-254). */
  threshold: number;
  /** Alpha cutoff; pixels below it are transparent and never background. */
  alphaThreshold: number;
}

export const DEFAULT_PREPARE_OPTIONS: PrepareOptions = { threshold: 128, alphaThreshold: 1 };

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

function lumaAt(data: Uint8ClampedArray, index: number): number {
  return (
    0.299 * (data[index] as number) +
    0.587 * (data[index + 1] as number) +
    0.114 * (data[index + 2] as number)
  );
}

/** Binary threshold; opaque pixels above the value become white (alpha kept). */
export function threshold(data: ImageData, value: number): ImageData {
  const out = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  const t = Math.max(1, Math.min(254, value));
  for (let i = 0; i < data.data.length; i += 4) {
    const on = lumaAt(data.data, i) >= t;
    out.data[i] = on ? 255 : 0;
    out.data[i + 1] = on ? 255 : 0;
    out.data[i + 2] = on ? 255 : 0;
  }
  return out;
}

/**
 * Bradley–Roth adaptive threshold: a pixel is ink when its luma is more than
 * `sensitivity` percent below the mean of a square window around it. Output is
 * black (below local mean) / white, matching the fixed threshold's polarity so
 * the tracer's foreground direction keeps its meaning.
 *
 * Implemented with a sliding window (O(width * window) memory) rather than an
 * integral image: a 4096 px final trace would need a ~67 MB integral buffer.
 */
export function adaptiveThreshold(
  data: ImageData,
  windowSize: number,
  sensitivity: number,
): ImageData {
  const { width, height } = data;
  const out = new ImageData(new Uint8ClampedArray(data.data), width, height);
  if (width === 0 || height === 0) return out;
  const requested = Math.round(windowSize) || Math.max(3, Math.round(Math.min(width, height) / 8));
  const bounded = Math.max(3, Math.min(255, requested));
  const size = bounded % 2 === 0 ? bounded + 1 : bounded;
  const radius = (size - 1) / 2;
  const ringRows = radius * 2 + 1;
  const ring = new Float64Array(width * ringRows);
  const vertical = new Float64Array(width);
  const factor = 1 - Math.max(1, Math.min(50, sensitivity)) / 100;

  const rowSlice = (row: number): Float64Array => {
    const base = (row % ringRows) * width;
    let sum = 0;
    const firstEnd = Math.min(radius, width - 1);
    for (let x = 0; x <= firstEnd; x += 1) sum += lumaAt(data.data, (row * width + x) * 4);
    for (let x = 0; x < width; x += 1) {
      ring[base + x] = sum;
      const addX = Math.min(x + radius + 1, width - 1);
      const subX = Math.max(x - radius, 0);
      sum +=
        lumaAt(data.data, (row * width + addX) * 4) - lumaAt(data.data, (row * width + subX) * 4);
    }
    return ring.subarray(base, base + width);
  };

  for (let y = 0; y < height; y += 1) {
    const addRow = y + radius;
    if (addRow < height) {
      const sums = rowSlice(addRow);
      for (let x = 0; x < width; x += 1)
        vertical[x] = (vertical[x] as number) + (sums[x] as number);
    }
    const removeRow = y - radius - 1;
    if (removeRow >= 0) {
      const base = (removeRow % ringRows) * width;
      for (let x = 0; x < width; x += 1) vertical[x] = (vertical[x] as number) - ring[base + x]!;
    }
    const yTop = Math.max(0, y - radius);
    const yBottom = Math.min(height - 1, y + radius);
    const rows = yBottom - yTop + 1;
    for (let x = 0; x < width; x += 1) {
      const xLeft = Math.max(0, x - radius);
      const xRight = Math.min(width - 1, x + radius);
      const count = (xRight - xLeft + 1) * rows;
      const mean = count > 0 ? (vertical[x] as number) / count : 0;
      const i = (y * width + x) * 4;
      const on = lumaAt(data.data, i) >= mean * factor;
      out.data[i] = on ? 255 : 0;
      out.data[i + 1] = on ? 255 : 0;
      out.data[i + 2] = on ? 255 : 0;
    }
  }
  return out;
}

/**
 * Remove near-white pixels reachable from the image border (scanline flood
 * fill). Removed pixels become fully transparent; enclosed near-white regions
 * are left untouched. Returns the input unchanged when nothing qualifies.
 */
export function removeBorderConnectedBackground(
  data: ImageData,
  nearWhiteCutoff: number = NEAR_WHITE,
): ImageData {
  const { width, height } = data;
  if (width === 0 || height === 0) return data;
  const cutoff = Math.max(1, Math.min(255, Math.round(nearWhiteCutoff)));
  let removable = 0;
  for (let i = 0; i < width * height; i += 1) {
    if (
      (data.data[i * 4] as number) >= cutoff &&
      (data.data[i * 4 + 1] as number) >= cutoff &&
      (data.data[i * 4 + 2] as number) >= cutoff
    ) {
      removable += 1;
    }
  }
  if (removable === 0) return data;
  const out = new ImageData(new Uint8ClampedArray(data.data), width, height);
  return removeBorderConnectedBackgroundInPlace(out, cutoff);
}

function removeBorderConnectedBackgroundInPlace(
  data: ImageData,
  nearWhiteCutoff: number = NEAR_WHITE,
): ImageData {
  const { width, height } = data;
  if (width === 0 || height === 0) return data;
  const cutoff = Math.max(1, Math.min(255, Math.round(nearWhiteCutoff)));
  const candidate = new Uint8Array(width * height);
  let removable = 0;
  const isCandidate = (index: number): boolean =>
    (data.data[index * 4] as number) >= cutoff &&
    (data.data[index * 4 + 1] as number) >= cutoff &&
    (data.data[index * 4 + 2] as number) >= cutoff;
  for (let i = 0; i < candidate.length; i += 1) {
    if (isCandidate(i)) {
      candidate[i] = 1;
      removable += 1;
    }
  }
  if (removable === 0) return data;

  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const index = y * width + x;
    if (candidate[index]) {
      candidate[index] = 0;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length > 0) {
    const index = stack.pop() as number;
    const x = index % width;
    const y = Math.floor(index / width);
    data.data[index * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  return data;
}

/** True when the preparation stack cannot change any pixel. */
export function isIdentityPrep(prep: SourcePrepSettings): boolean {
  return (
    !prep.grayscale &&
    !prep.invert &&
    prep.contrast === 1 &&
    prep.brightness === 0 &&
    prep.denoise === 0 &&
    !prep.threshold &&
    !prep.adaptiveThreshold &&
    !prep.removeBackground
  );
}

/** Apply the full preparation stack in a deterministic order. */
export function prepareImageData(
  data: ImageData,
  prep: SourcePrepSettings,
  options: PrepareOptions = DEFAULT_PREPARE_OPTIONS,
): ImageData {
  if (isIdentityPrep(prep)) return data;
  let current = new ImageData(new Uint8ClampedArray(data.data), data.width, data.height);
  if (prep.denoise > 0) current = boxBlur(current, prep.denoise);
  if (prep.removeBackground) current = removeBorderConnectedBackgroundInPlace(current);
  if (prep.grayscale) current = grayscale(current);
  if (prep.contrast !== 1) current = contrast(current, prep.contrast);
  if (prep.brightness !== 0) current = brightness(current, prep.brightness);
  if (prep.invert) current = invert(current);
  if (prep.adaptiveThreshold) {
    current = adaptiveThreshold(current, prep.adaptiveWindow, prep.adaptiveSensitivity);
  } else if (prep.threshold) {
    current = threshold(current, options.threshold);
  }
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
