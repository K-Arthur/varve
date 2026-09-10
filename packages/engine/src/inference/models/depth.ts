/**
 * Depth-Anything-V2 — monocular depth estimation.
 *
 * Model: Depth-Anything-V2-Small (Apache-2.0, ~25MB)
 * Input: 518×518 RGB image (must be multiple of 14)
 * Output: Relative depth map at input resolution
 *
 * Uses DPT (Dense Prediction Transformer) architecture with ViT backbone.
 * Output is relative depth (not metric) — closer objects have lower values.
 */
import type { TensorSpec } from '../imageTensor';

export const DEPTH_ANYTHING_INPUT_SIZE = 518;

export const DEPTH_ANYTHING_TENSOR_SPEC: TensorSpec = {
  inputWidth: DEPTH_ANYTHING_INPUT_SIZE,
  inputHeight: DEPTH_ANYTHING_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

export interface DepthInferenceInput {
  imageData: ImageData;
}

export interface DepthInferenceOutput {
  /** Depth map normalized to 0-255 (0=far, 255=near) */
  depthMap: Uint8Array;
  /** Raw depth values (relative, lower = farther) */
  rawDepth?: Float32Array;
  width: number;
  height: number;
}

/**
 * Post-process depth model output to a normalized depth map.
 * Model outputs a single-channel relative depth map.
 */
export function decodeDepthOutput(
  rawOutput: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
): DepthInferenceOutput {
  // Min-max normalize
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < rawOutput.length; i++) {
    if (rawOutput[i]! < min) min = rawOutput[i]!;
    if (rawOutput[i]! > max) max = rawOutput[i]!;
  }
  const range = max - min || 1;

  // Normalize to 0-255 and resize if needed
  const normalized = new Float32Array(rawOutput.length);
  for (let i = 0; i < rawOutput.length; i++) {
    normalized[i] = (rawOutput[i]! - min) / range;
  }

  // Resize to target if different
  let finalDepth: Float32Array;
  if (outputWidth !== targetWidth || outputHeight !== targetHeight) {
    finalDepth = resizeDepth(normalized, outputWidth, outputHeight, targetWidth, targetHeight);
  } else {
    finalDepth = normalized;
  }

  // Convert to uint8
  const depthMap = new Uint8Array(finalDepth.length);
  for (let i = 0; i < finalDepth.length; i++) {
    depthMap[i] = Math.round(finalDepth[i]! * 255);
  }

  return {
    depthMap,
    rawDepth: finalDepth,
    width: targetWidth,
    height: targetHeight,
  };
}

function resizeDepth(
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
      result[y * dstW + x] = data[srcY * srcW + srcX]!;
    }
  }

  return result;
}

/**
 * Convert a depth map to a mask where pixels within a depth range are selected.
 * Useful for selecting foreground/background based on depth.
 */
export function depthToMask(
  depthMap: Uint8Array,
  nearThreshold: number,
  farThreshold: number,
): Uint8Array {
  const mask = new Uint8Array(depthMap.length);
  for (let i = 0; i < depthMap.length; i++) {
    const depth = depthMap[i]!;
    mask[i] = depth >= nearThreshold && depth <= farThreshold ? 255 : 0;
  }
  return mask;
}
