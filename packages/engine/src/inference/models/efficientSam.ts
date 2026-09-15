/**
 * EfficientSAM-Ti's split ONNX contract (experimental).
 *
 * Provenance verified 2026-09-14:
 *   Official weights/export: yformer/EfficientSAM (Apache-2.0)
 *   Upstream ONNX host/revision: yunyangx/EfficientSAM @ main
 *   Encoder  efficientsam_ti_encoder.onnx  sha256 84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951
 *   Decoder  efficientsam_ti_decoder.onnx  sha256 a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11
 *
 * The export wraps the official `EfficientSam` module:
 *   - the encoder graph accepts [1,3,H,W] RGB in [0,1], stretches to 1024x1024
 *     (bilinear), and applies ImageNet normalization inside the graph;
 *   - the decoder takes the 256x64x64 embedding, point prompts in the same
 *     pixel space as `orig_im_size`, and outputs three source-sized mask logits
 *     plus raw predicted-IoU logits per candidate.
 *
 * Differences from SAM2/MobileSAM that callers must not paper over:
 *   - the decoder has no mask-input tensor, so EfficientSAM cannot satisfy a
 *     mask prompt or a refinement round-trip;
 *   - `orig_im_size` is int64-only; the ONNX Runtime Web GPU execution
 *     provider cannot host int64 inputs, so this provider is WASM/native only.
 */

import type { TensorSpec } from '../imageTensor';

export const EFFICIENT_SAM_INPUT_SIZE = 1024;
export const EFFICIENT_SAM_MAX_CANDIDATES = 3;
/** Official `decoder_max_num_input_points`; prompts are padded/truncated to it. */
export const EFFICIENT_SAM_MAX_INPUT_POINTS = 6;
export const EFFICIENT_SAM_PREPROCESSING_VERSION = 'efficient-sam-ti-onnx-official-v1';

/**
 * The encoder graph performs normalization internally after stretching to a
 * square, so the provider-owned tensor is raw RGB in [0,1].
 */
export const EFFICIENT_SAM_TENSOR_SPEC: TensorSpec = {
  inputWidth: EFFICIENT_SAM_INPUT_SIZE,
  inputHeight: EFFICIENT_SAM_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export type EfficientSamPoint = { x: number; y: number; label: 0 | 1 };

export type EfficientSamPrompt = {
  /** Normalized source-image coordinates, matching Varve's editor contract. */
  points?: EfficientSamPoint[];
  /** Normalized source-image bounds, matching Varve's editor contract. */
  box?: { x1: number; y1: number; x2: number; y2: number };
};

export type EfficientSamTensor = { data: Float32Array; dims: number[] };

export type EfficientSamPreprocessedImage = {
  /** NCHW RGB values in the graph's expected [0,1] range. */
  tensor: Float32Array;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
};

export type EfficientSamMaskCandidate = {
  mask: Uint8Array;
  width: number;
  height: number;
  /** Raw predicted-IoU logit used for ranking; it is not a probability. */
  score: number;
  scoreSource: 'predicted-iou';
};

export type EfficientSamDecoderOutput = {
  masks: EfficientSamMaskCandidate[];
  selectedIndex: number;
  selectedScore: number;
  scoreSource: 'predicted-iou';
};

export function resizeEfficientSamDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetSize = EFFICIENT_SAM_INPUT_SIZE,
): { width: number; height: number; scaleX: number; scaleY: number } {
  validateDimensions(sourceWidth, sourceHeight);
  if (!Number.isSafeInteger(targetSize) || targetSize <= 0) {
    throw new Error('EfficientSAM target size must be a positive integer');
  }
  const scale = targetSize / Math.max(sourceWidth, sourceHeight);
  const width = Math.max(1, Math.floor(sourceWidth * scale + 0.5));
  const height = Math.max(1, Math.floor(sourceHeight * scale + 0.5));
  return { width, height, scaleX: width / sourceWidth, scaleY: height / sourceHeight };
}

