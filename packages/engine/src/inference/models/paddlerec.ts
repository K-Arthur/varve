/**
 * PaddleOCR v4 text recognition — turns a cropped, deskewed text-line image
 * into a string via a CRNN + CTC pipeline.
 *
 * Model: PP-OCRv4 recognition (Apache-2.0, PaddlePaddle/PaddleOCR, Baidu).
 * ONNX export: deepghs/paddleocr (rec/ch_PP-OCRv4_rec/model.onnx).
 * Verified 2026-07-21 by downloading the real graph:
 *   input:  x [B,3,48,W] float32, H fixed at 48, W dynamic (aspect-preserving).
 *          normalization: (pixel/255 - 0.5) / 0.5  (maps [0,1] -> [-1,1]).
 *   output: softmax_11.tmp_0 [B,T,6625] — per-timestep softmax over
 *          6625 classes = 6624 chars + CTC blank at index 0. T ~ W/4.
 *   opset 10.
 *
 * This adapter handles:
 *   - Height-normalized crop resize (H=48, aspect width).
 *   - NCHW float32 packing at the model's expected normalization.
 *   - CTC best-path decode (argmax, collapse repeats, drop blank=0).
 *   - Character-dictionary lookup with graceful handling of missing dict
 *     (recognition without the matching dictionary silently produces
 *     garbage, so the loader must succeed before we decode).
 *   - Per-character + mean confidence from the softmax probabilities.
 *
 * Recognition is done in isolation per detected text region. The OCR
 * pipeline (ocr/pipeline.ts) feeds each detection here.
 */

import type { TensorSpec } from '../imageTensor';

export const PADDLE_REC_INPUT_HEIGHT = 48;
export const PADDLE_REC_TENSOR_SPEC: TensorSpec = {
  inputWidth: 0,
  inputHeight: PADDLE_REC_INPUT_HEIGHT,
  mean: [0.5, 0.5, 0.5],
  std: [0.5, 0.5, 0.5],
  paddingRgb: [0, 0, 0],
};

/** Number of output classes (6624 chars + CTC blank at index 0). Verified
 *  against the real model graph. */
export const PADDLE_REC_NUM_CLASSES = 6625;
export const PADDLE_REC_CTC_BLANK = 0;

export interface PaddleRecInput {
  /** Cropped (and optionally deskewed) text-line image, any size. */
  imageData: ImageData;
  /** Maximum width to resize to (chars beyond this truncate the line). */
  maxWidth?: number;
}

export interface PaddleRecResult {
  text: string;
  /** Mean per-character confidence in [0, 1]. */
  confidence: number;
  /** Per-character confidence scores. */
  charConfidences: number[];
  /** Sequence length T (timesteps) the model returned. */
  sequenceLength: number;
}

/** Result of preprocessing — packed tensor + the transform applied. */
export interface PaddleRecPreprocessResult {
  tensor: Float32Array;
  width: number;
  height: number;
  /** Ratio of original crop width to model input width (for coord mapping). */
  scaleX: number;
}

export function preprocessPaddleRec(
  imageData: ImageData,
  maxWidth = 320,
): PaddleRecPreprocessResult {
  const aspect = imageData.width / imageData.height;
  let w = Math.round(PADDLE_REC_INPUT_HEIGHT * aspect);
  w = Math.max(4, w); // minimum width
  if (w > maxWidth) w = maxWidth;
  const h = PADDLE_REC_INPUT_HEIGHT;

  // Resize crop to [h, w] preserving aspect ratio. OffscreenCanvas
  // (and its drawImage) is available in browsers and node canvas; jsdom's
  // mock returns a zero-filled bitmap, so tests call packRecTensor directly
  // with a pre-sized ImageData to exercise the pure packing path.
  const resized = new OffscreenCanvas(w, h);
  const ctx = resized.getContext('2d')!;
  ctx.drawImage(resizedCanvas(imageData), 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const tensor = packRecTensor(pixels, w, h);
  return { tensor, width: w, height: h, scaleX: imageData.width / w };
}

/**
 * Pure NCHW packing + normalization of an already height-normalized
 * (H=48) RGBA pixel buffer. Exported so tests can verify the tensor
 * layout and normalization independently of canvas resizing.
 *
 * Layout: R plane (w*h), G plane, B plane. Normalization per-channel:
 * (channel/255 - mean) / std with mean=std=0.5 (maps [0,1] -> [-1,1]).
 */
export function packRecTensor(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const pixelCount = width * height;
  const tensor = new Float32Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    tensor[i] = (pixels[idx]! / 255 - 0.5) / 0.5; // R
    tensor[pixelCount + i] = (pixels[idx + 1]! / 255 - 0.5) / 0.5; // G
    tensor[pixelCount * 2 + i] = (pixels[idx + 2]! / 255 - 0.5) / 0.5; // B
  }
  return tensor;
}

/** OffscreenCanvas from an existing ImageData (helper to avoid reasserting). */
function resizedCanvas(imageData: ImageData): OffscreenCanvas {
  const c = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = c.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);
  return c;
}

/**
 * Decode the recognition output tensor [T, C] into text via CTC best-path,
 * looking up each class index in the character dictionary.
 *
 * @param output  Flat softmax logits, length T * numClasses.
 * @param T       Number of timesteps (sequence length).
 * @param dict    Character dictionary: dict[i] = character for class i+1
 *                (class 0 is the CTC blank, not present in the dict).
 */
export function ctcDecode(
  output: Float32Array,
  T: number,
  dict: readonly string[],
): { text: string; confidence: number; charConfidences: number[] } {
  const charConfidences: number[] = [];
  const indices: number[] = [];

  for (let t = 0; t < T; t++) {
    const offset = t * PADDLE_REC_NUM_CLASSES;
    let maxIdx = 0;
    let maxVal = -Infinity;
    for (let c = 0; c < PADDLE_REC_NUM_CLASSES; c++) {
      const v = output[offset + c] ?? -Infinity;
      if (v > maxVal) {
        maxVal = v;
        maxIdx = c;
      }
    }
    indices.push(maxIdx);
    charConfidences.push(maxVal);
  }

  // CTC collapse: drop blanks (0) and consecutive duplicates.
  let text = '';
  const keptConfidences: number[] = [];
  let prev = -1;
  for (let t = 0; t < T; t++) {
    const idx = indices[t]!;
    if (idx === PADDLE_REC_CTC_BLANK) {
      prev = idx;
      continue;
    }
    if (idx === prev) continue;
    // dict is 0-indexed for class 1..N (class 0 is blank).
    const ch = idx >= 1 && idx - 1 < dict.length ? dict[idx - 1]! : '';
    text += ch;
    keptConfidences.push(charConfidences[t]!);
    prev = idx;
  }

  const confidence =
    keptConfidences.length > 0
      ? keptConfidences.reduce((a, b) => a + b, 0) / keptConfidences.length
      : 0;

  return { text, confidence, charConfidences: keptConfidences };
}

export function validatePaddleRecInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return 'Input must be an object';
  const obj = input as Record<string, unknown>;
  if (!obj.imageData || typeof obj.imageData !== 'object') return 'imageData is required';
  const img = obj.imageData as Record<string, unknown>;
  if (typeof img.width !== 'number' || img.width <= 0) return 'imageData must have a valid width';
  if (typeof img.height !== 'number' || img.height <= 0)
    return 'imageData must have a valid height';
  return null;
}
