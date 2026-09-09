/**
 * SAM2 (Segment Anything Model 2) — interactive segmentation via
 * point/box prompts using a proper encoder/decoder split.
 *
 * Model: SAM2-Hiera-Tiny (Apache-2.0)
 * Source: vietanhdev/segment-anything-2-onnx-models (Hugging Face) —
 *   sam2_hiera_tiny.encoder.onnx (134MB) + sam2_hiera_tiny.decoder.onnx
 *   (20.6MB). Verified 2026-07-21 by downloading both files and inspecting
 *   the ONNX graph directly (opset 17, no custom ops):
 *     encoder: image [1,3,1024,1024] ->
 *       image_embed [1,256,64,64], high_res_feats_0 [1,32,256,256],
 *       high_res_feats_1 [1,64,128,128]
 *     decoder: image_embed, high_res_feats_0, high_res_feats_1,
 *       point_coords [L,N,2], point_labels [L,N], mask_input [L,1,256,256],
 *       has_mask_input [L] -> masks [L,3,H,W], iou_predictions [L,3]
 *   The decoder has NO separate box_coords input — box prompts are encoded
 *   as two extra points (top-left label 2, bottom-right label 3) appended
 *   to point_coords/point_labels, per the standard SAM ONNX export
 *   convention. mask_input/has_mask_input are REQUIRED inputs (the session
 *   throws if omitted) — always fed, zero-filled when there's no prior mask.
 *
 * The image encoder runs once per image and produces three embedding
 * tensors that are cached and reused across prompt updates. The decoder
 * runs per-prompt (using the cached embeddings), enabling interactive
 * refinement without re-encoding.
 *
 * Pipeline:
 *   1. Encoder: 1024x1024 RGB -> image_embed + high_res_feats_0/1
 *   2. Decoder: cached embeddings + point/box prompts -> masks + IoU scores
 */
import type { TensorSpec } from '../imageTensor';

/** Number of point/box labels the decoder expects (single subject per call). */
const NUM_LABELS = 1;
/** Fixed low-res mask spatial size the decoder's mask_input expects. */
const MASK_INPUT_SIZE = 256;

export const SAM2_INPUT_SIZE = 1024;
const MAX_DECODER_MASK_PIXELS = 16_777_216;

export const SAM2_TENSOR_SPEC: TensorSpec = {
  inputWidth: SAM2_INPUT_SIZE,
  inputHeight: SAM2_INPUT_SIZE,
  mean: [0.485, 0.456, 0.406],
  std: [0.229, 0.224, 0.225],
  paddingRgb: [0, 0, 0],
};

export type Sam2MaskCandidate = {
  mask: Uint8Array;
  width: number;
  height: number;
  iouScore: number;
  confidenceSource: 'model-iou' | 'activation-heuristic';
};

export interface Sam2Prompt {
  points?: Array<{ x: number; y: number; label: 0 | 1 }>;
  box?: { x1: number; y1: number; x2: number; y2: number };
  /** Previous low-res mask logits for iterative refinement */
  previousMask?: { data: Float32Array; width: number; height: number };
}

export interface Sam2EncoderInput {
  imageData: ImageData;
}

export interface Sam2EncoderOutput {
  /** Image embedding tensor data */
  embedding: Float32Array;
  embeddingDims: number[];
  imageWidth: number;
  imageHeight: number;
}

export interface Sam2DecoderInput {
  /** Cached image embedding from encoder */
  embedding: Float32Array;
  embeddingDims: number[];
  imageWidth: number;
  imageHeight: number;
  prompts: Sam2Prompt;
  hasEmbedding: true;
}

export interface Sam2DecoderOutput {
  masks: Sam2MaskCandidate[];
  selectedIndex: number;
  confidence: number;
  confidenceSource: 'model-iou' | 'activation-heuristic';
  /** Low-res mask logits for next iteration */
  lowResMask?: { data: Float32Array; width: number; height: number };
}

/**
 * Letterbox transform applied when the source image was resized into the
 * model's fixed square input while preserving aspect ratio (scale to fit,
 * center, pad). Only non-zero for non-square source images — SEE BUG NOTE
 * below for why this must be threaded through to prompt encoding.
 */
export interface Sam2Letterbox {
  offsetX: number;
  offsetY: number;
}

/**
 * Encode prompts into the exact tensors the verified decoder graph expects.
 * Box prompts become two extra points (top-left label 2, bottom-right
 * label 3) — there is no separate box_coords input on this graph.
 * mask_input/has_mask_input are always returned (zero-filled when there's
 * no previous mask) because the decoder requires both as inputs.
 *
 * BUG FIX (found via real-model validation against actual downloaded
 * weights, not unit tests — see docs/testing/sam2-lineart-validation-
 * 2026-07-21.md): point/box coordinates are normalized 0-1 relative to
 * the *original* image, but the encoder's input is letterboxed — scaled
 * to fit within 1024x1024 and centered with padding, not stretched to
 * fill it. For any non-square image (the overwhelming majority of real
 * photos), naively mapping `x_norm * 1024` ignores that letterbox offset
 * and lands the prompt in the wrong place. Confirmed empirically: a
 * 1920x1080 synthetic test with a known subject went from mask-vs-
 * ground-truth IoU 0.002 (naive mapping, while the model *confidently*
 * reported 0.98 IoU for the wrong region — a silent-wrong-answer
 * failure) to IoU 0.97 once the letterbox offset was applied — and
 * produces a correct, clean subject mask on a real complex photo. The
 * `letterbox` parameter must be the transform the *same* image actually
 * went through in the worker's preprocessing (see
 * WorkerInferResult.outputs.letterbox from the encoder call) — passing
 * the wrong offset is worse than passing none.
 */
