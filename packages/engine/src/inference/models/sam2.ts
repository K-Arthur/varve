/**
 * SAM2 (Segment Anything Model 2) — interactive segmentation via
 * point/box prompts.
 *
 * Model: SAM2-Hiera-Tiny (Apache-2.0, ~39MB)
 * Input: 1024×1024 RGB image + point/box prompts
 * Output: Binary mask at original resolution
 *
 * Architecture: ViT-based image encoder + lightweight mask decoder.
 * The image encoder runs once per image; the decoder runs per-prompt,
 * enabling interactive refinement without re-encoding.
 */
import type { TensorSpec } from '../imageTensor';

export const SAM2_INPUT_SIZE = 1024;

export const SAM2_TENSOR_SPEC: TensorSpec = {
  inputWidth: SAM2_INPUT_SIZE,
  inputHeight: SAM2_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

export interface Sam2Prompt {
  /** Normalized point coordinates [x, y] in 0-1 range */
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  /** Normalized box [x1, y1, x2, y2] in 0-1 range */
  box?: { x1: number; y1: number; x2: number; y2: number };
}

export interface Sam2InferenceInput {
  /** Image data at any resolution (will be letterboxed to 1024×1024) */
  imageData: ImageData;
  /** User prompts */
  prompts: Sam2Prompt;
  /** Optional pre-computed image embedding (skips encoder) */
  imageEmbedding?: Float32Array;
}

export interface Sam2InferenceOutput {
  /** Binary mask at original image resolution (0 or 255) */
  mask: Uint8Array;
  width: number;
  height: number;
  /** Confidence score 0-1 */
  confidence: number;
  /** Low-resolution mask from model (before upscaling) */
  rawMask?: Float32Array;
  rawWidth?: number;
  rawHeight?: number;
}

/**
 * Encode prompts into the tensor format expected by SAM2's decoder.
 * Returns point coordinates, point labels, and box coordinates as
 * separate Float32Arrays for ONNX input feeds.
 */
export function encodeSam2Prompts(
  prompts: Sam2Prompt,
  _imageWidth: number,
  _imageHeight: number,
): {
  pointCoords: Float32Array;
  pointLabels: Float32Array;
  boxCoords: Float32Array;
  hasBox: boolean;
} {
  const points = prompts.points ?? [];
  const nPoints = points.length;

  // SAM2 expects [N, 2] point coords in pixel space (1024×1024)
  const pointCoords = new Float32Array(nPoints * 2);
  const pointLabels = new Float32Array(nPoints);

  for (let i = 0; i < nPoints; i++) {
    const p = points[i]!;
    pointCoords[i * 2] = p.x * SAM2_INPUT_SIZE;
    pointCoords[i * 2 + 1] = p.y * SAM2_INPUT_SIZE;
    pointLabels[i] = p.label;
  }

  // Box prompt: [x1, y1, x2, y2] in 1024×1024 space
  const hasBox = !!prompts.box;
  const boxCoords = new Float32Array(4);
  if (prompts.box) {
    boxCoords[0] = prompts.box.x1 * SAM2_INPUT_SIZE;
    boxCoords[1] = prompts.box.y1 * SAM2_INPUT_SIZE;
    boxCoords[2] = prompts.box.x2 * SAM2_INPUT_SIZE;
    boxCoords[3] = prompts.box.y2 * SAM2_INPUT_SIZE;
  }

  return { pointCoords, pointLabels, boxCoords, hasBox };
}

/**
 * Decode SAM2 mask output to a binary mask at original resolution.
 * SAM2 outputs a low-res mask (256×256 or 64×64 depending on variant)
 * that needs to be upscaled to the original image size.
 */
export function decodeSam2Mask(
  rawOutput: Float32Array,
  rawWidth: number,
  rawHeight: number,
  targetWidth: number,
  targetHeight: number,
  threshold = 0.0,
): { mask: Uint8Array; confidence: number } {
  // Upscale raw mask to target resolution
  const upscaled = resizeMaskSimple(rawOutput, rawWidth, rawHeight, targetWidth, targetHeight);

  // Compute confidence as mean of positive activations
  let sum = 0;
  for (let i = 0; i < upscaled.length; i++) {
    sum += upscaled[i]!;
  }
  const confidence = sum / upscaled.length;

  // Apply threshold
  const mask = new Uint8Array(targetWidth * targetHeight);
  for (let i = 0; i < upscaled.length; i++) {
    mask[i] = upscaled[i]! > threshold ? 255 : 0;
  }

  return { mask, confidence };
}

function resizeMaskSimple(
  data: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const result = new Float32Array(dstW * dstH);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(Math.floor(x * xRatio), srcW - 1);
      const srcY = Math.min(Math.floor(y * yRatio), srcH - 1);
      result[y * dstW + x] = data[srcY * srcW + srcX] ?? 0;
    }
  }

  return result;
}

/**
 * Validate SAM2 prompts before inference.
 */
export function validateSam2Prompts(prompts: Sam2Prompt): string | null {
  if (!prompts.points?.length && !prompts.box) {
    return 'At least one point or box prompt is required';
  }
  if (prompts.points) {
    for (const p of prompts.points) {
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) {
        return 'Point coordinates must be in 0-1 range';
      }
      if (p.label !== 0 && p.label !== 1) {
        return 'Point label must be 0 (background) or 1 (foreground)';
      }
    }
  }
  if (prompts.box) {
    const { x1, y1, x2, y2 } = prompts.box;
    if (x1 < 0 || x1 > 1 || y1 < 0 || y1 > 1 || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) {
      return 'Box coordinates must be in 0-1 range';
    }
    if (x2 <= x1 || y2 <= y1) {
      return 'Box must have positive area';
    }
  }
  return null;
}
