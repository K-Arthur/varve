import type { GenerativeEditResult } from '@varve/engine';

import { computeMaskBounds } from '@varve/engine';

export interface SourceImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkingRasterDimensions {
  width: number;
  height: number;
}

const MAX_CONTEXT_PADDING = 256;
const WORKING_PIXEL_BUDGETS: Record<string, number> = {
  constrained: 1_048_576,
  standard: 4_000_000,
  high: 8_000_000,
  unknown: 2_000_000,
};
const DEFAULT_WORKING_PIXEL_BUDGET = 2_000_000;

function validDimensions(width: number, height: number): boolean {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0;
}

function validPixelCount(width: number, height: number): boolean {
  return validDimensions(width, height) && Number.isSafeInteger(width * height);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Return the maximum temporary raster size appropriate for the reported tier. */
export function workingPixelBudgetForTier(tier: string | undefined): number {
  return WORKING_PIXEL_BUDGETS[tier ?? 'unknown'] ?? DEFAULT_WORKING_PIXEL_BUDGET;
}

/**
 * Map a mask painted on the bounded preview to a source-image rectangle.
 * Padding is in source-image pixels, not preview pixels.
 */
export function computeSourceRegionFromPreviewMask(
  previewMask: Uint8Array,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  contextPadding = 32,
): SourceImageRegion | null {
  if (
    !validPixelCount(previewWidth, previewHeight) ||
    !validPixelCount(sourceWidth, sourceHeight) ||
    previewMask.length !== previewWidth * previewHeight
  ) {
    throw new Error('Preview mask or source dimensions are invalid');
  }

  const bounds = computeMaskBounds(previewMask, previewWidth, previewHeight);
  if (!bounds) return null;

  const padding = Math.max(0, Math.min(MAX_CONTEXT_PADDING, Math.round(contextPadding)));
  const scaleX = sourceWidth / previewWidth;
  const scaleY = sourceHeight / previewHeight;
  const x = Math.max(0, Math.floor(bounds.x * scaleX) - padding);
  const y = Math.max(0, Math.floor(bounds.y * scaleY) - padding);
  const right = Math.min(sourceWidth, Math.ceil((bounds.x + bounds.w) * scaleX) + padding);
  const bottom = Math.min(sourceHeight, Math.ceil((bounds.y + bounds.h) * scaleY) + padding);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Find a padded source rectangle from a mask that already uses source-image
 * pixels. This is intentionally separate from the preview mapper: a model
 * candidate may contain thin or edge-touching details that disappear when it
 * is first reduced to the dialog preview.
 */
export function computeSourceRegionFromMaskCoverage(
  mask: Uint8Array,
  width: number,
  height: number,
  contextPadding = 32,
): SourceImageRegion | null {
  if (!validPixelCount(width, height) || mask.length !== width * height) {
    throw new Error('Source mask or dimensions are invalid');
  }
  const bounds = computeMaskBounds(mask, width, height);
  if (!bounds) return null;
  const padding = Math.max(0, Math.min(MAX_CONTEXT_PADDING, Math.round(contextPadding)));
  const x = Math.max(0, bounds.x - padding);
  const y = Math.max(0, bounds.y - padding);
  const right = Math.min(width, bounds.x + bounds.w + padding);
  const bottom = Math.min(height, bounds.y + bounds.h + padding);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/** Cap a source rectangle without changing its aspect ratio. */
export function workingRasterDimensions(
  region: SourceImageRegion,
  maxPixels: number,
): WorkingRasterDimensions {
  if (!validPixelCount(region.width, region.height)) {
    throw new Error('Source region dimensions are invalid');
  }
  if (!Number.isSafeInteger(maxPixels) || maxPixels <= 0) {
    throw new Error('Working raster budget is invalid');
  }
  const pixels = region.width * region.height;
  if (pixels <= maxPixels) return { width: region.width, height: region.height };
  const scale = Math.sqrt(maxPixels / pixels);
  return {
    width: Math.max(1, Math.floor(region.width * scale)),
    height: Math.max(1, Math.floor(region.height * scale)),
  };
}

function maskSample(mask: Uint8Array, width: number, height: number, x: number, y: number): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const xWeight = Math.max(0, Math.min(1, x - x0));
  const yWeight = Math.max(0, Math.min(1, y - y0));
  const top = (mask[y0 * width + x0] ?? 0) * (1 - xWeight) + (mask[y0 * width + x1] ?? 0) * xWeight;
  const bottom =
    (mask[y1 * width + x0] ?? 0) * (1 - xWeight) + (mask[y1 * width + x1] ?? 0) * xWeight;
  return top * (1 - yWeight) + bottom * yWeight;
}

/** Resample only the selected source rectangle; never creates a full source mask. */
export function sampleMaskCoverageToRegion(
  sourceMask: Uint8Array,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  region: SourceImageRegion,
  target: WorkingRasterDimensions,
): Uint8Array {
  if (
    sourceMask.length !== previewWidth * previewHeight ||
    !validPixelCount(previewWidth, previewHeight) ||
    !validPixelCount(sourceWidth, sourceHeight) ||
    !validPixelCount(region.width, region.height) ||
    !validPixelCount(target.width, target.height)
  ) {
    throw new Error('Mask sampling dimensions are invalid');
  }
  const sampled = new Uint8Array(target.width * target.height);
  for (let y = 0; y < target.height; y += 1) {
    const sourceY = region.y + ((y + 0.5) * region.height) / target.height - 0.5;
    const previewY = ((sourceY + 0.5) * previewHeight) / sourceHeight - 0.5;
    for (let x = 0; x < target.width; x += 1) {
      const sourceX = region.x + ((x + 0.5) * region.width) / target.width - 0.5;
      const previewX = ((sourceX + 0.5) * previewWidth) / sourceWidth - 0.5;
      sampled[y * target.width + x] = clampByte(
        maskSample(sourceMask, previewWidth, previewHeight, previewX, previewY),
      );
    }
  }
  return sampled;
}

/** Backwards-compatible name for callers whose mask is the bounded preview. */
export const samplePreviewMaskToRegion = sampleMaskCoverageToRegion;

/** Decode just a source rectangle into a bounded ImageData working raster. */
export function loadImageRegionToImageData(
  image: CanvasImageSource,
  region: SourceImageRegion,
  target: WorkingRasterDimensions = { width: region.width, height: region.height },
): ImageData {
  if (
    !validPixelCount(region.width, region.height) ||
    !validPixelCount(target.width, target.height) ||
    region.x < 0 ||
    region.y < 0
  ) {
    throw new Error('Image region dimensions are invalid');
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.imageSmoothingEnabled = target.width !== region.width || target.height !== region.height;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    image,
    region.x,
    region.y,
    region.width,
    region.height,
    0,
    0,
    target.width,
    target.height,
  );
  return context.getImageData(0, 0, target.width, target.height);
}

function pngCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes);
  crcInput.set(data, typeBytes.length);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, pngCrc32(crcInput));
  return chunk;
}