export function encodeSam2Prompts(
  prompts: Sam2Prompt,
  letterbox?: Sam2Letterbox,
): {
  pointCoords: { data: Float32Array; dims: number[] };
  pointLabels: { data: Float32Array; dims: number[] };
  maskInput: { data: Float32Array; dims: number[] };
  hasMaskInput: { data: Float32Array; dims: number[] };
} {
  const offsetX = letterbox?.offsetX ?? 0;
  const offsetY = letterbox?.offsetY ?? 0;
  // scaledWidth = SAM2_INPUT_SIZE - 2*offsetX (centered padding), so a
  // point normalized 0-1 across the *original* image maps to
  // offset + norm * scaledDimension in 1024-space, without needing the
  // original width/height or scale factor separately.
  const scaledW = SAM2_INPUT_SIZE - 2 * offsetX;
  const scaledH = SAM2_INPUT_SIZE - 2 * offsetY;

  const points = prompts.points ?? [];
  const hasBox = !!prompts.box;
  const nPoints = points.length + (hasBox ? 2 : 0);
  // The decoder requires at least one point; a box-only prompt still
  // produces 2 points (corners), so this is only empty if there are no
  // points and no box at all — callers should validate before encoding.
  const coordCount = Math.max(nPoints, 1);

  const pointCoords = new Float32Array(coordCount * 2);
  const pointLabels = new Float32Array(coordCount);

  let i = 0;
  for (const p of points) {
    pointCoords[i * 2] = offsetX + p.x * scaledW;
    pointCoords[i * 2 + 1] = offsetY + p.y * scaledH;
    pointLabels[i] = p.label;
    i++;
  }
  if (prompts.box) {
    pointCoords[i * 2] = offsetX + prompts.box.x1 * scaledW;
    pointCoords[i * 2 + 1] = offsetY + prompts.box.y1 * scaledH;
    pointLabels[i] = 2; // top-left corner
    i++;
    pointCoords[i * 2] = offsetX + prompts.box.x2 * scaledW;
    pointCoords[i * 2 + 1] = offsetY + prompts.box.y2 * scaledH;
    pointLabels[i] = 3; // bottom-right corner
    i++;
  }
  if (nPoints === 0) {
    // No real prompt — the caller should have rejected this via
    // validateSam2Prompts. Fall back to a single "no-op" background point
    // so the tensor shapes stay valid rather than sending an empty batch.
    pointLabels[0] = -1;
  }

  const maskPixels = MASK_INPUT_SIZE * MASK_INPUT_SIZE;
  let maskInputData: Float32Array;
  let hasMaskInputValue: number;
  if (prompts.previousMask) {
    maskInputData = resizeMaskNearest(
      prompts.previousMask.data,
      prompts.previousMask.height,
      prompts.previousMask.width,
      MASK_INPUT_SIZE,
      MASK_INPUT_SIZE,
    );
    hasMaskInputValue = 1;
  } else {
    maskInputData = new Float32Array(maskPixels);
    hasMaskInputValue = 0;
  }

  return {
    pointCoords: { data: pointCoords, dims: [NUM_LABELS, coordCount, 2] },
    pointLabels: { data: pointLabels, dims: [NUM_LABELS, coordCount] },
    maskInput: { data: maskInputData, dims: [NUM_LABELS, 1, MASK_INPUT_SIZE, MASK_INPUT_SIZE] },
    hasMaskInput: { data: new Float32Array([hasMaskInputValue]), dims: [NUM_LABELS] },
  };
}

function resizeMaskNearest(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Float32Array {
  if (srcH === dstH && srcW === dstW) return data;
  const result = new Float32Array(dstH * dstW);
  const xRatio = srcW / dstW;
  const yRatio = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * xRatio), srcW - 1);
      const sy = Math.min(Math.floor(y * yRatio), srcH - 1);
      result[y * dstW + x] = data[sy * srcW + sx] ?? 0;
    }
  }
  return result;
}

export interface DecodedMaskResult {
  masks: Sam2MaskCandidate[];
  selectedIndex: number;
  confidence: number;
  confidenceSource: 'model-iou' | 'activation-heuristic';
  lowResMask?: { data: Float32Array; width: number; height: number };
}

