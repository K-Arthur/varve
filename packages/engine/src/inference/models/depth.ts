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
import type { DepthMap } from '../../depthMap';
import { normalizeDepthPrediction, resizeDepthMap } from '../../depthMap';
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
  /** @deprecated Compatibility bytes only: 0=far, 255=near. */
  depthMap: Uint8Array;
  /** @deprecated Compatibility normalized values, not the storage contract. */
  rawDepth?: Float32Array;
  width: number;
  height: number;
  /** Canonical field for callers migrating away from the byte adapter. */
  canonicalDepth?: DepthMap;
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
  const hasFiniteSample = rawOutput.some((value) => Number.isFinite(value));
  const canonical = normalizeDepthPrediction(rawOutput, outputWidth, outputHeight, {
    // Preserve the historical byte adapter while making the canonical field
    // explicit: raw low values become byte-far, canonical 0 remains near.
    nearFarConvention: 'nearIsHigh',
    lowPercentile: 0,
    highPercentile: 1,
  });
  const aligned =
    outputWidth !== targetWidth || outputHeight !== targetHeight
      ? resizeDepthMap(canonical, targetWidth, targetHeight)
      : canonical;
  const depthMap = new Uint8Array(aligned.values.length);
  const legacyNormalized = new Float32Array(aligned.values.length);
  const degenerate =
    canonical.metadata.normalization?.rangeMin !== undefined &&
    canonical.metadata.normalization.rangeMin === canonical.metadata.normalization.rangeMax;
  for (let i = 0; i < aligned.values.length; i++) {
    // Invalid samples remain zero rather than becoming a plausible mid-plane.
    legacyNormalized[i] = aligned.valid[i] ? (degenerate ? 0 : 1 - aligned.values[i]!) : 0;
    depthMap[i] = hasFiniteSample && aligned.valid[i] ? Math.round(legacyNormalized[i]! * 255) : 0;
  }

  return {
    depthMap,
    rawDepth: legacyNormalized,
    width: targetWidth,
    height: targetHeight,
    canonicalDepth: aligned,
  };
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