function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function encodeMaskRowsAsPng(
  width: number,
  height: number,
  writeCoverageRow: (y: number, row: Uint8Array) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!validPixelCount(width, height) || width > 0xffffffff || height > 0xffffffff) {
    throw new Error('Mask encoding dimensions are invalid');
  }
  if (typeof CompressionStream === 'undefined') {
    throw new Error(
      'This runtime cannot persist a full-resolution generative mask. Update the desktop runtime or use a current browser.',
    );
  }

  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressedPromise = new Response(stream.readable).arrayBuffer();
  try {
    const row = new Uint8Array(width + 1);
    row[0] = 0; // PNG filter: None. Each row is independently generated.
    for (let y = 0; y < height; y += 1) {
      if (signal?.aborted) throw new Error('Generative mask encoding was cancelled.');
      writeCoverageRow(y, row);
      await writer.write(row);
    }
    await writer.close();
    const compressed = new Uint8Array(await compressedPromise);
    const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new Uint8Array(13);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, width);
    headerView.setUint32(4, height);
    header[8] = 8; // bit depth
    header[9] = 0; // grayscale
    header[10] = 0; // compression method
    header[11] = 0; // filter method
    header[12] = 0; // no interlace
    const png = concatenateBytes([
      signature,
      pngChunk('IHDR', header),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', new Uint8Array()),
    ]);
    return `data:image/png;base64,${bytesToBase64(png)}`;
  } catch (error) {
    await writer.abort(error).catch(() => undefined);
    await compressedPromise.catch(() => undefined);
    throw error;
  }
}

