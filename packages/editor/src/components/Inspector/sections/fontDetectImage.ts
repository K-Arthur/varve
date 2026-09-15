import type { ImageCropRect } from '@varve/scene';

/** Keep font identification bounded even when the selected image is a photo. */
export const FONT_DETECT_MAX_EDGE = 2048;

export interface FontDetectImageOptions {
  crop?: ImageCropRect;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  signal?: AbortSignal;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function safeDimension(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Decode a bounded crop for the local font detector.
 *
 * Crop coordinates stay in source-pixel space, while the detector receives a
 * scaled, orientation-preserving ImageData. The crop tool already edits the
 * image fill in source coordinates, so this keeps detection aligned with what
 * the user sees after rotation and flipping without changing the document.
 */
export function loadFontDetectionImage(
  src: string,
  options: FontDetectImageOptions = {},
): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let settled = false;
    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const rejectCancelled = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('cancelled'));
    };
    const onAbort = () => {
      rejectCancelled();
      // Stop a pending network/decode operation when the image target changes.
      img.src = '';
    };
    if (options.signal?.aborted) {
      rejectCancelled();
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    img.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const sourceWidth = safeDimension(img.naturalWidth, 1);
      const sourceHeight = safeDimension(img.naturalHeight, 1);
      const sourceScale = Math.min(1, FONT_DETECT_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
      const crop = normalizedCrop(options.crop, sourceWidth, sourceHeight);
      const cropWidth = Math.max(1, Math.round(crop.w * sourceScale));
      const cropHeight = Math.max(1, Math.round(crop.h * sourceScale));
      const radians = ((options.rotation ?? 0) * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      const rotatedWidth = cropWidth * cos + cropHeight * sin;
      const rotatedHeight = cropWidth * sin + cropHeight * cos;
      const outputScale = Math.min(
        1,
        FONT_DETECT_MAX_EDGE / Math.max(rotatedWidth, rotatedHeight, 1),
      );
      const width = Math.max(1, Math.round(rotatedWidth * outputScale));
      const height = Math.max(1, Math.round(rotatedHeight * outputScale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      context.save();
      context.translate(width / 2, height / 2);
      context.rotate(radians);
      context.scale(
        options.flipH ? -outputScale : outputScale,
        options.flipV ? -outputScale : outputScale,
      );
      context.drawImage(
        img,
        crop.x,
        crop.y,
        crop.w,
        crop.h,
        -cropWidth / 2,
        -cropHeight / 2,
        cropWidth,
        cropHeight,
      );
      context.restore();
      resolve(context.getImageData(0, 0, width, height));
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Failed to load image'));
    };
    img.crossOrigin = 'anonymous';
    img.src = src;
  });
}

export function normalizedCrop(
  crop: ImageCropRect | undefined,
  sourceWidth: number,
  sourceHeight: number,
): ImageCropRect {
  if (!crop) return { x: 0, y: 0, w: sourceWidth, h: sourceHeight };
  const x = clamp(Number.isFinite(crop.x) ? crop.x : 0, 0, Math.max(0, sourceWidth - 1));
  const y = clamp(Number.isFinite(crop.y) ? crop.y : 0, 0, Math.max(0, sourceHeight - 1));
  const w = clamp(
    Number.isFinite(crop.w) ? crop.w : sourceWidth - x,
    1,
    Math.max(1, sourceWidth - x),
  );
  const h = clamp(
    Number.isFinite(crop.h) ? crop.h : sourceHeight - y,
    1,
    Math.max(1, sourceHeight - y),
  );
  return { x, y, w, h };
}
