import type { BoundedContext } from './types';

const AUTO_MIN_CONTEXT_PADDING = 16;
const MAX_CONTEXT_PADDING = 256;

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

export function extractBoundedContext(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  contextPadding?: number,
): BoundedContext {
  const bounds = computeMaskBounds(mask, maskWidth, maskHeight);

  if (!bounds) {
    return { imageData, mask, offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight };
  }

  const padding = contextPadding ?? estimateContextPadding(bounds.w, bounds.h);
  const clamped = Math.max(1, Math.min(padding, MAX_CONTEXT_PADDING));

  const srcX = Math.max(0, maskOffsetX + bounds.x - clamped);
  const srcY = Math.max(0, maskOffsetY + bounds.y - clamped);
  const srcW = Math.min(imageData.width - srcX, bounds.w + clamped * 2);
  const srcH = Math.min(imageData.height - srcY, bounds.h + clamped * 2);

  if (srcW <= 0 || srcH <= 0) {
    return { imageData, mask, offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight };
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
): ImageData {
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
      const sa = fillResult.data[si + 3] ?? 0;

      if (sa >= 255) {
        rd[di] = fillResult.data[si]!;
        rd[di + 1] = fillResult.data[si + 1]!;
        rd[di + 2] = fillResult.data[si + 2]!;
        rd[di + 3] = 255;
      } else if (sa > 0) {
        const f = sa / 255;
        rd[di] = Math.round((imageData.data[di] ?? 0) * (1 - f) + (fillResult.data[si] ?? 0) * f);
        rd[di + 1] = Math.round(
          (imageData.data[di + 1] ?? 0) * (1 - f) + (fillResult.data[si + 1] ?? 0) * f,
        );
        rd[di + 2] = Math.round(
          (imageData.data[di + 2] ?? 0) * (1 - f) + (fillResult.data[si + 2] ?? 0) * f,
        );
        rd[di + 3] = 255;
      }
    }
  }

  return result;
}
