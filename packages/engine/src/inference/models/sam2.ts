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
  /** Low-res mask logits for next iteration */
  lowResMask?: { data: Float32Array; width: number; height: number };
}

/**
 * Encode prompts into the exact tensors the verified decoder graph expects.
 * Box prompts become two extra points (top-left label 2, bottom-right
 * label 3) — there is no separate box_coords input on this graph.
 * mask_input/has_mask_input are always returned (zero-filled when there's
 * no previous mask) because the decoder requires both as inputs.
 */
export function encodeSam2Prompts(prompts: Sam2Prompt): {
  pointCoords: { data: Float32Array; dims: number[] };
  pointLabels: { data: Float32Array; dims: number[] };
  maskInput: { data: Float32Array; dims: number[] };
  hasMaskInput: { data: Float32Array; dims: number[] };
} {
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
    pointCoords[i * 2] = p.x * SAM2_INPUT_SIZE;
    pointCoords[i * 2 + 1] = p.y * SAM2_INPUT_SIZE;
    pointLabels[i] = p.label;
    i++;
  }
  if (prompts.box) {
    pointCoords[i * 2] = prompts.box.x1 * SAM2_INPUT_SIZE;
    pointCoords[i * 2 + 1] = prompts.box.y1 * SAM2_INPUT_SIZE;
    pointLabels[i] = 2; // top-left corner
    i++;
    pointCoords[i * 2] = prompts.box.x2 * SAM2_INPUT_SIZE;
    pointCoords[i * 2 + 1] = prompts.box.y2 * SAM2_INPUT_SIZE;
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
  const numMasks = outputDims.length >= 4 ? Math.min(outputDims[1] ?? 1, 3) : 1;
  const maskH = outputDims.length >= 4 ? outputDims[2]! : 256;
  const maskW = outputDims.length >= 4 ? outputDims[3]! : 256;
  const maskPixels = maskH * maskW;

  const masks: Sam2MaskCandidate[] = [];
  let bestIndex = 0;
  let bestScore = -Infinity;

  for (let m = 0; m < numMasks; m++) {
    const offset = m * maskPixels;
    const rawMask = new Float32Array(maskPixels);
    for (let i = 0; i < maskPixels; i++) {
      rawMask[i] = outputData[offset + i] ?? 0;
    }

    const iou = iouData && m < (iouDims?.[1] ?? 0) ? iouData[m]! : computeIoU(rawMask, maskPixels);
    // resizeMaskBilinear takes (srcH, srcW, dstH, dstW) — passing
    // (targetWidth, targetHeight) here would transpose non-square images.
    const upscaled = resizeMaskBilinear(rawMask, maskH, maskW, targetHeight, targetWidth);

    let binaryMask: Uint8Array;
    if (iouData) {
      binaryMask = upscaled;
    } else {
      binaryMask = new Uint8Array(targetWidth * targetHeight);
      for (let i = 0; i < upscaled.length; i++) {
        binaryMask[i] = upscaled[i]! > 0 ? 255 : 0;
      }
    }

    masks.push({
      mask: binaryMask,
      width: targetWidth,
      height: targetHeight,
      iouScore: iou,
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
    lowResMask: { data: lowResData, width: maskH, height: maskW },
  };
}

function computeIoU(rawMask: Float32Array, pixelCount: number): number {
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    sum += Math.max(0, rawMask[i]!);
  }
  return sum / pixelCount;
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