/**
 * Center-aligned bilinear resize to the longest-side-1024 geometry, emitted as
 * NCHW RGB in [0,1]. Keeping this in the provider module means the browser
 * worker and the Node artifact harness share one preprocessing contract.
 */
export function preprocessEfficientSamImageData(
  imageData: { data: ArrayLike<number>; width: number; height: number },
  targetSize = EFFICIENT_SAM_INPUT_SIZE,
): EfficientSamPreprocessedImage {
  validateDimensions(imageData.width, imageData.height);
  const resized = resizeEfficientSamDimensions(imageData.width, imageData.height, targetSize);
  const plane = resized.width * resized.height;
  const tensor = new Float32Array(plane * 3);
  const sample = (x: number, y: number, channel: number): number => {
    const clampedX = Math.max(0, Math.min(imageData.width - 1, x));
    const clampedY = Math.max(0, Math.min(imageData.height - 1, y));
    return (imageData.data[(clampedY * imageData.width + clampedX) * 4 + channel] ?? 0) / 255;
  };
  for (let y = 0; y < resized.height; y += 1) {
    const sourceY = (y + 0.5) * (imageData.height / resized.height) - 0.5;
    const y0 = Math.max(0, Math.min(imageData.height - 1, Math.floor(sourceY)));
    const y1 = Math.max(0, Math.min(imageData.height - 1, y0 + 1));
    const yWeight = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < resized.width; x += 1) {
      const sourceX = (x + 0.5) * (imageData.width / resized.width) - 0.5;
      const x0 = Math.max(0, Math.min(imageData.width - 1, Math.floor(sourceX)));
      const x1 = Math.max(0, Math.min(imageData.width - 1, x0 + 1));
      const xWeight = Math.max(0, Math.min(1, sourceX - x0));
      const index = y * resized.width + x;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = sample(x0, y0, channel) * (1 - xWeight) + sample(x1, y0, channel) * xWeight;
        const bottom = sample(x0, y1, channel) * (1 - xWeight) + sample(x1, y1, channel) * xWeight;
        tensor[channel * plane + index] = top * (1 - yWeight) + bottom * yWeight;
      }
    }
  }
  return {
    tensor,
    width: resized.width,
    height: resized.height,
    scaleX: resized.scaleX,
    scaleY: resized.scaleY,
  };
}

/**
 * Encode prompts for the official split decoder.
 *
 * Coordinates are transformed into the resized pixel space and passed with
 * `orig_im_size = [resizedHeight, resizedWidth]`; the graph rescales them by
 * `1024 / orig_im_size` internally. Box prompts become corner points with
 * labels 2 and 3, matching the official SAM-derived demo. Prompts are padded
 * to the official maximum of six with (-1, -1) coordinates and -1 labels, or
 * truncated beyond it, so behavior matches `predict_masks`.
 */
export function encodeEfficientSamPrompts(
  prompts: EfficientSamPrompt,
  sourceWidth: number,
  sourceHeight: number,
): {
  batched_point_coords: EfficientSamTensor;
  batched_point_labels: EfficientSamTensor;
  orig_im_size: { data: BigInt64Array; dims: number[] };
} {
  validateDimensions(sourceWidth, sourceHeight);
  validateEfficientSamPrompts(prompts);
  const resized = resizeEfficientSamDimensions(sourceWidth, sourceHeight);

  const rawPoints: Array<{ x: number; y: number; label: number }> = [];
  for (const point of prompts.points ?? []) {
    rawPoints.push({
      x: point.x * sourceWidth * resized.scaleX,
      y: point.y * sourceHeight * resized.scaleY,
      label: point.label,
    });
  }
  if (prompts.box) {
    rawPoints.push({
      x: prompts.box.x1 * sourceWidth * resized.scaleX,
      y: prompts.box.y1 * sourceHeight * resized.scaleY,
      label: 2,
    });
    rawPoints.push({
      x: prompts.box.x2 * sourceWidth * resized.scaleX,
      y: prompts.box.y2 * sourceHeight * resized.scaleY,
      label: 3,
    });
  }

  const capped = rawPoints.slice(0, EFFICIENT_SAM_MAX_INPUT_POINTS);
  const pointCoords = new Float32Array(EFFICIENT_SAM_MAX_INPUT_POINTS * 2);
  const pointLabels = new Float32Array(EFFICIENT_SAM_MAX_INPUT_POINTS);
  pointCoords.fill(-1);
  pointLabels.fill(-1);
  capped.forEach((point, index) => {
    pointCoords[index * 2] = point.x;
    pointCoords[index * 2 + 1] = point.y;
    pointLabels[index] = point.label;
  });

  return {
    batched_point_coords: { data: pointCoords, dims: [1, 1, EFFICIENT_SAM_MAX_INPUT_POINTS, 2] },
    batched_point_labels: { data: pointLabels, dims: [1, 1, EFFICIENT_SAM_MAX_INPUT_POINTS] },
    orig_im_size: {
      data: BigInt64Array.from([BigInt(resized.height), BigInt(resized.width)]),
      dims: [2],
    },
  };
}

