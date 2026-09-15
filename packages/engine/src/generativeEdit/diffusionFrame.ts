import { resampleImageData } from '../exportPipeline/resample';

/** SD 1.5 inpainting's reference working frame. */
export const SD15_INPAINTING_FRAME_SIZE = 512;

export interface DiffusionFrame {
  imageData: ImageData;
  mask: Uint8Array;
  width: number;
  height: number;
  contentX: number;
  contentY: number;
  contentWidth: number;
  contentHeight: number;
  /** Map a model frame back to the unscaled context used by the compositor. */
  restore: (imageData: ImageData) => ImageData;
}

function assertDimensions(width: number, height: number, label: string): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`${label} dimensions are invalid`);
  }
}

function resizeMaskBilinear(
  mask: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (mask.length !== sourceWidth * sourceHeight) {
    throw new Error('Diffusion mask dimensions do not match the source context');
  }
  const resized = new Uint8Array(targetWidth * targetHeight);
  const xScale = sourceWidth / targetWidth;
  const yScale = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const top =
        (mask[y0 * sourceWidth + x0] ?? 0) * (1 - xWeight) +
        (mask[y0 * sourceWidth + x1] ?? 0) * xWeight;
      const bottom =
        (mask[y1 * sourceWidth + x0] ?? 0) * (1 - xWeight) +
        (mask[y1 * sourceWidth + x1] ?? 0) * xWeight;
      resized[y * targetWidth + x] = Math.round(top * (1 - yWeight) + bottom * yWeight);
    }
  }
  return resized;
}

function copyIntoLetterbox(
  target: ImageData,
  source: ImageData,
  offsetX: number,
  offsetY: number,
): void {
  for (let y = 0; y < source.height; y += 1) {
    const sourceOffset = y * source.width * 4;
    const targetOffset = ((offsetY + y) * target.width + offsetX) * 4;
    target.data.set(
      source.data.subarray(sourceOffset, sourceOffset + source.width * 4),
      targetOffset,
    );
  }
}

function copyMaskIntoLetterbox(
  target: Uint8Array,
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  offsetX: number,
  offsetY: number,
): void {
  for (let y = 0; y < sourceHeight; y += 1) {
    const targetOffset = (offsetY + y) * SD15_INPAINTING_FRAME_SIZE + offsetX;
    target.set(source.subarray(y * sourceWidth, (y + 1) * sourceWidth), targetOffset);
  }
}

function fillLetterbox(imageData: ImageData): void {
  // Neutral opaque padding is part of the model input only. It is cropped
  // before the result reaches the source compositor, so it cannot alter the
  // document's alpha or introduce hidden RGB behind transparent pixels.
  for (let index = 0; index < imageData.data.length; index += 4) {
    imageData.data[index] = 127;
    imageData.data[index + 1] = 127;
    imageData.data[index + 2] = 127;
    imageData.data[index + 3] = 255;
  }
}

/**
 * Prepare a bounded context for the SD 1.5 inpainting profile.
 *
 * The context is uniformly scaled into a 512px square. The editable mask is
 * transformed by the same mapping, and `restore` crops the letterbox and
 * resamples the generated frame back to the exact context dimensions. This
 * is deliberately a frame transform rather than a stretch into a square.
 */
export function prepareDiffusionFrame(
  source: ImageData,
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
): DiffusionFrame {
  assertDimensions(source.width, source.height, 'Diffusion source');
  assertDimensions(maskWidth, maskHeight, 'Diffusion mask');
  if (mask.length !== maskWidth * maskHeight) {
    throw new Error('Diffusion mask dimensions do not match its pixels');
  }
  if (maskWidth !== source.width || maskHeight !== source.height) {
    throw new Error('Diffusion mask must use source-context dimensions');
  }

  const scale = Math.min(
    SD15_INPAINTING_FRAME_SIZE / source.width,
    SD15_INPAINTING_FRAME_SIZE / source.height,
  );
  const contentWidth = Math.max(1, Math.round(source.width * scale));
  const contentHeight = Math.max(1, Math.round(source.height * scale));
  const contentX = Math.floor((SD15_INPAINTING_FRAME_SIZE - contentWidth) / 2);
  const contentY = Math.floor((SD15_INPAINTING_FRAME_SIZE - contentHeight) / 2);

  const resized =
    contentWidth === source.width && contentHeight === source.height
      ? new ImageData(new Uint8ClampedArray(source.data), source.width, source.height)
      : resampleImageData(source, contentWidth, contentHeight, {
          algorithm: 'bilinear',
          workingSpace: 'linear-srgb',
        }).imageData;
  const resizedMask =
    contentWidth === maskWidth && contentHeight === maskHeight
      ? new Uint8Array(mask)
      : resizeMaskBilinear(mask, maskWidth, maskHeight, contentWidth, contentHeight);

  const modelImage = new ImageData(SD15_INPAINTING_FRAME_SIZE, SD15_INPAINTING_FRAME_SIZE);
  fillLetterbox(modelImage);
  copyIntoLetterbox(modelImage, resized, contentX, contentY);
  const modelMask = new Uint8Array(SD15_INPAINTING_FRAME_SIZE * SD15_INPAINTING_FRAME_SIZE);
  copyMaskIntoLetterbox(modelMask, resizedMask, contentWidth, contentHeight, contentX, contentY);

  return {
    imageData: modelImage,
    mask: modelMask,
    width: SD15_INPAINTING_FRAME_SIZE,
    height: SD15_INPAINTING_FRAME_SIZE,
    contentX,
    contentY,
    contentWidth,
    contentHeight,
    restore(imageData: ImageData): ImageData {
      if (
        imageData.width !== SD15_INPAINTING_FRAME_SIZE ||
        imageData.height !== SD15_INPAINTING_FRAME_SIZE
      ) {
        throw new Error('Diffusion output does not match the model frame');
      }
      const cropped = new ImageData(contentWidth, contentHeight);
      for (let y = 0; y < contentHeight; y += 1) {
        const sourceOffset = ((contentY + y) * imageData.width + contentX) * 4;
        const targetOffset = y * contentWidth * 4;
        cropped.data.set(
          imageData.data.subarray(sourceOffset, sourceOffset + contentWidth * 4),
          targetOffset,
        );
      }
      if (contentWidth === source.width && contentHeight === source.height) {
        return cropped;
      }
      return resampleImageData(cropped, source.width, source.height, {
        algorithm: 'bilinear',
        workingSpace: 'linear-srgb',
      }).imageData;
    },
  };
}
