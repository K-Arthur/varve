import type { GenerativeEditResult } from '@varve/engine';

import { computeMaskBounds } from '@varve/engine';
import { putMaskCoverage } from './maskOperations';

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
export function samplePreviewMaskToRegion(
  previewMask: Uint8Array,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  region: SourceImageRegion,
  target: WorkingRasterDimensions,
): Uint8Array {
  if (
    previewMask.length !== previewWidth * previewHeight ||
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
        maskSample(previewMask, previewWidth, previewHeight, previewX, previewY),
      );
    }
  }
  return sampled;
}

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

/**
 * Persist a source-resolution mask without first creating a source-resolution
 * Uint8Array or ImageData. The preview mask is the editable representation;
 * the encoded PNG retains the source coordinate frame for reopening.
 */
export function encodePreviewMaskAtSourceSize(
  previewMask: Uint8Array,
  previewWidth: number,
  previewHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): string {
  if (
    previewMask.length !== previewWidth * previewHeight ||
    !validPixelCount(previewWidth, previewHeight) ||
    !validPixelCount(sourceWidth, sourceHeight)
  ) {
    throw new Error('Mask encoding dimensions are invalid');
  }
  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = previewWidth;
  previewCanvas.height = previewHeight;
  const previewContext = previewCanvas.getContext('2d');
  if (!previewContext) throw new Error('Canvas unavailable');
  putMaskCoverage(previewContext, previewMask, {
    width: previewWidth,
    height: previewHeight,
  });

  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = sourceWidth;
  sourceCanvas.height = sourceHeight;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('Canvas unavailable');
  sourceContext.imageSmoothingEnabled = false;
  sourceContext.drawImage(previewCanvas, 0, 0, sourceWidth, sourceHeight);
  return sourceCanvas.toDataURL('image/png');
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
