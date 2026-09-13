/**
 * DDColor image colorization model — dual-decoder architecture for
 * photo-realistic automatic colorization.
 *
 * RESEARCH BASIS — verified from primary sources:
 *   Paper: "DDColor: Towards Photo-Realistic Image Colorization via Dual
 *   Decoders" (Kang, Yang, Ouyang, Ren, Li, Xie; ICCV 2023).
 *   https://arxiv.org/abs/2212.11613
 *
 *   Code: https://github.com/piddnad/DDColor — Apache-2.0 license.
 *   Models: https://huggingface.co/piddnad — Apache-2.0 license.
 *
 *   Architecture: ConvNeXt backbone encoder + two decoders
 *   (MultiScaleColorDecoder for spatial refinement, color-token decoder
 *   for semantic color queries). Input: RGB image. Output: a*b* chrominance
 *   channels in CIELAB space. Luminance is preserved from the source.
 *
 *   ONNX export: official `scripts/export_onnx.py` (opset 12), verified
 *   input/output tensor names from the export script:
 *     input  "input"  — float32 [1, 3, H, W], RGB normalized to [0, 1]
 *     output "output" — float32 [1, 2, H, W], a*b* channels
 *
 *   The official exporter can emit dynamic H/W only when invoked with
 *   `--input_size 0`; Varve's approved contracts use fixed 512x512 and
 *   256x256 tensors, matching the model variants we intend to verify.
 *
 *   Training data: ImageNet (ILSVRC 2012) + private artistic images for
 *   the "artistic" variant. No personally-identifiable data.
 *
 * LICENSE: Apache-2.0 (code and model weights). Redistribution permitted
 * with attribution. See https://github.com/piddnad/DDColor/blob/master/LICENSE
 *
 * DDColor variants:
 *   ddcolor-tiny  — DDColor-T (ConvNeXt-tiny), fast preview
 *   ddcolor       — DDColor-L (ConvNeXt-large), default quality
 *                   (same architecture as "ddcolor_modelscope" in paper).
 *   Artifact sizes are release/export dependent and remain unverified here.
 */

import type { TensorSpec } from '../imageTensor';

export const DD_COLOR_INPUT_SIZE = 512;

export const DD_COLOR_TINY_INPUT_SIZE = 256;

export const DD_COLOR_TENSOR_SPEC: TensorSpec = {
  inputWidth: DD_COLOR_INPUT_SIZE,
  inputHeight: DD_COLOR_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [128, 128, 128],
};

export const DD_COLOR_TINY_TENSOR_SPEC: TensorSpec = {
  inputWidth: DD_COLOR_TINY_INPUT_SIZE,
  inputHeight: DD_COLOR_TINY_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [128, 128, 128],
};

export interface DdColorLetterbox {
  offsetX: number;
  offsetY: number;
  /** Rounded raster width/height of the drawn source region. */
  contentWidth?: number;
  contentHeight?: number;
}

/**
 * Decode DDColor's [1, 2, H, W] a*b* output into separate a* and b* plane
 * Float32Arrays, cropped back from letterbox padding to the original
 * aspect-ratio region, then resized to target dimensions.
 *
 * The model outputs raw a*b* values in CIELAB range (approximately -128 to
 * 127). No activation/sigmoid is applied by the model — the ONNX graph
 * produces unbounded float output that maps directly to a*b*.
 */
export function decodeDdColorOutput(
  data: Float32Array,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
  letterbox?: DdColorLetterbox,
): { a: Float32Array<ArrayBuffer>; b: Float32Array<ArrayBuffer> } {
  if (
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    outputWidth <= 0 ||
    outputHeight <= 0
  ) {
    throw new Error('DDColor output dimensions must be positive integers');
  }
  if (
    !Number.isSafeInteger(targetWidth) ||
    !Number.isSafeInteger(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error('DDColor target dimensions must be positive integers');
  }
  const planeSize = outputWidth * outputHeight;
  if (data.length !== planeSize * 2) {
    throw new Error(
      `DDColor output length ${data.length} does not match [2, ${outputHeight}, ${outputWidth}]`,
    );
  }
  for (const value of data) {
    if (!Number.isFinite(value)) throw new Error('DDColor output contains a non-finite value');
  }

  let aPlane: Float32Array<ArrayBuffer> = new Float32Array(planeSize);
  let bPlane: Float32Array<ArrayBuffer> = new Float32Array(planeSize);

  for (let i = 0; i < planeSize; i++) {
    aPlane[i] = data[i] ?? 0;
    bPlane[i] = data[planeSize + i] ?? 0;
  }

  let srcW = outputWidth;
  let srcH = outputHeight;

  if (letterbox) {
    if (!Number.isFinite(letterbox.offsetX) || !Number.isFinite(letterbox.offsetY)) {
      throw new Error('DDColor letterbox offsets must be finite');
    }
    const cropX = Math.round(letterbox.offsetX);
    const cropY = Math.round(letterbox.offsetY);
    const scaledW =
      letterbox.contentWidth !== undefined
        ? Math.round(letterbox.contentWidth)
        : Math.round(outputWidth - 2 * letterbox.offsetX);
    const scaledH =
      letterbox.contentHeight !== undefined
        ? Math.round(letterbox.contentHeight)
        : Math.round(outputHeight - 2 * letterbox.offsetY);
    if (
      !Number.isSafeInteger(scaledW) ||
      !Number.isSafeInteger(scaledH) ||
      scaledW <= 0 ||
      scaledH <= 0 ||
      cropX < 0 ||
      cropY < 0 ||
      cropX + scaledW > outputWidth ||
      cropY + scaledH > outputHeight
    ) {
      throw new Error('DDColor letterbox crop is outside the model output');
    }
    if (scaledW > 0 && scaledH > 0 && (scaledW !== outputWidth || scaledH !== outputHeight)) {
      aPlane = cropRegion(aPlane, outputWidth, cropX, cropY, scaledW, scaledH);
      bPlane = cropRegion(bPlane, outputWidth, cropX, cropY, scaledW, scaledH);
      srcW = scaledW;
      srcH = scaledH;
    }
  }

  if (srcW !== targetWidth || srcH !== targetHeight) {
    aPlane = resizeBilinear(aPlane, srcH, srcW, targetHeight, targetWidth);
    bPlane = resizeBilinear(bPlane, srcH, srcW, targetHeight, targetWidth);
  }

  return { a: aPlane, b: bPlane };
}

function cropRegion(
  data: Float32Array,
  srcW: number,
  cropX: number,
  cropY: number,
  cropW: number,
  cropH: number,
): Float32Array<ArrayBuffer> {
  const result = new Float32Array(cropW * cropH);
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      result[y * cropW + x] = data[(cropY + y) * srcW + (cropX + x)] ?? 0;
    }
  }
  return result;
}

function resizeBilinear(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Float32Array<ArrayBuffer> {
  if (srcW === dstW && srcH === dstH) {
    const copy = new Float32Array(data.length);
    copy.set(data);
    return copy;
  }
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
