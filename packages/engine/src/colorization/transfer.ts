/**
 * Reinhard et al. (2001) color transfer in CIELAB.
 *
 * Reference transfer is statistical: it matches global color distributions,
 * not objects or semantics. Source L* is retained at preservation 1 and the
 * reference L* distribution is blended in as preservation approaches 0.
 * Transparent pixels do not participate in either distribution.
 */

import { labToRgb, rgbToLab } from '../nonSeparable';

export interface LabStats {
  meanL: number;
  meanA: number;
  meanB: number;
  stdL: number;
  stdA: number;
  stdB: number;
  sampleWeight: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finiteParameter(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function byte(value: number): number {
  return Math.round(clamp(finiteOr(value, 0), 0, 255));
}

/** Compute alpha-weighted CIELAB statistics over the supplied pixel count. */
export function computeLabStats(data: Uint8ClampedArray, pixelCount: number): LabStats {
  const count = Math.max(0, Math.min(Math.floor(pixelCount), Math.floor(data.length / 4)));
  let weightSum = 0;
  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  let sumL2 = 0;
  let sumA2 = 0;
  let sumB2 = 0;

  for (let i = 0; i < count; i += 1) {
    const index = i * 4;
    const alpha = (data[index + 3] ?? 0) / 255;
    if (alpha <= 0) continue;
    const [l, a, b] = rgbToLab(
      (data[index] ?? 0) / 255,
      (data[index + 1] ?? 0) / 255,
      (data[index + 2] ?? 0) / 255,
    );
    const safeL = finiteOr(l, 0);
    const safeA = finiteOr(a, 0);
    const safeB = finiteOr(b, 0);
    weightSum += alpha;
    sumL += safeL * alpha;
    sumA += safeA * alpha;
    sumB += safeB * alpha;
    sumL2 += safeL * safeL * alpha;
    sumA2 += safeA * safeA * alpha;
    sumB2 += safeB * safeB * alpha;
  }

  if (weightSum <= 0) {
    return { meanL: 0, meanA: 0, meanB: 0, stdL: 0, stdA: 0, stdB: 0, sampleWeight: 0 };
  }
  const meanL = sumL / weightSum;
  const meanA = sumA / weightSum;
  const meanB = sumB / weightSum;
  return {
    meanL,
    meanA,
    meanB,
    stdL: Math.sqrt(Math.max(0, sumL2 / weightSum - meanL * meanL)),
    stdA: Math.sqrt(Math.max(0, sumA2 / weightSum - meanA * meanA)),
    stdB: Math.sqrt(Math.max(0, sumB2 / weightSum - meanB * meanB)),
    sampleWeight: weightSum,
  };
}

export interface ColorTransferOptions {
  /** Additional final blend applied once after statistical transfer. */
  blendStrength?: number;
  /** Optional coverage mask in mask pixel coordinates. */
  mask?: { data: Uint8Array; width: number; height: number };
}

function sampleCoverage(
  mask: { data: Uint8Array; width: number; height: number } | undefined,
  x: number,
  y: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  if (!mask) return 1;
  const maskX = ((x + 0.5) * mask.width) / sourceWidth - 0.5;
  const maskY = ((y + 0.5) * mask.height) / sourceHeight - 0.5;
  const x0 = clamp(Math.floor(maskX), 0, mask.width - 1);
  const y0 = clamp(Math.floor(maskY), 0, mask.height - 1);
  const x1 = clamp(x0 + 1, 0, mask.width - 1);
  const y1 = clamp(y0 + 1, 0, mask.height - 1);
  const tx = clamp(maskX - Math.floor(maskX), 0, 1);
  const ty = clamp(maskY - Math.floor(maskY), 0, 1);
  const top =
    (mask.data[y0 * mask.width + x0] ?? 0) * (1 - tx) + (mask.data[y0 * mask.width + x1] ?? 0) * tx;
  const bottom =
    (mask.data[y1 * mask.width + x0] ?? 0) * (1 - tx) + (mask.data[y1 * mask.width + x1] ?? 0) * tx;
  return clamp((top * (1 - ty) + bottom * ty) / 255, 0, 1);
}

function validateMask(mask: ColorTransferOptions['mask']): void {
  if (!mask) return;
  if (
    !Number.isSafeInteger(mask.width) ||
    !Number.isSafeInteger(mask.height) ||
    mask.width <= 0 ||
    mask.height <= 0 ||
    mask.data.length < mask.width * mask.height
  ) {
    throw new Error('mask dimensions exceed mask data length');
  }
}

export function colorTransferLab(
  source: ImageData,
  reference: ImageData,
  luminancePreservation: number,
  chromaStrength: number,
  options: ColorTransferOptions = {},
): ImageData {
  const { data: sourceData, width, height } = source;
  const sourceCount = width * height;
  const sourceStats = computeLabStats(sourceData, sourceCount);
  const referenceStats = computeLabStats(reference.data, reference.width * reference.height);
  if (referenceStats.sampleWeight <= 0) {
    throw new Error('reference image has no usable opaque pixels');
  }
  validateMask(options.mask);

  const lumPres = clamp(finiteParameter('luminancePreservation', luminancePreservation), 0, 1);
  const strength = clamp(finiteParameter('chromaStrength', chromaStrength), 0, 2);
  const blend = clamp(finiteParameter('blendStrength', options.blendStrength ?? 1), 0, 1);
  const out = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const sourceR = sourceData[index] ?? 0;
      const sourceG = sourceData[index + 1] ?? 0;
      const sourceB = sourceData[index + 2] ?? 0;
      const alpha = sourceData[index + 3] ?? 255;
      out.data[index + 3] = alpha;
      if (alpha === 0) {
        out.data[index] = sourceR;
        out.data[index + 1] = sourceG;
        out.data[index + 2] = sourceB;
        continue;
      }

      const coverage = sampleCoverage(options.mask, x, y, width, height) * blend;
      if (coverage <= 0) {
        out.data[index] = sourceR;
        out.data[index + 1] = sourceG;
        out.data[index + 2] = sourceB;
        continue;
      }

      const [sourceL, sourceA, sourceBStar] = rgbToLab(sourceR / 255, sourceG / 255, sourceB / 255);
      const transferredL =
        sourceStats.sampleWeight > 0
          ? referenceStats.meanL +
            (sourceL - sourceStats.meanL) * (referenceStats.stdL / Math.max(sourceStats.stdL, 0.01))
          : sourceL;
      const transferredA =
        referenceStats.meanA +
        (sourceA - sourceStats.meanA) * (referenceStats.stdA / Math.max(sourceStats.stdA, 0.01));
      const transferredB =
        referenceStats.meanB +
        (sourceBStar - sourceStats.meanB) *
          (referenceStats.stdB / Math.max(sourceStats.stdB, 0.01));
      const finalL = sourceL * lumPres + transferredL * (1 - lumPres);
      const finalA = sourceA * (1 - strength) + transferredA * strength;
      const finalB = sourceBStar * (1 - strength) + transferredB * strength;
      const [targetR, targetG, targetB] = labToRgb(finalL, finalA, finalB);
      out.data[index] = byte(sourceR * (1 - coverage) + targetR * 255 * coverage);
      out.data[index + 1] = byte(sourceG * (1 - coverage) + targetG * 255 * coverage);
      out.data[index + 2] = byte(sourceB * (1 - coverage) + targetB * 255 * coverage);
    }
  }
  return out;
}
