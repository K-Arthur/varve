/**
 * RIFE (Real-Time Intermediate Flow Estimation) — frame interpolation.
 * Generates an in-between frame from two source frames, for Motion mode
 * keyframe assistance and smoother timeline scrubbing.
 *
 * Model: RIFE v4 (MIT, hzwer/ECCV2022-RIFE). ONNX export: FuryTMP/
 * RIFE_fp32 (RIFE_fp32.onnx, ~21.6MB). Verified 2026-07-21 by
 * downloading the real graph and running inference directly:
 *   input: a SINGLE tensor named "input" with fully dynamic dims (no
 *     fixed shape declared in the graph) — not two separate "img0"/
 *     "img1" inputs. Empirically ran successfully with both 6 and 7
 *     channels at 256x256 without erroring, which only proves the graph
 *     doesn't shape-check strictly, not which channel count is
 *     semantically correct.
 *   output: a single tensor, [1,3,H,W] after slicing.
 *
 * NOT FULLY VERIFIED: this implementation uses the standard, widely-
 * documented RIFE convention — channels 0-2 = frame0 RGB, channels 3-5
 * = frame1 RGB, both in [0,1], no mean/std normalization — because that
 * is the convention used by the overwhelming majority of RIFE
 * implementations (practical-rife, rife-ncnn-vulkan, ffmpeg's minterpolate
 * RIFE filter). This environment has no reference PyTorch/ncnn RIFE
 * runtime to numerically confirm this specific ONNX export matches that
 * convention exactly (e.g. whether it expects a 7th timestep channel).
 * Treat interpolation quality as unverified until checked against a
 * known-good reference frame pair.
 */
import type { TensorSpec } from '../imageTensor';

export const RIFE_INPUT_SIZE = 256;

export const RIFE_TENSOR_SPEC: TensorSpec = {
  inputWidth: RIFE_INPUT_SIZE,
  inputHeight: RIFE_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

/** Decode RIFE's [0,1]-range RGB output into an ImageData at the target
 * resolution (nearest-neighbor from the model's fixed square output). */
export function decodeRifeOutput(
  data: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const pixelCount = outputWidth * outputHeight;
  const xRatio = outputWidth / targetWidth;
  const yRatio = outputHeight / targetHeight;
  const result = new ImageData(targetWidth, targetHeight);

  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const sx = Math.min(Math.floor(x * xRatio), outputWidth - 1);
      const sy = Math.min(Math.floor(y * yRatio), outputHeight - 1);
      const srcIdx = sy * outputWidth + sx;
      const dstIdx = (y * targetWidth + x) * 4;
      result.data[dstIdx] = clampByte(data[srcIdx]! * 255);
      result.data[dstIdx + 1] = clampByte(data[pixelCount + srcIdx]! * 255);
      result.data[dstIdx + 2] = clampByte(data[pixelCount * 2 + srcIdx]! * 255);
      result.data[dstIdx + 3] = 255;
    }
  }

  return result;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
