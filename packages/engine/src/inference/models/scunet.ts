/**
 * SCUNet — real-world image denoising via ONNX.
 *
 * Model: SCUNet (Apache-2.0, ~18MB)
 * Input: 512×512 RGB float32, range [0, 1]
 * Output: Denoised 512×512 RGB float32, range [0, 1]
 *
 * SCUNet uses a CNN+Transformer hybrid architecture that handles
 * real-world noise (not just synthetic Gaussian). It removes JPEG
 * artifacts, sensor noise, and grain while preserving detail.
 *
 * The model operates on RGB only — alpha channel is extracted before
 * inference and re-composited after, so transparency is preserved.
 *
 * Preprocessing resizes any input to 512×512 (the model's fixed input
 * size) using a center-fit resize that preserves aspect ratio, then
 * crops/pads to exactly 512×512. The original dimensions are returned
 * so postprocessing can resize the output back.
 */

import type { TensorSpec } from '../imageTensor';
import { letterboxResize } from '../imageTensor';

export const SCUNET_INPUT_SIZE = 512;

export const SCUNET_TENSOR_SPEC: TensorSpec = {
  inputWidth: SCUNET_INPUT_SIZE,
  inputHeight: SCUNET_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export interface ScunetInferenceInput {
  imageData: ImageData;
  /** Denoise strength 0-1 (0 = no change, 1 = full denoise). Default 1. */
  strength?: number;
}

export interface ScunetInferenceOutput {
  denoised: ImageData;
  width: number;
  height: number;
  processingTimeMs: number;
}

/**
 * Preprocess image data for SCUNet inference.
 *
 * SCUNet expects RGB float32 in [0, 1] range at exactly 512×512.
 * Unlike most models, it does NOT use ImageNet normalization —
 * the input is simply divided by 255.
 *
 * Input images are center-fit resized to 512×512 (preserving aspect
 * ratio, padding with black) so the tensor always matches the model's
 * expected shape regardless of source dimensions.
 *
 * Returns the packed NCHW tensor and the original dimensions
 * needed for postprocessing.
 */
export function preprocessScunet(imageData: ImageData): {
  tensor: Float32Array;
  originalWidth: number;
  originalHeight: number;
  hasAlpha: boolean;
  alphaData: Uint8ClampedArray | null;
} {
  const { width, height, data } = imageData;
  const pixelCount = width * height;

  // Extract alpha channel if present (4th byte per pixel)
  const hasAlpha = data.length === pixelCount * 4;
  let alphaData: Uint8ClampedArray | null = null;
  if (hasAlpha) {
    alphaData = new Uint8ClampedArray(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      alphaData[i] = data[i * 4 + 3]!;
    }
  }

  // Resize to exactly 512×512 with letterbox padding (black)
  const { resized } = letterboxResize(
    imageData,
    SCUNET_INPUT_SIZE,
    SCUNET_INPUT_SIZE,
    SCUNET_TENSOR_SPEC.paddingRgb,
  );

  // Pack RGB into NCHW float32 [0, 1] — no normalization beyond /255
  const resizedPixelCount = SCUNET_INPUT_SIZE * SCUNET_INPUT_SIZE;
  const tensor = new Float32Array(resizedPixelCount * 3);
  for (let i = 0; i < resizedPixelCount; i++) {
    const offset = i * 4;
    tensor[i] = resized.data[offset]! / 255; // R
    tensor[resizedPixelCount + i] = resized.data[offset + 1]! / 255; // G
    tensor[resizedPixelCount * 2 + i] = resized.data[offset + 2]! / 255; // B
  }

  return { tensor, originalWidth: width, originalHeight: height, hasAlpha, alphaData };
}

/**
 * Post-process SCUNet output back to ImageData.
 *
 * Takes the raw model output (NCHW float32 at 512×512), resizes
 * back to original dimensions, and re-composites the alpha channel.
 *
 * @param output - Raw model output tensor data
 * @param outputWidth - Model output width (512)
 * @param outputHeight - Model output height (512)
 * @param targetWidth - Original image width
 * @param targetHeight - Original image height
 * @param alphaData - Original alpha channel (null if no alpha)
 * @param strength - Blending strength 0-1
 * @param originalData - Original pixel data for strength blending
 */
export function postprocessScunet(
  output: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
  alphaData: Uint8ClampedArray | null,
  strength: number,
  originalData: Uint8ClampedArray,
): ImageData {
  const pixelCount = targetWidth * targetHeight;
  const result = new Uint8ClampedArray(pixelCount * 4);

  // Resize from model output to target dimensions using bilinear interpolation
  const xRatio = outputWidth / targetWidth;
  const yRatio = outputHeight / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.min(Math.floor(srcX), outputWidth - 1);
      const y0 = Math.min(Math.floor(srcY), outputHeight - 1);
      const x1 = Math.min(x0 + 1, outputWidth - 1);
      const y1 = Math.min(y0 + 1, outputHeight - 1);
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;

      const chR = 0;
      const chG = outputWidth * outputHeight;
      const chB = outputWidth * outputHeight * 2;

      // Bilinear sample each channel
      const rTop =
        output[y0 * outputWidth + x0 + chR]! * (1 - xWeight) +
        output[y0 * outputWidth + x1 + chR]! * xWeight;
      const rBot =
        output[y1 * outputWidth + x0 + chR]! * (1 - xWeight) +
        output[y1 * outputWidth + x1 + chR]! * xWeight;
      const r = rTop * (1 - yWeight) + rBot * yWeight;

      const gTop =
        output[y0 * outputWidth + x0 + chG]! * (1 - xWeight) +
        output[y0 * outputWidth + x1 + chG]! * xWeight;
      const gBot =
        output[y1 * outputWidth + x0 + chG]! * (1 - xWeight) +
        output[y1 * outputWidth + x1 + chG]! * xWeight;
      const g = gTop * (1 - yWeight) + gBot * yWeight;

      const bTop =
        output[y0 * outputWidth + x0 + chB]! * (1 - xWeight) +
        output[y0 * outputWidth + x1 + chB]! * xWeight;
      const bBot =
        output[y1 * outputWidth + x0 + chB]! * (1 - xWeight) +
        output[y1 * outputWidth + x1 + chB]! * xWeight;
      const b = bTop * (1 - yWeight) + bBot * yWeight;

      // Clamp and convert to uint8
      const denoisedR = Math.round(Math.min(1, Math.max(0, r)) * 255);
      const denoisedG = Math.round(Math.min(1, Math.max(0, g)) * 255);
      const denoisedB = Math.round(Math.min(1, Math.max(0, b)) * 255);

      // Blend with original based on strength
      const dstIdx = (y * targetWidth + x) * 4;
      const srcIdx = (y * targetWidth + x) * 4;
      result[dstIdx] = Math.round(denoisedR * strength + originalData[srcIdx]! * (1 - strength));
      result[dstIdx + 1] = Math.round(
        denoisedG * strength + originalData[srcIdx + 1]! * (1 - strength),
      );
      result[dstIdx + 2] = Math.round(
        denoisedB * strength + originalData[srcIdx + 2]! * (1 - strength),
      );
      result[dstIdx + 3] = alphaData ? alphaData[y * targetWidth + x]! : originalData[srcIdx + 3]!;
    }
  }

  return new ImageData(result, targetWidth, targetHeight);
}

/**
 * Validate SCUNet inference input.
 *
 * Any image with non-zero dimensions is accepted — preprocessing resizes
 * to 512×512. Very large images are downscaled before resize to avoid
 * excessive memory use during the letterbox step.
 */
export function validateScunetInput(input: ScunetInferenceInput): string | null {
  if (!input.imageData) return 'Image data is required';
  if (input.imageData.width === 0 || input.imageData.height === 0)
    return 'Image has zero dimensions';
  if (input.strength !== undefined && (input.strength < 0 || input.strength > 1)) {
    return 'Strength must be between 0 and 1';
  }
  return null;
}
