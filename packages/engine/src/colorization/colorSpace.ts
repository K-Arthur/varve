/**
 * Color-space utilities for colorization inference.
 *
 * DDColor (ICCV 2023) and most learned colorizers operate with luminance
 * separation: the model predicts chrominance (a*b*) while preserving the
 * source luminance (L). We reuse the D65-illuminant CIELAB↔RGB functions
 * from `nonSeparable.ts` which are the standard for deep-learning pipelines.
 *
 * These wrappers iterate ImageData in a single pass for the combine step
 * (L from input + predicted a*b* → RGB), which is the hot path in
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
  const pixelCount = width * height;
  const out = new ImageData(width, height);
  const outData = out.data;
  const lumPres = Math.max(0, Math.min(1, luminancePreservation));

  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const r = sourceData[srcIdx]! / 255;
    const g = sourceData[srcIdx + 1]! / 255;
    const b = sourceData[srcIdx + 2]! / 255;

    const [srcL] = rgbToLab(r, g, b);
    const modelL = srcL;
    const finalL = srcL * lumPres + modelL * (1 - lumPres);

    const a = predA[i] ?? 0;
    const bVal = predB[i] ?? 0;
    const [outR, outG, outB] = labToRgb(finalL, a, bVal);

    const dstIdx = i * 4;
    outData[dstIdx] = outR * 255;
    outData[dstIdx + 1] = outG * 255;
    outData[dstIdx + 2] = outB * 255;
    outData[dstIdx + 3] = sourceData[srcIdx + 3] ?? 255;
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
