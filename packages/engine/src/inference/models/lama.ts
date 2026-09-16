/**
 * LaMa (Large Mask inpainting) — content-aware fill. Replaces the
 * region under a user-drawn mask with plausible generated content,
 * offered as an "AI Fill" mode alongside the existing heuristic
 * spot-heal/patch tools rather than replacing them outright (the
 * heuristic remains a valid fast/offline-cheap fallback).
 *
 * Model: big-lama (Apache-2.0, saic-mdal/lama, Samsung AI). ONNX export:
 * Carve/LaMa-ONNX (lama_fp32.onnx). Verified 2026-07-21 by downloading
 * the real graph and inspecting it directly:
 *   inputs: image [B,3,512,512] float32 (0-1 range, no mean/std
 *     subtraction), mask [B,1,512,512] float32 (1 = inpaint this pixel,
 *     0 = keep) — TWO separate named inputs, not a stacked 4-channel
 *     tensor as some secondhand descriptions of this model claim.
 *   output: a single tensor already scaled to 0-255 (the ONNX export
 *     bakes in the *255 the PyTorch version leaves to the caller) —
 *     dims [B,3,H,W] where H/W match the input (512x512 unless the
 *     graph's dynamic dims resolve otherwise; treat as 512x512 here).
 * Opset 17, no custom ops. ~208MB — large; offered as an optional
 * download, not bundled.
 */
import type { TensorSpec } from '../imageTensor';

export const LAMA_INPUT_SIZE = 512;

export const LAMA_TENSOR_SPEC: TensorSpec = {
  inputWidth: LAMA_INPUT_SIZE,
  inputHeight: LAMA_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export interface LamaLetterbox {
  offsetX: number;
  offsetY: number;
  /** Exact rasterized content extent reported by the worker. */
  contentWidth?: number;
  contentHeight?: number;
}

/**
 * Decode LaMa's already-0-255-scaled output into an ImageData, resizing
 * from the model's fixed 512x512 back to the target resolution. Like
 * line-art, the model's square output may contain letterbox padding for
 * non-square sources — pass `letterbox` (from
 * WorkerInferResult.outputs.letterbox) to crop it out before resizing.
 */
export function decodeLamaOutput(
  data: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
  letterbox?: LamaLetterbox,
): ImageData {
  if (
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    outputWidth <= 0 ||
    outputHeight <= 0 ||
    !Number.isSafeInteger(targetWidth) ||
    !Number.isSafeInteger(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error('LaMa output and target dimensions must be positive integers');
  }
  const pixelCount = outputWidth * outputHeight;
  if (data.length !== pixelCount * 3) {
    throw new Error(
      `LaMa output length ${data.length} does not match [3, ${outputHeight}, ${outputWidth}]`,
    );
  }
  let srcW = outputWidth;
  let srcH = outputHeight;
  let cropX = 0;
  let cropY = 0;

  if (letterbox) {
    if (!Number.isFinite(letterbox.offsetX) || !Number.isFinite(letterbox.offsetY)) {
      throw new Error('LaMa letterbox offsets must be finite');
    }
    cropX = Math.round(letterbox.offsetX);
    cropY = Math.round(letterbox.offsetY);
    srcW =
      letterbox.contentWidth !== undefined
        ? Math.round(letterbox.contentWidth)
        : Math.round(outputWidth - 2 * letterbox.offsetX);
    srcH =
      letterbox.contentHeight !== undefined
        ? Math.round(letterbox.contentHeight)
        : Math.round(outputHeight - 2 * letterbox.offsetY);
    if (
      !Number.isSafeInteger(cropX) ||
      !Number.isSafeInteger(cropY) ||
      !Number.isSafeInteger(srcW) ||
      !Number.isSafeInteger(srcH) ||
      cropX < 0 ||
      cropY < 0 ||
      srcW <= 0 ||
      srcH <= 0 ||
      cropX + srcW > outputWidth ||
      cropY + srcH > outputHeight
    ) {
      throw new Error('LaMa letterbox crop is outside the model output');
    }
  }

  const xRatio = srcW / targetWidth;
  const yRatio = srcH / targetHeight;
  const result = new ImageData(targetWidth, targetHeight);
  const maxSrcX = srcW - 1;
  const maxSrcY = srcH - 1;

  // Bilinear, not nearest-neighbor: LaMa's fixed 512x512 frame is enlarged
  // to the caller's target resolution, and that enlargement factor can be
  // large for Expand (a wide output frame letterboxed down to 512 before
  // inference, then back up). Nearest-neighbor visibly blocks/pixelates the
  // generated border at those factors — see
  // docs/audits/lama-decode-interpolation-2026-09-16.md for the real-photo
  // evidence. Fill/Remove's typically-small enlargement made this
  // invisible there, which is why it went unnoticed until Expand was
  // exercised against the real model.
  for (let y = 0; y < targetHeight; y++) {
    const fy = Math.min(Math.max((y + 0.5) * yRatio - 0.5, 0), maxSrcY);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, maxSrcY);
    const wy = fy - y0;
    for (let x = 0; x < targetWidth; x++) {
      const fx = Math.min(Math.max((x + 0.5) * xRatio - 0.5, 0), maxSrcX);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, maxSrcX);
      const wx = fx - x0;

      const i00 = (cropY + y0) * outputWidth + (cropX + x0);
      const i10 = (cropY + y0) * outputWidth + (cropX + x1);
      const i01 = (cropY + y1) * outputWidth + (cropX + x0);
      const i11 = (cropY + y1) * outputWidth + (cropX + x1);
      const dstIdx = (y * targetWidth + x) * 4;

      for (let channel = 0; channel < 3; channel++) {
        const plane = pixelCount * channel;
        const top = data[plane + i00]! * (1 - wx) + data[plane + i10]! * wx;
        const bottom = data[plane + i01]! * (1 - wx) + data[plane + i11]! * wx;
        result.data[dstIdx + channel] = clampByte(top * (1 - wy) + bottom * wy);
      }
      result.data[dstIdx + 3] = 255;
    }
  }

  return result;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}
