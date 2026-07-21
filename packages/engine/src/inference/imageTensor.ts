/**
 * Shared image→tensor preprocessing utilities for ONNX model inference.
 *
 * Provides letterbox resize, NCHW tensor packing, normalization, and
 * color-space conversion used by all model-specific preprocessors.
 */
export interface TensorSpec {
  inputWidth: number;
  inputHeight: number;
  mean: [number, number, number];
  std: [number, number, number];
  paddingRgb: [number, number, number];
}

export interface LetterboxTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Compute letterbox transform to fit source into target dimensions
 * while preserving aspect ratio.
 */
export function computeLetterboxTransform(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
): LetterboxTransform {
  const scale = Math.min(targetWidth / srcWidth, targetHeight / srcHeight);
  const scaleX = scale;
  const scaleY = scale;
  const offsetX = (targetWidth - srcWidth * scale) / 2;
  const offsetY = (targetHeight - srcHeight * scale) / 2;
  return { scaleX, scaleY, offsetX, offsetY };
}

/**
 * Resize image data to target dimensions using letterbox padding.
 * Returns the resized ImageData and the transform for reverse mapping.
 */
export function letterboxResize(
  imageData: ImageData,
  targetWidth: number,
  targetHeight: number,
  paddingRgb: [number, number, number],
): { resized: ImageData; transform: LetterboxTransform } {
  const transform = computeLetterboxTransform(
    imageData.width,
    imageData.height,
    targetWidth,
    targetHeight,
  );

  const canvas = new OffscreenCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${paddingRgb[0]} ${paddingRgb[1]} ${paddingRgb[2]})`;
  ctx.fillRect(0, 0, targetWidth, targetHeight);

  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);

  const imageBitmap = createImageBitmapFromCanvas(srcCanvas);
  ctx.drawImage(
    imageBitmap,
    transform.offsetX,
    transform.offsetY,
    imageData.width * transform.scaleX,
    imageData.height * transform.scaleY,
  );

  const resized = ctx.getImageData(0, 0, targetWidth, targetHeight);
  return { resized, transform };
}

function createImageBitmapFromCanvas(canvas: OffscreenCanvas): ImageBitmap {
  if (typeof createImageBitmap !== 'undefined') {
    return createImageBitmap(canvas) as unknown as ImageBitmap;
  }
  // Fallback for environments without createImageBitmap
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const tmpCanvas = new OffscreenCanvas(canvas.width, canvas.height);
  const tmpCtx = tmpCanvas.getContext('2d')!;
  tmpCtx.putImageData(data, 0, 0);
  return tmpCanvas as unknown as ImageBitmap;
}

/**
 * Pack RGBA ImageData into NCHW Float32Array with normalization.
 * Output layout: [R plane, G plane, B plane], each plane is H×W.
 */
export function packNchwTensor(imageData: ImageData, spec: TensorSpec): Float32Array {
  const pixelCount = imageData.width * imageData.height;
  const result = new Float32Array(pixelCount * 3);
  const mean = spec.mean;
  const std = spec.std;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = (imageData.data[offset] ?? 0) / 255;
    const g = (imageData.data[offset + 1] ?? 0) / 255;
    const b = (imageData.data[offset + 2] ?? 0) / 255;
    result[i] = (r - mean[0]!) / std[0]!;
    result[pixelCount + i] = (g - mean[1]!) / std[1]!;
    result[pixelCount * 2 + i] = (b - mean[2]!) / std[2]!;
  }

  return result;
}

/**
 * Pack RGB (no alpha) into NCHW Float32Array.
 */
export function packNchwTensorRgb(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  spec: TensorSpec,
): Float32Array {
  const pixelCount = width * height;
  const result = new Float32Array(pixelCount * 3);
  const mean = spec.mean;
  const std = spec.std;

  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 3;
    const r = (data[offset] ?? 0) / 255;
    const g = (data[offset + 1] ?? 0) / 255;
    const b = (data[offset + 2] ?? 0) / 255;
    result[i] = (r - mean[0]!) / std[0]!;
    result[pixelCount + i] = (g - mean[1]!) / std[1]!;
    result[pixelCount * 2 + i] = (b - mean[2]!) / std[2]!;
  }

  return result;
}

/**
 * Resize a single-channel mask using bilinear interpolation.
 */
export function resizeMaskBilinear(
  mask: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  const result = new Float32Array(dstWidth * dstHeight);
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;

      const topLeft = mask[y0 * srcWidth + x0]!;
      const topRight = mask[y0 * srcWidth + x1]!;
      const bottomLeft = mask[y1 * srcWidth + x0]!;
      const bottomRight = mask[y1 * srcWidth + x1]!;

      const top = topLeft * (1 - xWeight) + topRight * xWeight;
      const bottom = bottomLeft * (1 - xWeight) + bottomRight * xWeight;
      result[y * dstWidth + x] = top * (1 - yWeight) + bottom * yWeight;
    }
  }

  return result;
}

/**
 * Apply sigmoid activation to a float array (in-place).
 */
export function applySigmoid(data: Float32Array): void {
  for (let i = 0; i < data.length; i++) {
    data[i] = 1 / (1 + Math.exp(-data[i]!));
  }
}

/**
 * Normalize float array to 0-255 range.
 */
export function normalizeToUint8(data: Float32Array): Uint8Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i]! < min) min = data[i]!;
    if (data[i]! > max) max = data[i]!;
  }
  const range = max - min || 1;
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = Math.round(((data[i]! - min) / range) * 255);
  }
  return result;
}

/**
 * Threshold a float mask to binary (0 or 255).
 */
export function thresholdMask(data: Float32Array, threshold = 0.5): Uint8Array {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i]! >= threshold ? 255 : 0;
  }
  return result;
}

/**
 * Clamp image data to a maximum dimension while preserving aspect ratio.
 */
export function clampImageToMaxDimension(imageData: ImageData, maxDimension: number): ImageData {
  const longest = Math.max(imageData.width, imageData.height);
  if (longest <= maxDimension) return imageData;

  const scale = maxDimension / longest;
  const newWidth = Math.round(imageData.width * scale);
  const newHeight = Math.round(imageData.height * scale);

  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d')!;
  srcCtx.putImageData(imageData, 0, 0);

  const dstCanvas = new OffscreenCanvas(newWidth, newHeight);
  const dstCtx = dstCanvas.getContext('2d')!;
  dstCtx.drawImage(srcCanvas, 0, 0, newWidth, newHeight);

  return dstCtx.getImageData(0, 0, newWidth, newHeight);
}
