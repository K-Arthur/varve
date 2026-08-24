/**
 * Source-pixel resizing shared by the Image Resize dialog and editor
 * commands.  The operation deliberately lives outside context.tsx so the
 * large provider does not own resampling math or cancellation policy.
 */

import { getImageCache, resampleImageData } from '@varve/engine';
import type { ImageCropRect } from '@varve/scene';

export type ImageResizeResample = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos3';

export interface ImageResizeRequest {
  newWidth: number;
  newHeight: number;
  resample: ImageResizeResample;
}

const MAX_RESIZE_PIXELS = 64_000_000;

function positiveDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
  return Math.max(1, Math.round(value));
}

/**
 * Resize source pixels with the same alpha-safe resampler used by export.
 * Progress callbacks are used as cancellation checkpoints between output
 * bands; a cancelled operation never reaches the document update.
 */
export function resizeImageData(
  source: ImageData,
  request: ImageResizeRequest,
  signal?: AbortSignal,
): ImageData {
  const width = positiveDimension(request.newWidth, 'Width');
  const height = positiveDimension(request.newHeight, 'Height');
  if (width * height > MAX_RESIZE_PIXELS) {
    throw new Error(`Output exceeds the maximum of ${MAX_RESIZE_PIXELS} pixels`);
  }
  if (signal?.aborted) throw new Error('cancelled');

  const result = resampleImageData(source, width, height, {
    algorithm: request.resample,
    maxPixels: MAX_RESIZE_PIXELS,
    tileHeight: 256,
    onProgress: () => {
      if (signal?.aborted) throw new Error('cancelled');
    },
  });
  if (signal?.aborted) throw new Error('cancelled');
  return result.imageData;
}

/** Keep a non-destructive crop aligned with resized source pixels. */
export function resizeImageCrop(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ImageCropRect | undefined {
  if (!crop) return undefined;
  const sx = targetWidth / Math.max(1, sourceWidth);
  const sy = targetHeight / Math.max(1, sourceHeight);
  const x = Math.max(0, Math.min(targetWidth - 1, crop.x * sx));
  const y = Math.max(0, Math.min(targetHeight - 1, crop.y * sy));
  const w = Math.max(1, Math.min(targetWidth - x, crop.w * sx));
  const h = Math.max(1, Math.min(targetHeight - y, crop.h * sy));
  return { x, y, w, h };
}

/** Resize a legacy/background-removal mask without baking it into RGB data. */
export async function resizeMaskDataUrl(
  maskDataUrl: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new Error('cancelled');
  const image = await getImageCache().load(maskDataUrl);
  if (signal?.aborted) throw new Error('cancelled');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas mask resizing is unavailable');
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}