export function decodeEfficientSamDecoderOutput(
  maskData: Float32Array,
  maskDims: number[],
  scoreData: Float32Array,
  scoreDims: number[],
  targetWidth: number,
  targetHeight: number,
): EfficientSamDecoderOutput {
  validateEfficientSamDecoderOutput(
    maskData,
    maskDims,
    scoreData,
    scoreDims,
    targetWidth,
    targetHeight,
  );
  const candidateCount = maskDims[2]!;
  const maskHeight = maskDims[3]!;
  const maskWidth = maskDims[4]!;
  const maskPixels = maskHeight * maskWidth;
  const candidates: EfficientSamMaskCandidate[] = [];
  let selectedIndex = 0;
  let selectedScore = Number.NEGATIVE_INFINITY;

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const offset = candidateIndex * maskPixels;
    const logits = maskData.subarray(offset, offset + maskPixels);
    // Official EfficientSam.mask_threshold is 0.0: sigmoid(logit) >= 0.5.
    let mask: Uint8Array;
    if (maskWidth === targetWidth && maskHeight === targetHeight) {
      mask = new Uint8Array(maskPixels);
      for (let index = 0; index < maskPixels; index += 1) {
        mask[index] = logits[index]! > 0 ? 255 : 0;
      }
    } else {
      const resized = resizeMaskBilinear(logits, maskHeight, maskWidth, targetHeight, targetWidth);
      mask = new Uint8Array(targetWidth * targetHeight);
      for (let index = 0; index < mask.length; index += 1) {
        mask[index] = resized[index]! > 0 ? 255 : 0;
      }
    }
    const score = scoreData[candidateIndex]!;
    candidates.push({
      mask,
      width: targetWidth,
      height: targetHeight,
      score,
      scoreSource: 'predicted-iou',
    });
    if (score > selectedScore) {
      selectedScore = score;
      selectedIndex = candidateIndex;
    }
  }

  return {
    masks: candidates,
    selectedIndex,
    selectedScore,
    scoreSource: 'predicted-iou',
  };
}

export function validateEfficientSamPrompts(prompts: EfficientSamPrompt): void {
  if (!prompts.points?.length && !prompts.box) {
    throw new Error('At least one point or box prompt is required');
  }
  for (const point of prompts.points ?? []) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1
    ) {
      throw new Error('EfficientSAM point coordinates must be in 0-1 range');
    }
    if (point.label !== 0 && point.label !== 1) {
      throw new Error('EfficientSAM point label must be 0 (background) or 1 (foreground)');
    }
  }
  if (prompts.box) {
    const { x1, y1, x2, y2 } = prompts.box;
    if (
      ![x1, y1, x2, y2].every(Number.isFinite) ||
      x1 < 0 ||
      x1 > 1 ||
      y1 < 0 ||
      y1 > 1 ||
      x2 < 0 ||
      x2 > 1 ||
      y2 < 0 ||
      y2 > 1
    ) {
      throw new Error('EfficientSAM box coordinates must be in 0-1 range');
    }
    if (x2 <= x1 || y2 <= y1) throw new Error('EfficientSAM box must have positive area');
  }
}

