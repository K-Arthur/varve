/**
 * MobileSAM's split ONNX contract.
 *
 * This module deliberately owns the MobileSAM-specific geometry and output
 * semantics. The Acly/MobileSAM graphs are not SAM2 graphs with smaller
 * weights: the encoder accepts a resized HWC RGB image and performs its own
 * normalization/padding, while the decoder consumes the source image size
 * and returns four source-sized mask logits.
 *
 * Artifact verified 2026-09-14:
 *   Acly/MobileSAM @ 0d3b403339b4674a82493d5e97964dd78089ddc8
 *   MIT model card; encoder + multi/single decoder, opset 17.
 */

import type { TensorSpec } from '../imageTensor';

export const MOBILE_SAM_INPUT_SIZE = 1024;
export const MOBILE_SAM_MASK_INPUT_SIZE = 256;
export const MOBILE_SAM_MAX_CANDIDATES = 4;
export const MOBILE_SAM_PREPROCESSING_VERSION = 'mobilesam-acly-v1';

/** The encoder graph's input is raw RGB HWC; graph nodes normalize and pad. */
export const MOBILE_SAM_TENSOR_SPEC: TensorSpec = {
  inputWidth: MOBILE_SAM_INPUT_SIZE,
  inputHeight: MOBILE_SAM_INPUT_SIZE,
  mean: [0, 0, 0],
  std: [1, 1, 1],
  paddingRgb: [0, 0, 0],
};

export type MobileSamPoint = { x: number; y: number; label: 0 | 1 };

export type MobileSamPrompt = {
  /** Normalized source-image coordinates, matching Varve's editor contract. */
  points?: MobileSamPoint[];
  /** Normalized source-image bounds, matching Varve's editor contract. */
  box?: { x1: number; y1: number; x2: number; y2: number };
  /** Previous decoder logits, normally the selected low-resolution output. */
  previousMask?: { data: Float32Array; width: number; height: number };
};

export type MobileSamTensor = {
  data: Float32Array;
  dims: number[];
};

/** All prompt tensors emitted for the fixed MobileSAM decoder graph. */
export type MobileSamPromptInputs = Record<string, MobileSamTensor> & {
  point_coords: MobileSamTensor;
  point_labels: MobileSamTensor;
  mask_input: MobileSamTensor;
  has_mask_input: MobileSamTensor;
  orig_im_size: MobileSamTensor;
};

export type MobileSamScoreSource = 'predicted-iou';

export type MobileSamMaskCandidate = {
  mask: Uint8Array;
  width: number;
  height: number;
  /** Raw model score used for ranking; it is not a probability. */
  score: number;
  scoreSource: MobileSamScoreSource;
  lowResMask?: { data: Float32Array; width: number; height: number };
};

export type MobileSamDecoderOutput = {
  masks: MobileSamMaskCandidate[];
  selectedIndex: number;
  selectedScore: number;
  scoreSource: MobileSamScoreSource;
};

export type MobileSamPreprocessedImage = {
  /** Raw RGB HWC values in the graph's expected [0, 255] range. */
  tensor: Float32Array;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  contentWidth: number;
  contentHeight: number;
};

export function resizeLongestSideDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetSize = MOBILE_SAM_INPUT_SIZE,
): { width: number; height: number; scaleX: number; scaleY: number } {
  validateDimensions(sourceWidth, sourceHeight);
  if (!Number.isSafeInteger(targetSize) || targetSize <= 0) {
    throw new Error('MobileSAM target size must be a positive integer');
  }
  const scale = targetSize / Math.max(sourceWidth, sourceHeight);
  // This matches SAM's ResizeLongestSide.get_preprocess_shape, which rounds
  // each dimension with floor(value + 0.5), then maps coordinates using the
  // resulting integer dimensions rather than the unrounded scale.
  const width = Math.max(1, Math.floor(sourceWidth * scale + 0.5));
  const height = Math.max(1, Math.floor(sourceHeight * scale + 0.5));
  return {
    width,
    height,
    scaleX: width / sourceWidth,
    scaleY: height / sourceHeight,
  };
}

/**
 * Resize decoded RGBA source pixels using the provider's longest-side
 * geometry. The ONNX graph performs normalization and padding, so this
 * function intentionally emits raw RGB HWC values and ignores alpha.
 *
 * Keeping this in the provider module makes the browser worker and the gated
 * Node real-artifact harness use the same preprocessing contract.
 */
