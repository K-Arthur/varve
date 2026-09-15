/**
 * Color-space utilities for colorization inference.
 *
 * DDColor (ICCV 2023) and most learned colorizers operate with luminance
 * separation: the model predicts chrominance (a*b*) while preserving the
 * source luminance (L). We reuse the D65-illuminant CIELAB-to-RGB functions
 * from `nonSeparable.ts` which are the standard for deep-learning pipelines.
 *
 * These wrappers iterate ImageData in a single pass for the combine step
 * (L from input + predicted a*b* to RGB), which is the hot path in
 * postprocessing.
 */

import { resizeMaskBilinear } from '../inference/imageTensor';
import { labToRgb, rgbToLab } from '../nonSeparable';
import type { ChromaPlanes } from './colorizationRequest';

/**
 * Combine a source's L channel with predicted a*b* to produce a colorized
 * RGB ImageData. All arrays must be the same length in pixels.
 *
 * `predA` and `predB` are in LAB a*b* range (-128 to 127), NOT normalized.
 * The source L* is always retained: DDColor-class models predict chrominance
 * only, so there is no separate lightness control in this path. Returns a new
 * ImageData with the original alpha preserved.
 */
export function combineLabToImageData(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  predA: Float32Array,
  predB: Float32Array,
): ImageData {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Source dimensions must be positive integers');
  }
  const pixelCount = width * height;
  if (sourceData.length < pixelCount * 4) {
    throw new Error('Source data is shorter than its dimensions');
  }
  if (predA.length < pixelCount || predB.length < pixelCount) {
    throw new Error('Predicted chroma planes are shorter than the source image');
  }
  const out = new ImageData(width, height);
  const outData = out.data;

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const dstIdx = i * 4;
    const sourceAlpha = sourceData[srcIdx + 3] ?? 255;
    if (sourceAlpha === 0) {
      outData[dstIdx] = sourceData[srcIdx] ?? 0;
      outData[dstIdx + 1] = sourceData[srcIdx + 1] ?? 0;
      outData[dstIdx + 2] = sourceData[srcIdx + 2] ?? 0;
      outData[dstIdx + 3] = 0;
      continue;
    }
    const r = (sourceData[srcIdx] ?? 0) / 255;
    const g = (sourceData[srcIdx + 1] ?? 0) / 255;
    const b = (sourceData[srcIdx + 2] ?? 0) / 255;

    const [srcL] = rgbToLab(r, g, b);

    const a = predA[i] ?? 0;
    const bVal = predB[i] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(bVal)) {
      throw new Error('Predicted chroma contains a non-finite value');
    }
    const [outR, outG, outB] = labToRgb(srcL, a, bVal);

    outData[dstIdx] = Number.isFinite(outR) ? outR * 255 : 0;
    outData[dstIdx + 1] = Number.isFinite(outG) ? outG * 255 : 0;
    outData[dstIdx + 2] = Number.isFinite(outB) ? outB * 255 : 0;
    outData[dstIdx + 3] = sourceAlpha;
  }

  return out;
}

/**
 * Reconstruct a full-resolution colorization from a cached chroma prediction.
 *
 * Used by Apply after the user approved a preview: the model's a*b* planes are
 * bilinearly resized to the source dimensions and combined with the *original*
 * source lightness/detail and alpha. This is the same chroma upsampling the inference
 * path performs; it never enlarges a low-resolution RGB result, and it never
 * needs a second model run, so the committed colors are the approved ones.
 */
export function combineChromaAtSourceResolution(
  source: ImageData,
  chroma: ChromaPlanes,
): ImageData {
  const { width, height, data } = source;
  if (
    !Number.isSafeInteger(chroma.width) ||
    !Number.isSafeInteger(chroma.height) ||
    chroma.width <= 0 ||
    chroma.height <= 0
  ) {
    throw new Error('Predicted chroma dimensions must be positive integers');
  }
  const pixelCount = chroma.width * chroma.height;
  if (chroma.a.length < pixelCount || chroma.b.length < pixelCount) {
    throw new Error('Predicted chroma planes are shorter than their dimensions');
  }
  if (chroma.width === width && chroma.height === height) {
    return combineLabToImageData(data, width, height, chroma.a, chroma.b);
  }
  const a = resizeMaskBilinear(chroma.a, chroma.width, chroma.height, width, height);
  const b = resizeMaskBilinear(chroma.b, chroma.width, chroma.height, width, height);
  return combineLabToImageData(data, width, height, a, b);
}

/**
 * Extract the L channel from an RGB ImageData into a Float32Array (0-100).
 * Used for diagnostics and for workflows that analyze source luminance.
 */
export function extractLuminance(sourceData: Uint8ClampedArray, pixelCount: number): Float32Array {
  const lum = new Float32Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const r = sourceData[i * 4]! / 255;
    const g = sourceData[i * 4 + 1]! / 255;
    const b = sourceData[i * 4 + 2]! / 255;
    const [L] = rgbToLab(r, g, b);
    lum[i] = L;
  }
  return lum;
}

export { labToRgb, rgbToLab };
