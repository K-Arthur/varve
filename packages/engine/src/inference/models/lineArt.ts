/**
 * Line art extraction — converts a photo into a clean line drawing,
 * useful as a starting point for Draw mode's vector tracing.
 *
 * Model: informative-drawings (MIT) — "Learning to generate line drawings
 * that convey geometry and semantics" (Chan, Durand, Isola; CVPR 2022).
 * ONNX export: rocca/informative-drawings-line-art-onnx (Hugging Face),
 * a direct rehost of the paper's official model, single model.onnx file
 * (~17.2MB), no separate license stated on the rehost but the upstream
 * carolineec/informative-drawings repo (the actual weights/architecture
 * source) is MIT.
 *
 * Verified from the official inference code (test.py, model.py):
 *   - Input: 256x256 RGB, ToTensor() only (0-1 range, no mean/std subtract)
 *   - Output: single-channel, Sigmoid activation (already 0-1, no rescale)
 */
import type { TensorSpec } from '../imageTensor';

export const LINE_ART_INPUT_SIZE = 256;

export const LINE_ART_TENSOR_SPEC: TensorSpec = {
  inputWidth: LINE_ART_INPUT_SIZE,
  inputHeight: LINE_ART_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [255, 255, 255],
};

/**
 * Decode the model's single-channel [0,1] output (already through Sigmoid,
 * no rescale needed) into a full-resolution grayscale line-art ImageData,
 * resizing with bilinear interpolation from the fixed 256x256 output.
 */
export function decodeLineArtOutput(
  data: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
): ImageData {
  const resized =
    outputWidth === targetWidth && outputHeight === targetHeight
      ? data
      : resizeBilinear(data, outputHeight, outputWidth, targetHeight, targetWidth);

  const result = new ImageData(targetWidth, targetHeight);
  for (let i = 0; i < targetWidth * targetHeight; i++) {
    const v = Math.round(Math.max(0, Math.min(1, resized[i] ?? 1)) * 255);
    result.data[i * 4] = v;
    result.data[i * 4 + 1] = v;
    result.data[i * 4 + 2] = v;
    result.data[i * 4 + 3] = 255;
  }
  return result;
}

function resizeBilinear(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Float32Array {
  const result = new Float32Array(dstH * dstW);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      const x0 = Math.min(Math.floor(srcX), srcW - 1);
      const y0 = Math.min(Math.floor(srcY), srcH - 1);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;

      const top = data[y0 * srcW + x0]! * (1 - xWeight) + data[y0 * srcW + x1]! * xWeight;
      const bot = data[y1 * srcW + x0]! * (1 - xWeight) + data[y1 * srcW + x1]! * xWeight;
      result[y * dstW + x] = top * (1 - yWeight) + bot * yWeight;
    }
  }

  return result;
}