export function preprocessMobileSamImageData(
  imageData: { data: ArrayLike<number>; width: number; height: number },
  targetSize = MOBILE_SAM_INPUT_SIZE,
): MobileSamPreprocessedImage {
  validateDimensions(imageData.width, imageData.height);
  const resized = resizeLongestSideDimensions(imageData.width, imageData.height, targetSize);
  const tensor = new Float32Array(resized.width * resized.height * 3);
  const sample = (x: number, y: number, channel: number): number => {
    const clampedX = Math.max(0, Math.min(imageData.width - 1, x));
    const clampedY = Math.max(0, Math.min(imageData.height - 1, y));
    return imageData.data[(clampedY * imageData.width + clampedX) * 4 + channel] ?? 0;
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
      const outputOffset = (y * resized.width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = sample(x0, y0, channel) * (1 - xWeight) + sample(x1, y0, channel) * xWeight;
        const bottom = sample(x0, y1, channel) * (1 - xWeight) + sample(x1, y1, channel) * xWeight;
        tensor[outputOffset + channel] = top * (1 - yWeight) + bottom * yWeight;
      }
    }
  }
  return {
    tensor,
    width: resized.width,
    height: resized.height,
    offsetX: 0,
    offsetY: 0,
    contentWidth: resized.width,
    contentHeight: resized.height,
  };
}

/**
 * Encode normalized source prompts for the official MobileSAM decoder.
 *
 * The decoder has no box input. A box is represented by its two corners with
 * labels 2/3, as in the SAM ONNX export. `orig_im_size` is `[height,width]`.
 * The graph adds the half-pixel offset required by the reference predictor;
 * this adapter therefore passes transformed pixel coordinates without adding
 * that offset a second time.
 */
export function encodeMobileSamPrompts(
  prompts: MobileSamPrompt,
  sourceWidth: number,
  sourceHeight: number,
): MobileSamPromptInputs {
  validateDimensions(sourceWidth, sourceHeight);
  validateMobileSamPrompts(prompts);
  const resized = resizeLongestSideDimensions(sourceWidth, sourceHeight);
  const points = prompts.points ?? [];
  const pointCount = points.length + (prompts.box ? 2 : 0);
  const count = Math.max(1, pointCount);
  const pointCoords = new Float32Array(count * 2);
  const pointLabels = new Float32Array(count);

  let index = 0;
  for (const point of points) {
    pointCoords[index * 2] = point.x * sourceWidth * resized.scaleX;
    pointCoords[index * 2 + 1] = point.y * sourceHeight * resized.scaleY;
    pointLabels[index] = point.label;
    index += 1;
  }
  if (prompts.box) {
    pointCoords[index * 2] = prompts.box.x1 * sourceWidth * resized.scaleX;
    pointCoords[index * 2 + 1] = prompts.box.y1 * sourceHeight * resized.scaleY;
    pointLabels[index] = 2;
    index += 1;
    pointCoords[index * 2] = prompts.box.x2 * sourceWidth * resized.scaleX;
    pointCoords[index * 2 + 1] = prompts.box.y2 * sourceHeight * resized.scaleY;
    pointLabels[index] = 3;
    index += 1;
  }
  if (pointCount === 0) pointLabels[0] = -1;

  const maskInput = prompts.previousMask
    ? resizeMaskBilinear(
        prompts.previousMask.data,
        prompts.previousMask.height,
        prompts.previousMask.width,
        MOBILE_SAM_MASK_INPUT_SIZE,
        MOBILE_SAM_MASK_INPUT_SIZE,
      )
    : new Float32Array(MOBILE_SAM_MASK_INPUT_SIZE * MOBILE_SAM_MASK_INPUT_SIZE);

  return {
    point_coords: { data: pointCoords, dims: [1, count, 2] },
    point_labels: { data: pointLabels, dims: [1, count] },
    mask_input: {
      data: maskInput,
      dims: [1, 1, MOBILE_SAM_MASK_INPUT_SIZE, MOBILE_SAM_MASK_INPUT_SIZE],
    },
    has_mask_input: {
      data: new Float32Array([prompts.previousMask ? 1 : 0]),
      dims: [1],
    },
    orig_im_size: {
      data: new Float32Array([sourceHeight, sourceWidth]),
      dims: [2],
    },
  };
}

