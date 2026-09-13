import type { BoundedContext } from './types';

const AUTO_MIN_CONTEXT_PADDING = 16;
const MAX_CONTEXT_PADDING = 256;

export interface BoundedContextRegion {
  /** X offset of the region within the source image. */
  offsetX: number;
  /** Y offset of the region within the source image. */
  offsetY: number;
  /** Width of the region in source-image pixels. */
  width: number;
  /** Height of the region in source-image pixels. */
  height: number;
}

function estimateContextPadding(maskWidth: number, maskHeight: number): number {
  const maxDim = Math.max(maskWidth, maskHeight);
  if (maxDim <= 64) return Math.max(AUTO_MIN_CONTEXT_PADDING, maxDim);
  if (maxDim <= 256) return Math.max(AUTO_MIN_CONTEXT_PADDING, Math.round(maxDim * 0.3));
  if (maxDim <= 512) return Math.max(AUTO_MIN_CONTEXT_PADDING, Math.round(maxDim * 0.2));
  if (maxDim <= 1024) return Math.max(AUTO_MIN_CONTEXT_PADDING, Math.round(maxDim * 0.15));
  return Math.max(AUTO_MIN_CONTEXT_PADDING, Math.round(maxDim * 0.1));
}

export function computeMaskBounds(
  mask: Uint8Array,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((mask[y * width + x] ?? 0) > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Calculate the bounded inference region without allocating an ImageData.
 *
 * The generation admission check uses this function before it creates a
 * context buffer. Keeping the geometry calculation separate prevents a
 * small edit on a very large photograph from being budgeted as a full-frame
 * model request.
 */
export function computeBoundedContextRegion(
  imageWidth: number,
  imageHeight: number,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  contextPadding?: number,
): BoundedContextRegion {
  const bounds = computeMaskBounds(mask, maskWidth, maskHeight);

  if (!bounds) {
    return { offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight };
  }

  const padding = contextPadding ?? estimateContextPadding(bounds.w, bounds.h);
  const clamped = Math.max(1, Math.min(padding, MAX_CONTEXT_PADDING));
  const srcX = Math.max(0, maskOffsetX + bounds.x - clamped);
  const srcY = Math.max(0, maskOffsetY + bounds.y - clamped);
  const srcW = Math.min(imageWidth - srcX, bounds.w + clamped * 2);
  const srcH = Math.min(imageHeight - srcY, bounds.h + clamped * 2);

  if (srcW <= 0 || srcH <= 0) {
    return { offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight };
  }

  return { offsetX: srcX, offsetY: srcY, width: srcW, height: srcH };
}

export function extractBoundedContext(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  contextPadding?: number,
): BoundedContext {
  const region = computeBoundedContextRegion(
    imageData.width,
    imageData.height,
    mask,
    maskWidth,
    maskHeight,
    maskOffsetX,
    maskOffsetY,
    contextPadding,
  );
  const { offsetX: srcX, offsetY: srcY, width: srcW, height: srcH } = region;

  if (srcW === imageData.width && srcH === imageData.height && srcX === 0 && srcY === 0) {
    return {
      imageData,
      mask,
      offsetX: 0,
      offsetY: 0,
      width: maskWidth,
      height: maskHeight,
    };
  }

  const boundedImageData = new ImageData(srcW, srcH);
  const boundedMask = new Uint8Array(srcW * srcH);

  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const imageX = srcX + x;
      const imageY = srcY + y;

      const srcIdx = (imageY * imageData.width + imageX) * 4;
      const dstIdx = (y * srcW + x) * 4;
      boundedImageData.data[dstIdx] = imageData.data[srcIdx] ?? 0;
      boundedImageData.data[dstIdx + 1] = imageData.data[srcIdx + 1] ?? 0;
      boundedImageData.data[dstIdx + 2] = imageData.data[srcIdx + 2] ?? 0;
      boundedImageData.data[dstIdx + 3] = imageData.data[srcIdx + 3] ?? 0;

      const maskLocalX = imageX - maskOffsetX;
      const maskLocalY = imageY - maskOffsetY;
      if (maskLocalX >= 0 && maskLocalX < maskWidth && maskLocalY >= 0 && maskLocalY < maskHeight) {
        boundedMask[y * srcW + x] = mask[maskLocalY * maskWidth + maskLocalX] ?? 0;
      }
    }
  }

  return {
    imageData: boundedImageData,
    mask: boundedMask,
    offsetX: srcX,
    offsetY: srcY,
    width: srcW,
    height: srcH,
  };
}

export function compositeFillResult(
  imageData: ImageData,
  fillResult: ImageData,
  fillOffsetX: number,
  fillOffsetY: number,
  mask?: Uint8Array,
): ImageData {
  if (
    !Number.isSafeInteger(fillOffsetX) ||
    !Number.isSafeInteger(fillOffsetY) ||
    (mask !== undefined && mask.length !== fillResult.width * fillResult.height)
  ) {
    throw new Error('Fill result offsets or mask dimensions are invalid');
  }

  const result = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
  const rd = result.data;

  for (let y = 0; y < fillResult.height; y++) {
    for (let x = 0; x < fillResult.width; x++) {
      const dstX = fillOffsetX + x;
      const dstY = fillOffsetY + y;
      if (dstX < 0 || dstX >= imageData.width || dstY < 0 || dstY >= imageData.height) continue;

      const si = (y * fillResult.width + x) * 4;
      const di = (dstY * imageData.width + dstX) * 4;
      const maskCoverage = mask ? (mask[y * fillResult.width + x] ?? 0) / 255 : 1;
      const sourceAlpha = (imageData.data[di + 3] ?? 0) / 255;
      const fillAlpha = ((fillResult.data[si + 3] ?? 0) / 255) * maskCoverage;
      const outputAlpha = fillAlpha + sourceAlpha * (1 - fillAlpha);

      if (outputAlpha <= 0) {
        rd[di] = 0;
        rd[di + 1] = 0;
        rd[di + 2] = 0;
        rd[di + 3] = 0;
        continue;
      }

      // Model output is straight-alpha sRGB. Composite in premultiplied
      // linear light so soft masks and transparent edges do not produce dark
      // halos or force every partially covered pixel opaque.
      const sourceWeight = sourceAlpha * (1 - fillAlpha);
      const fillWeight = fillAlpha;
      const sourceR = srgbToLinear((imageData.data[di] ?? 0) / 255);
      const sourceG = srgbToLinear((imageData.data[di + 1] ?? 0) / 255);
      const sourceB = srgbToLinear((imageData.data[di + 2] ?? 0) / 255);
      const fillR = srgbToLinear((fillResult.data[si] ?? 0) / 255);
      const fillG = srgbToLinear((fillResult.data[si + 1] ?? 0) / 255);
      const fillB = srgbToLinear((fillResult.data[si + 2] ?? 0) / 255);

      rd[di] = Math.round(
        linearToSrgb((sourceR * sourceWeight + fillR * fillWeight) / outputAlpha) * 255,
      );
      rd[di + 1] = Math.round(
        linearToSrgb((sourceG * sourceWeight + fillG * fillWeight) / outputAlpha) * 255,
      );
      rd[di + 2] = Math.round(
        linearToSrgb((sourceB * sourceWeight + fillB * fillWeight) / outputAlpha) * 255,
      );
      rd[di + 3] = Math.round(outputAlpha * 255);
    }
  }

  return result;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}
