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

import { labToRgb, rgbToLab } from '../nonSeparable';

/**
 * Combine a source's L channel with predicted a*b* to produce a colorized
 * RGB ImageData. All arrays must be the same length in pixels.
 *
 * `predA` and `predB` are in LAB a*b* range (-128 to 127), NOT normalized.
 * Returns a new ImageData with the original alpha preserved.
 */
export function combineLabToImageData(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  predA: Float32Array,
  predB: Float32Array,
  luminancePreservation: number,
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
  if (!Number.isFinite(luminancePreservation)) {
    throw new Error('Luminance preservation must be finite');
  }
  const out = new ImageData(width, height);
  const outData = out.data;
  const lumPres = Math.max(0, Math.min(1, luminancePreservation));

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
    const modelL = srcL;
    const finalL = srcL * lumPres + modelL * (1 - lumPres);

    const a = predA[i] ?? 0;
    const bVal = predB[i] ?? 0;
    if (!Number.isFinite(a) || !Number.isFinite(bVal)) {
      throw new Error('Predicted chroma contains a non-finite value');
    }
    const [outR, outG, outB] = labToRgb(finalL, a, bVal);

    outData[dstIdx] = Number.isFinite(outR) ? outR * 255 : 0;
    outData[dstIdx + 1] = Number.isFinite(outG) ? outG * 255 : 0;
    outData[dstIdx + 2] = Number.isFinite(outB) ? outB * 255 : 0;
    outData[dstIdx + 3] = sourceAlpha;
  }

  return out;
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
