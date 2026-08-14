/**
 * NAFNet — task-specific image restoration (deblur / denoise / JPEG-aware).
 *
 * Same architecture, different checkpoints, each validated for exactly one
 * task. The runtime contract for every NAFNet checkpoint in Varve:
 *
 *   input:  [1,3,H,W] float32 in [0,1], BGR channel order, H/W divisible by 16
 *   output: [1,3,H,W] float32 in [0,1], BGR channel order
 *
 * Divisibility by 16 follows the official `padder_size` for the width64
 * encoder (4 stride-2 stages); inputs are zero-padded and the output is
 * cropped back, mirroring the reference `check_image_size` behaviour.
 *
 * BGR: the official NAFNet implementation (megvii-research/NAFNet) reads
 * images through OpenCV (BGR) and was trained on BGR tensors. Feeding an
 * RGB tensor unswapped permutes the trained channel mapping, which
 * visibly shifts colours. Varve therefore feeds BGR and swaps the output
 * channels back to RGBA in `postprocessNafnet`, matching the trusted
 * reference output pixel-for-pixel (see tools/nafnet-export parity run).
 */
import type { TensorSpec } from '../imageTensor';

export const NAFNET_INPUT_SIZE = 0;

export const NAFNET_TENSOR_SPEC: TensorSpec = {
  inputWidth: 0,
  inputHeight: 0,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export const NAFNET_PADDING_MULTIPLE = 16;

/** Stable ids for NAFNet checkpoints validated per task. */
export const NAFNET_DEBLUR_GOPRO_ID = 'nafnet-deblur-gopro';
export const NAFNET_DENOISE_SIDD_ID = 'nafnet-denoise-sidd';

export function alignTo16(n: number): number {
  return Math.max(16, Math.ceil(n / NAFNET_PADDING_MULTIPLE) * NAFNET_PADDING_MULTIPLE);
}

export interface NafnetPreprocessResult {
  tensor: Float32Array;
  alignedWidth: number;
  alignedHeight: number;
  originalWidth: number;
  originalHeight: number;
  hasAlpha: boolean;
  alphaData: Uint8ClampedArray | null;
}

/**
 * Pack RGBA source into the model's BGR float tensor, zero-padding to a
 * multiple of 16 (zero pad is what the reference `F.pad` applies).
 */
export function preprocessNafnet(imageData: ImageData): NafnetPreprocessResult {
  const originalWidth = imageData.width;
  const originalHeight = imageData.height;
  const alignedWidth = alignTo16(originalWidth);
  const alignedHeight = alignTo16(originalHeight);
  let hasAlpha = false;
  for (let i = 0; i < originalWidth * originalHeight; i++) {
    if (imageData.data[i * 4 + 3]! < 255) {
      hasAlpha = true;
      break;
    }
  }
  let alphaData: Uint8ClampedArray | null = null;
  if (hasAlpha) {
    alphaData = new Uint8ClampedArray(originalWidth * originalHeight);
    for (let i = 0; i < originalWidth * originalHeight; i++)
      alphaData[i] = imageData.data[i * 4 + 3]!;
  }
  const pixelCount = alignedWidth * alignedHeight;
  const tensor = new Float32Array(pixelCount * 3);
  for (let y = 0; y < alignedHeight; y++) {
    for (let x = 0; x < alignedWidth; x++) {
      const srcX = x < originalWidth ? x : originalWidth - 1;
      const srcY = y < originalHeight ? y : originalHeight - 1;
      const srcIdx = (srcY * originalWidth + srcX) * 4;
      const dstIdx = y * alignedWidth + x;
      // BGR order: channel 0 = source blue, 1 = green, 2 = red.
      tensor[dstIdx] = imageData.data[srcIdx + 2]! / 255;
      tensor[pixelCount + dstIdx] = imageData.data[srcIdx + 1]! / 255;
      tensor[pixelCount * 2 + dstIdx] = imageData.data[srcIdx]! / 255;
    }
  }
  return {
    tensor,
    alignedWidth,
    alignedHeight,
    originalWidth,
    originalHeight,
    hasAlpha,
    alphaData,
  };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * BGR model output back to RGBA (channel swap), cropped from the aligned
 * canvas, blended against the original by `strength`, alpha reattached.
 */
export function postprocessNafnet(
  outputTensor: Float32Array,
  outW: number,
  outH: number,
  targetW: number,
  targetH: number,
  alphaData: Uint8ClampedArray | null,
  strength: number,
  originalData: Uint8ClampedArray,
): ImageData {
  const result = new ImageData(targetW, targetH);
  const outPixels = outW * outH;
  if (outW === targetW && outH === targetH) {
    for (let i = 0; i < targetW * targetH; i++) {
      const dstIdx = i * 4;
      const b = outputTensor[i]!;
      const g = outputTensor[i + outPixels]!;
      const r = outputTensor[i + outPixels * 2]!;
      const origR = originalData[dstIdx]! / 255;
      const origG = originalData[dstIdx + 1]! / 255;
      const origB = originalData[dstIdx + 2]! / 255;
      result.data[dstIdx] = clamp255((origR * (1 - strength) + r * strength) * 255);
      result.data[dstIdx + 1] = clamp255((origG * (1 - strength) + g * strength) * 255);
      result.data[dstIdx + 2] = clamp255((origB * (1 - strength) + b * strength) * 255);
      result.data[dstIdx + 3] = alphaData ? alphaData[i]! : 255;
    }
  } else {
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        const srcX = (x / targetW) * outW;
        const srcY = (y / targetH) * outH;
        const x0 = Math.min(Math.floor(srcX), outW - 1);
        const y0 = Math.min(Math.floor(srcY), outH - 1);
        const x1 = Math.min(x0 + 1, outW - 1);
        const y1 = Math.min(y0 + 1, outH - 1);
        const xW = srcX - x0;
        const yW = srcY - y0;
        const dstIdx = (y * targetW + x) * 4;
        const sample = (channel: number): number => {
          const plane = channel * outPixels;
          const tl = outputTensor[y0 * outW + x0 + plane]!;
          const tr = outputTensor[y0 * outW + x1 + plane]!;
          const bl = outputTensor[y1 * outW + x0 + plane]!;
          const br = outputTensor[y1 * outW + x1 + plane]!;
          return (tl * (1 - xW) + tr * xW) * (1 - yW) + (bl * (1 - xW) + br * xW) * yW;
        };
        // BGR planes -> RGBA channels.
        const r = sample(2);
        const g = sample(1);
        const b = sample(0);
        const origR = originalData[dstIdx]! / 255;
        const origG = originalData[dstIdx + 1]! / 255;
        const origB = originalData[dstIdx + 2]! / 255;
        result.data[dstIdx] = clamp255((origR * (1 - strength) + r * strength) * 255);
        result.data[dstIdx + 1] = clamp255((origG * (1 - strength) + g * strength) * 255);
        result.data[dstIdx + 2] = clamp255((origB * (1 - strength) + b * strength) * 255);
        result.data[dstIdx + 3] = alphaData ? alphaData[y * targetW + x]! : 255;
      }
    }
  }
  return result;
}

export function validateNafnetInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Input must be an object';
  const obj = input as Record<string, unknown>;
  if (!obj.imageData || typeof obj.imageData !== 'object') return 'imageData is required';
  const img = obj.imageData as Record<string, unknown>;
  if (typeof img.width !== 'number' || img.width <= 0) return 'imageData must have a valid width';
  if (typeof img.height !== 'number' || img.height <= 0)
    return 'imageData must have a valid height';
  if (
    obj.strength !== undefined &&
    (typeof obj.strength !== 'number' || obj.strength < 0 || obj.strength > 1)
  ) {
    return 'strength must be a number between 0 and 1';
  }
  return null;
}