/** Encode an already source-sized mask without resampling it through a preview. */
export function encodeMaskCoverageAtSourceSize(
  coverage: Uint8Array,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  if (!validPixelCount(width, height) || coverage.length !== width * height) {
    return Promise.reject(new Error('Mask encoding dimensions are invalid'));
  }
  return encodeMaskRowsAsPng(
    width,
    height,
    (y, row) => row.set(coverage.subarray(y * width, (y + 1) * width), 1),
    signal,
  );
}

/**
 * Persist a source-resolution mask without first creating a source-resolution
 * Uint8Array or ImageData. The preview mask is the editable representation;
 * the encoded grayscale PNG retains the source coordinate frame for
 * reopening. CompressionStream is used row-by-row so a large photograph
 * consumes only one scanline plus the compressed output in working memory.
 */
export async function encodePreviewMaskAtSourceSize(
  previewMask: Uint8Array,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  signal?: AbortSignal,
): Promise<string> {
  if (
    previewMask.length !== previewWidth * previewHeight ||
    !validPixelCount(previewWidth, previewHeight) ||
    !validPixelCount(sourceWidth, sourceHeight) ||
    sourceWidth > 0xffffffff ||
    sourceHeight > 0xffffffff
  ) {
    throw new Error('Mask encoding dimensions are invalid');
  }
  return encodeMaskRowsAsPng(
    sourceWidth,
    sourceHeight,
    (_y, row) => {
      const sourceY = Math.min(
        previewHeight - 1,
        Math.floor(((_y + 0.5) * previewHeight) / sourceHeight),
      );
      const previewRow = sourceY * previewWidth;
      for (let x = 0; x < sourceWidth; x += 1) {
        const previewX = Math.min(
          previewWidth - 1,
          Math.floor(((x + 0.5) * previewWidth) / sourceWidth),
        );
        row[x + 1] = previewMask[previewRow + previewX] ?? 0;
      }
    },
    signal,
  );
}

/**
 * Convert an already-composited local result into a source-over overlay.
 * Solving the encoded-channel alpha/color equation avoids double-applying
 * soft mask coverage when the bounded result is placed over the browser's
 * default premultiplied-sRGB source canvas. The engine has already performed
 * the intended linear-light composite inside the bounded result.
 */
export function deriveGeneratedOverlay(
  source: ImageData,
  composited: ImageData,
  mask: Uint8Array,
): ImageData {
  if (
    source.width !== composited.width ||
    source.height !== composited.height ||
    mask.length !== source.width * source.height
  ) {
    throw new Error('Generated overlay dimensions are invalid');
  }
  const overlay = new ImageData(source.width, source.height);
  for (let index = 0; index < mask.length; index += 1) {
    const coverage = (mask[index] ?? 0) / 255;
    if (coverage <= 0) continue;
    const offset = index * 4;
    const sourceAlpha = (source.data[offset + 3] ?? 0) / 255;
    const resultAlpha = (composited.data[offset + 3] ?? 0) / 255;
    if (resultAlpha <= 0) continue;
    const overlayAlpha =
      sourceAlpha < 0.999999
        ? Math.max(0, Math.min(1, (resultAlpha - sourceAlpha) / (1 - sourceAlpha)))
        : coverage;
    if (overlayAlpha <= 1 / 255) continue;

    for (let channel = 0; channel < 3; channel += 1) {
      const sourcePremultiplied = ((source.data[offset + channel] ?? 0) / 255) * sourceAlpha;
      const resultPremultiplied = ((composited.data[offset + channel] ?? 0) / 255) * resultAlpha;
      const overlayPremultiplied = resultPremultiplied - sourcePremultiplied * (1 - overlayAlpha);
      overlay.data[offset + channel] = clampByte((overlayPremultiplied / overlayAlpha) * 255);
    }
    overlay.data[offset + 3] = clampByte(overlayAlpha * 255);
  }
  return overlay;
}