export function decodeSam2DecoderOutput(
  outputData: Float32Array,
  outputDims: number[],
  iouData: Float32Array | null,
  iouDims: number[] | null,
  targetWidth: number,
  targetHeight: number,
): DecodedMaskResult {
  /**
   * Decoder output layout (SAM2.1):
   *   - masks: [batch, num_masks, maskH, maskW] where maskH=maskW=256
   *   - iou_predictions: [batch, num_masks]
   *
   * If only one output tensor, it is the masks with IoU
   * derived from mean activation per mask.
   */
  validateSam2DecoderOutput(outputData, outputDims, iouData, iouDims, targetWidth, targetHeight);
  const numMasks = outputDims[1]!;
  const maskH = outputDims[2]!;
  const maskW = outputDims[3]!;
  const maskPixels = maskH * maskW;
  const confidenceSource = iouData ? 'model-iou' : 'activation-heuristic';

  const masks: Sam2MaskCandidate[] = [];
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let m = 0; m < numMasks; m++) {
    const offset = m * maskPixels;
    const rawMask = new Float32Array(maskPixels);
    for (let i = 0; i < maskPixels; i++) {
      rawMask[i] = outputData[offset + i] ?? 0;
    }

    const iou = iouData ? iouData[m]! : computeIoU(rawMask, maskPixels);
    // resizeMaskBilinear takes (srcH, srcW, dstH, dstW) — passing
    // (targetWidth, targetHeight) here would transpose non-square images.
    const upscaled = resizeMaskBilinear(rawMask, maskH, maskW, targetHeight, targetWidth);

    const binaryMask = new Uint8Array(targetWidth * targetHeight);
    for (let i = 0; i < upscaled.length; i++) {
      // The decoder emits logits/probabilities while the document mask
      // contract is 0/255 alpha. Keeping the intermediate Uint8 value (often
      // 1 for a positive logit) creates a nearly transparent applied mask.
      binaryMask[i] = upscaled[i]! > 0 ? 255 : 0;
    }

    masks.push({
      mask: binaryMask,
      width: targetWidth,
      height: targetHeight,
      iouScore: iou,
      confidenceSource,
    });

    if (iou > bestScore) {
      bestScore = iou;
      bestIndex = m;
    }
  }

  const confidence = bestScore;

  const bestRawOffset = bestIndex * maskPixels;
  const lowResData = new Float32Array(maskPixels);
  for (let i = 0; i < maskPixels; i++) {
    lowResData[i] = outputData[bestRawOffset + i] ?? 0;
  }

  return {
    masks,
    selectedIndex: bestIndex,
    confidence,
    confidenceSource,
    lowResMask: { data: lowResData, width: maskH, height: maskW },
  };
}

function computeIoU(rawMask: Float32Array, pixelCount: number): number {
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    sum += Math.min(1, Math.max(0, rawMask[i]!));
  }
  return sum / pixelCount;
}

function validateSam2DecoderOutput(
  outputData: Float32Array,
  outputDims: number[],
  iouData: Float32Array | null,
  iouDims: number[] | null,
  targetWidth: number,
  targetHeight: number,
): void {
  if (!(outputData instanceof Float32Array)) {
    throw new Error('Invalid SAM2 decoder output: masks data is not Float32Array');
  }
  if (
    !Array.isArray(outputDims) ||
    outputDims.length !== 4 ||
    outputDims.some((dimension) => !Number.isSafeInteger(dimension) || dimension <= 0)
  ) {
    throw new Error('Invalid SAM2 decoder output: masks dimensions');
  }
  const [batch = 0, numMasks = 0, maskH = 0, maskW = 0] = outputDims;
  if (batch !== 1 || numMasks > 3 || maskH * maskW > MAX_DECODER_MASK_PIXELS) {
    throw new Error('Invalid SAM2 decoder output: unsupported masks shape');
  }
  const maskValueCount = batch * numMasks * maskH * maskW;
  if (outputData.length !== maskValueCount) {
    throw new Error('Invalid SAM2 decoder output: masks data length');
  }
  for (const value of outputData) {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid SAM2 decoder output: masks contain a non-finite value');
    }
  }
  if (
    !Number.isSafeInteger(targetWidth) ||
    !Number.isSafeInteger(targetHeight) ||
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    targetWidth * targetHeight > MAX_DECODER_MASK_PIXELS
  ) {
    throw new Error('Invalid SAM2 decoder output: target dimensions');
  }

  if ((iouData === null) !== (iouDims === null)) {
    throw new Error('Invalid SAM2 decoder output: IoU data and dimensions must be paired');
  }
  if (iouData && iouDims) {
    if (
      iouDims.length !== 2 ||
      iouDims[0] !== 1 ||
      iouDims[1] !== numMasks ||
      iouData.length !== numMasks
    ) {
      throw new Error('Invalid SAM2 decoder output: IoU dimensions');
    }
    for (const score of iouData) {
      if (!Number.isFinite(score) || score < 0 || score > 1) {
        throw new Error('Invalid SAM2 decoder output: IoU score');
      }
    }
  }
}

export function resizeMaskBilinear(
  data: Float32Array,
  srcH: number,
  srcW: number,
  dstH: number,
  dstW: number,
): Uint8Array {
  const result = new Uint8Array(dstH * dstW);
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
      const val = top * (1 - yWeight) + bot * yWeight;

      result[y * dstW + x] = val > 0 ? Math.min(255, Math.round(val * 255)) : 0;
    }
  }

  return result;
}

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