/** Shared with the MobileSAM adapter; duplicated here to keep providers self-contained. */
export function resizeMaskBilinear(
  data: Float32Array,
  sourceHeight: number,
  sourceWidth: number,
  targetHeight: number,
  targetWidth: number,
): Float32Array {
  if (
    !Number.isSafeInteger(sourceHeight) ||
    !Number.isSafeInteger(sourceWidth) ||
    sourceHeight <= 0 ||
    sourceWidth <= 0
  ) {
    throw new Error('EfficientSAM mask source dimensions are invalid');
  }
  if (
    !Number.isSafeInteger(targetHeight) ||
    !Number.isSafeInteger(targetWidth) ||
    targetHeight <= 0 ||
    targetWidth <= 0
  ) {
    throw new Error('EfficientSAM mask target dimensions are invalid');
  }
  if (data.length !== sourceWidth * sourceHeight) {
    throw new Error('EfficientSAM mask data length does not match dimensions');
  }
  if (sourceHeight === targetHeight && sourceWidth === targetWidth) return new Float32Array(data);
  const result = new Float32Array(targetWidth * targetHeight);
  const xRatio = sourceWidth / targetWidth;
  const yRatio = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = y * yRatio;
    const y0 = Math.min(Math.floor(sourceY), sourceHeight - 1);
    const y1 = Math.min(y0 + 1, sourceHeight - 1);
    const yWeight = sourceY - y0;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = x * xRatio;
      const x0 = Math.min(Math.floor(sourceX), sourceWidth - 1);
      const x1 = Math.min(x0 + 1, sourceWidth - 1);
      const xWeight = sourceX - x0;
      const top =
        data[y0 * sourceWidth + x0]! * (1 - xWeight) + data[y0 * sourceWidth + x1]! * xWeight;
      const bottom =
        data[y1 * sourceWidth + x0]! * (1 - xWeight) + data[y1 * sourceWidth + x1]! * xWeight;
      result[y * targetWidth + x] = top * (1 - yWeight) + bottom * yWeight;
    }
  }
  return result;
}

function validateEfficientSamDecoderOutput(
  maskData: Float32Array,
  maskDims: number[],
  scoreData: Float32Array,
  scoreDims: number[],
  targetWidth: number,
  targetHeight: number,
): void {
  if (!(maskData instanceof Float32Array) || !(scoreData instanceof Float32Array)) {
    throw new Error('Invalid EfficientSAM decoder output: tensors must be Float32Array');
  }
  if (
    maskDims.length !== 5 ||
    maskDims.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
  ) {
    throw new Error('Invalid EfficientSAM decoder output: masks dimensions');
  }
  const [batch, queries, candidates, height, width] = maskDims as [
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    batch !== 1 ||
    queries !== 1 ||
    candidates < 1 ||
    candidates > EFFICIENT_SAM_MAX_CANDIDATES ||
    width * height > 16_777_216
  ) {
    throw new Error('Invalid EfficientSAM decoder output: unsupported masks shape');
  }
  if (maskData.length !== batch * queries * candidates * height * width) {
    throw new Error('Invalid EfficientSAM decoder output: masks data length');
  }
  if (maskData.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid EfficientSAM decoder output: masks contain a non-finite value');
  }
  if (
    scoreDims.length !== 3 ||
    scoreDims[0] !== 1 ||
    scoreDims[1] !== 1 ||
    scoreDims[2] !== candidates ||
    scoreData.length !== candidates
  ) {
    throw new Error('Invalid EfficientSAM decoder output: predicted-IoU dimensions');
  }
  if (scoreData.some((value) => !Number.isFinite(value))) {
    throw new Error(
      'Invalid EfficientSAM decoder output: predicted-IoU contains a non-finite value',
    );
  }
  validateDimensions(targetWidth, targetHeight);
  if (targetWidth * targetHeight > 16_777_216) {
    throw new Error('Invalid EfficientSAM decoder output: target image is too large');
  }
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('EfficientSAM image dimensions are invalid');
  }
}