/** Map a source-pixel region into a bounded decoded proxy without stretching. */
export function mapSourceRegionToProxy(
  region: SourceImageRegion,
  sourceWidth: number,
  sourceHeight: number,
  proxyWidth: number,
  proxyHeight: number,
): SourceImageRegion {
  if (
    !validDimensions(sourceWidth, sourceHeight) ||
    !validDimensions(proxyWidth, proxyHeight) ||
    !validPixelCount(region.width, region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > sourceWidth ||
    region.y + region.height > sourceHeight
  ) {
    throw new Error('Source and proxy dimensions are invalid');
  }
  const scaleX = proxyWidth / sourceWidth;
  const scaleY = proxyHeight / sourceHeight;
  const left = Math.max(0, Math.min(proxyWidth - 1, Math.floor(region.x * scaleX)));
  const top = Math.max(0, Math.min(proxyHeight - 1, Math.floor(region.y * scaleY)));
  const right = Math.max(
    left + 1,
    Math.min(proxyWidth, Math.ceil((region.x + region.width) * scaleX)),
  );
  const bottom = Math.max(
    top + 1,
    Math.min(proxyHeight, Math.ceil((region.y + region.height) * scaleY)),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Render only the transparent patch for a bounded generative result. */
export function renderGeneratedRegionToPatchCanvas(options: {
  source: ImageData;
  result: GenerativeEditResult;
  mask: Uint8Array;
}): HTMLCanvasElement {
  const overlay = deriveGeneratedOverlay(options.source, options.result.imageData, options.mask);
  const canvas = document.createElement('canvas');
  canvas.width = overlay.width;
  canvas.height = overlay.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.putImageData(overlay, 0, 0);
  return canvas;
}

/**
 * Compose a candidate into the already-bounded dialog preview. This keeps
 * visual review honest while avoiding a source-resolution output canvas.
 */
export function renderGeneratedRegionToPreviewCanvas(options: {
  preview: CanvasImageSource;
  previewWidth: number;
  previewHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  region: SourceImageRegion;
  source: ImageData;
  result: GenerativeEditResult;
  mask: Uint8Array;
}): HTMLCanvasElement {
  const {
    preview,
    previewWidth,
    previewHeight,
    sourceWidth,
    sourceHeight,
    region,
    source,
    result,
    mask,
  } = options;
  if (
    !validDimensions(previewWidth, previewHeight) ||
    !validDimensions(sourceWidth, sourceHeight) ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > sourceWidth ||
    region.y + region.height > sourceHeight
  ) {
    throw new Error('Generated preview region is outside the source image');
  }
  const canvas = document.createElement('canvas');
  canvas.width = previewWidth;
  canvas.height = previewHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(preview, 0, 0, previewWidth, previewHeight);

  const patch = renderGeneratedRegionToPatchCanvas({ source, result, mask });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    patch,
    0,
    0,
    patch.width,
    patch.height,
    (region.x / sourceWidth) * previewWidth,
    (region.y / sourceHeight) * previewHeight,
    (region.width / sourceWidth) * previewWidth,
    (region.height / sourceHeight) * previewHeight,
  );
  return canvas;
}

export function compositeGeneratedRegionToPatchDataUrl(options: {
  source: ImageData;
  result: GenerativeEditResult;
  mask: Uint8Array;
}): string {
  return renderGeneratedRegionToPatchCanvas(options).toDataURL('image/png');
}

/**
 * Composite a bounded generated result into a full source canvas. The only
 * full-frame allocation here is the final canvas needed for the accepted PNG;
 * source and inference ImageData remain bounded to the edit region.
 */
export function renderGeneratedRegionToCanvas(options: {
  image: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  region: SourceImageRegion;
  source: ImageData;
  result: GenerativeEditResult;
  mask: Uint8Array;
}): HTMLCanvasElement {
  const { image, sourceWidth, sourceHeight, region, source, result, mask } = options;
  if (
    !validDimensions(sourceWidth, sourceHeight) ||
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > sourceWidth ||
    region.y + region.height > sourceHeight ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new Error('Generated source region is outside the source image');
  }
  const output = document.createElement('canvas');
  output.width = sourceWidth;
  output.height = sourceHeight;
  const outputContext = output.getContext('2d');
  if (!outputContext) throw new Error('Canvas unavailable');
  outputContext.drawImage(image, 0, 0, sourceWidth, sourceHeight);

  const overlay = deriveGeneratedOverlay(source, result.imageData, mask);
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = overlay.width;
  overlayCanvas.height = overlay.height;
  const overlayContext = overlayCanvas.getContext('2d');
  if (!overlayContext) throw new Error('Canvas unavailable');
  overlayContext.putImageData(overlay, 0, 0);
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(
    overlayCanvas,
    0,
    0,
    overlay.width,
    overlay.height,
    region.x,
    region.y,
    region.width,
    region.height,
  );
  return output;
}

export function compositeGeneratedRegionToDataUrl(options: {
  image: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  region: SourceImageRegion;
  source: ImageData;
  result: GenerativeEditResult;
  mask: Uint8Array;
}): string {
  return renderGeneratedRegionToCanvas(options).toDataURL('image/png');
}