export function decodeMobileSamDecoderOutput(
  maskData: Float32Array,
  maskDims: number[],
  scoreData: Float32Array,
  scoreDims: number[],
  targetWidth: number,
  targetHeight: number,
  lowResMaskData?: Float32Array,
  lowResMaskDims?: number[],
): MobileSamDecoderOutput {
  validateMobileSamDecoderOutput(
    maskData,
    maskDims,
    scoreData,
    scoreDims,
    targetWidth,
    targetHeight,
    lowResMaskData,
    lowResMaskDims,
  );
  const candidateCount = maskDims[1]!;
  const maskHeight = maskDims[2]!;
  const maskWidth = maskDims[3]!;
  const maskPixels = maskHeight * maskWidth;
  const candidates: MobileSamMaskCandidate[] = [];
  let selectedIndex = 0;
  let selectedScore = -Infinity;

  for (let candidateIndex = 0; candidateIndex < candidateCount; candidateIndex += 1) {
    const offset = candidateIndex * maskPixels;
    const logits = maskData.subarray(offset, offset + maskPixels);
    const mask = new Uint8Array(targetWidth * targetHeight);
    if (maskWidth === targetWidth && maskHeight === targetHeight) {
      for (let index = 0; index < mask.length; index += 1) {
        mask[index] = logits[index]! > 0 ? 255 : 0;
      }
    } else {
      const resized = resizeMaskBilinear(logits, maskHeight, maskWidth, targetHeight, targetWidth);
      for (let index = 0; index < mask.length; index += 1) {
        mask[index] = resized[index]! > 0 ? 255 : 0;
      }
    }
    const score = scoreData[candidateIndex]!;
    const lowResMask =
      lowResMaskData && lowResMaskDims
        ? lowResCandidate(lowResMaskData, lowResMaskDims, candidateIndex)
        : undefined;
    candidates.push({
      mask,
      width: targetWidth,
      height: targetHeight,
      score,
      scoreSource: 'predicted-iou',
      lowResMask,
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

export function validateMobileSamPrompts(prompts: MobileSamPrompt): void {
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
      throw new Error('Point coordinates must be in 0-1 range');
    }
    if (point.label !== 0 && point.label !== 1) {
      throw new Error('Point label must be 0 (background) or 1 (foreground)');
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
      throw new Error('Box coordinates must be in 0-1 range');
    }
    if (x2 <= x1 || y2 <= y1) throw new Error('Box must have positive area');
  }
}

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
    throw new Error('MobileSAM mask source dimensions are invalid');
  }
  if (
    !Number.isSafeInteger(targetHeight) ||
    !Number.isSafeInteger(targetWidth) ||
    targetHeight <= 0 ||
    targetWidth <= 0
  ) {
    throw new Error('MobileSAM mask target dimensions are invalid');
  }
  if (data.length !== sourceWidth * sourceHeight) {
    throw new Error('MobileSAM mask data length does not match dimensions');
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

function lowResCandidate(
  data: Float32Array,
  dims: number[],
  candidateIndex: number,
): { data: Float32Array; width: number; height: number } {
  const height = dims[2]!;
  const width = dims[3]!;
  const pixels = height * width;
  const offset = candidateIndex * pixels;
  return {
    data: new Float32Array(data.subarray(offset, offset + pixels)),
    width,
    height,
  };
}

function validateMobileSamDecoderOutput(
  maskData: Float32Array,
  maskDims: number[],
  scoreData: Float32Array,
  scoreDims: number[],
  targetWidth: number,
  targetHeight: number,
  lowResMaskData?: Float32Array,
  lowResMaskDims?: number[],
): void {
  if (!(maskData instanceof Float32Array) || !(scoreData instanceof Float32Array)) {
    throw new Error('Invalid MobileSAM decoder output: tensors must be Float32Array');
  }
  if (
    maskDims.length !== 4 ||
    maskDims.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
  ) {
    throw new Error('Invalid MobileSAM decoder output: masks dimensions');
  }
  const batch = maskDims[0]!;
  const candidates = maskDims[1]!;
  const height = maskDims[2]!;
  const width = maskDims[3]!;
  if (
    batch !== 1 ||
    candidates < 1 ||
    candidates > MOBILE_SAM_MAX_CANDIDATES ||
    width * height > 16_777_216
  ) {
    throw new Error('Invalid MobileSAM decoder output: unsupported masks shape');
  }
  if (maskData.length !== batch * candidates * height * width) {
    throw new Error('Invalid MobileSAM decoder output: masks data length');
  }
  if (maskData.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid MobileSAM decoder output: masks contain a non-finite value');
  }
  if (
    scoreDims.length !== 2 ||
    scoreDims[0] !== 1 ||
    scoreDims[1] !== candidates ||
    scoreData.length !== candidates
  ) {
    throw new Error('Invalid MobileSAM decoder output: predicted-IoU dimensions');
  }
  if (scoreData.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid MobileSAM decoder output: predicted-IoU contains a non-finite value');
  }
  validateDimensions(targetWidth, targetHeight);
  if (targetWidth * targetHeight > 16_777_216) {
    throw new Error('Invalid MobileSAM decoder output: target image is too large');
  }
  if (lowResMaskData || lowResMaskDims) {
    if (
      !(lowResMaskData instanceof Float32Array) ||
      !lowResMaskDims ||
      lowResMaskDims.length !== 4
    ) {
      throw new Error(
        'Invalid MobileSAM decoder output: low-resolution mask tensors must be paired',
      );
    }
    const lowBatch = lowResMaskDims[0]!;
    const lowCandidates = lowResMaskDims[1]!;
    const lowHeight = lowResMaskDims[2]!;
    const lowWidth = lowResMaskDims[3]!;
    if (
      lowBatch !== 1 ||
      lowCandidates !== candidates ||
      lowHeight <= 0 ||
      lowWidth <= 0 ||
      lowHeight * lowWidth > 1_048_576 ||
      lowResMaskData.length !== lowCandidates * lowHeight * lowWidth
    ) {
      throw new Error('Invalid MobileSAM decoder output: low-resolution mask dimensions');
    }
    if (lowResMaskData.some((value) => !Number.isFinite(value))) {
      throw new Error(
        'Invalid MobileSAM decoder output: low-resolution masks contain a non-finite value',
      );
    }
  }
}

function validateDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('MobileSAM image dimensions are invalid');
  }
}
