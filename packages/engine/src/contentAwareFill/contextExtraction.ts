import type { BoundedContext } from './types';

const AUTO_MIN_CONTEXT_PADDING = 16;
const MAX_CONTEXT_PADDING = 256;

/**
 * Expand a bounded context toward the model's preferred aspect ratio without
 * changing which source pixels it represents. This is deliberately a
 * containing operation: the mask stays at the same source coordinates and a
 * context that cannot fit remains letterboxed by the model-frame adapter.
 */
function fitContextToAspectRatio(
  region: BoundedContextRegion,
  imageWidth: number,
  imageHeight: number,
  targetAspectRatio: number | undefined,
): BoundedContextRegion {
  if (targetAspectRatio === undefined) return region;
  if (!Number.isFinite(targetAspectRatio) || targetAspectRatio <= 0) {
    throw new Error('Model context aspect ratio must be a finite number greater than zero.');
  }

  let width = region.width;
  let height = region.height;
  const currentAspectRatio = width / height;
  if (currentAspectRatio < targetAspectRatio) {
    const targetWidth = Math.max(width, Math.round(height * targetAspectRatio));
    if (targetWidth <= imageWidth) {
      width = targetWidth;
    } else {
      // The source is too narrow to contain an exact target-ratio rectangle.
      // Use every available source column and the closest possible height.
      width = imageWidth;
      height = Math.min(imageHeight, Math.max(height, Math.round(width / targetAspectRatio)));
    }
  } else if (currentAspectRatio > targetAspectRatio) {
    const targetHeight = Math.max(height, Math.round(width / targetAspectRatio));
    if (targetHeight <= imageHeight) {
      height = targetHeight;
    } else {
      // The source is too short to contain an exact target-ratio rectangle.
      // Use every available source row and the closest possible width.
      height = imageHeight;
      width = Math.min(imageWidth, Math.max(width, Math.round(height * targetAspectRatio)));
    }
  }

  const centeredOrigin = (
    origin: number,
    length: number,
    containerLength: number,
    fittedLength: number,
  ): number => {
    const minimum = Math.max(0, origin + length - fittedLength);
    const maximum = Math.min(origin, containerLength - fittedLength);
    const centered = Math.round(origin + (length - fittedLength) / 2);
    return Math.max(minimum, Math.min(maximum, centered));
  };

  return {
    offsetX: centeredOrigin(region.offsetX, region.width, imageWidth, width),
    offsetY: centeredOrigin(region.offsetY, region.height, imageHeight, height),
    width,
    height,
  };
}

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

export type MaskFrameGeometryErrorCode =
  | 'invalid-image-dimensions'
  | 'invalid-mask-dimensions'
  | 'invalid-mask-offset'
  | 'mask-length-mismatch'
  | 'mask-out-of-bounds';

export type MaskFrameGeometryValidation =
  | { valid: true; right: number; bottom: number }
  | { valid: false; code: MaskFrameGeometryErrorCode; message: string };

/**
 * Validate the coordinate frame shared by selection, inference, and
 * compositing. A mask is a finite source-image frame; silently clipping a
 * partially out-of-bounds frame changes which pixels the user's selection
 * refers to and can make a valid-looking preview edit the wrong object.
 */
export function validateMaskFrameGeometry(
  imageWidth: number,
  imageHeight: number,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX = 0,
  maskOffsetY = 0,
): MaskFrameGeometryValidation {
  if (
    !Number.isSafeInteger(imageWidth) ||
    !Number.isSafeInteger(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return {
      valid: false,
      code: 'invalid-image-dimensions',
      message: 'The source image dimensions are invalid.',
    };
  }
  if (
    !Number.isSafeInteger(maskWidth) ||
    !Number.isSafeInteger(maskHeight) ||
    maskWidth <= 0 ||
    maskHeight <= 0 ||
    !Number.isSafeInteger(maskWidth * maskHeight)
  ) {
    return {
      valid: false,
      code: 'invalid-mask-dimensions',
      message: 'The edit mask dimensions are invalid.',
    };
  }
  if (mask.length !== maskWidth * maskHeight) {
    return {
      valid: false,
      code: 'mask-length-mismatch',
      message: 'The edit mask dimensions do not match its pixels.',
    };
  }
  if (!Number.isSafeInteger(maskOffsetX) || !Number.isSafeInteger(maskOffsetY)) {
    return {
      valid: false,
      code: 'invalid-mask-offset',
      message: 'The edit mask origin is invalid.',
    };
  }
  const right = maskOffsetX + maskWidth;
  const bottom = maskOffsetY + maskHeight;
  if (
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(bottom) ||
    maskOffsetX < 0 ||
    maskOffsetY < 0 ||
    right > imageWidth ||
    bottom > imageHeight
  ) {
    return {
      valid: false,
      code: 'mask-out-of-bounds',
      message: `The edit mask frame (${maskOffsetX}, ${maskOffsetY}, ${maskWidth} × ${maskHeight}) must be fully inside the ${imageWidth} × ${imageHeight} source image. Recreate the selection on the current image.`,
    };
  }
  return { valid: true, right, bottom };
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
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isSafeInteger(width * height) ||
    mask.length !== width * height
  ) {
    throw new Error('Mask dimensions do not match its pixels.');
  }
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
  /** Optional model ratio to approach before the fixed-frame conversion. */
  targetAspectRatio?: number,
): BoundedContextRegion {
  const geometry = validateMaskFrameGeometry(
    imageWidth,
    imageHeight,
    mask,
    maskWidth,
    maskHeight,
    maskOffsetX,
    maskOffsetY,
  );
  if (!geometry.valid) throw new Error(geometry.message);
  const bounds = computeMaskBounds(mask, maskWidth, maskHeight);

  if (!bounds) {
    return fitContextToAspectRatio(
      { offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight },
      imageWidth,
      imageHeight,
      targetAspectRatio,
    );
  }

  const padding = contextPadding ?? estimateContextPadding(bounds.w, bounds.h);
  const clamped = Math.max(1, Math.min(padding, MAX_CONTEXT_PADDING));
  const srcX = Math.max(0, maskOffsetX + bounds.x - clamped);
  const srcY = Math.max(0, maskOffsetY + bounds.y - clamped);
  const srcW = Math.min(imageWidth - srcX, bounds.w + clamped * 2);
  const srcH = Math.min(imageHeight - srcY, bounds.h + clamped * 2);

  if (srcW <= 0 || srcH <= 0) {
    return fitContextToAspectRatio(
      { offsetX: 0, offsetY: 0, width: maskWidth, height: maskHeight },
      imageWidth,
      imageHeight,
      targetAspectRatio,
    );
  }

  return fitContextToAspectRatio(
    { offsetX: srcX, offsetY: srcY, width: srcW, height: srcH },
    imageWidth,
    imageHeight,
    targetAspectRatio,
  );
}

export function extractBoundedContext(
  imageData: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  maskOffsetX: number,
  maskOffsetY: number,
  contextPadding?: number,
  targetAspectRatio?: number,
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
    targetAspectRatio,
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

      // A zero-coverage pixel is outside the effective edit region. The
      // result starts as an exact source clone, so leave it untouched rather
      // than normalizing hidden RGB behind alpha zero (or rounding an
      // otherwise unchanged source pixel through the linear-light path).
      if (fillAlpha <= 0) continue;

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
