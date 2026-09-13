/**
 * Statistical foreground/background harmonization in CIELAB.
 *
 * This is deliberately a global color-distribution operation. It does not
 * claim semantic correspondence between objects in the source and reference.
 * L* and alpha stay source-owned; only chroma statistics are moved.
 */

import { labToRgb, rgbToLab } from '../nonSeparable';
import { computeLabStats } from './transfer';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function byte(value: number): number {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 255));
}

function finiteParameter(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

export function harmonize(
  source: ImageData,
  reference: ImageData,
  strength: number,
  neutralProtection: boolean,
  blendStrength = 1,
  skinProtection = false,
): ImageData {
  const { data: sourceData, width, height } = source;
  const sourceStats = computeLabStats(sourceData, width * height);
  const referenceStats = computeLabStats(reference.data, reference.width * reference.height);
  if (referenceStats.sampleWeight <= 0) {
    throw new Error('reference image has no usable opaque pixels');
  }

  const amount = clamp(finiteParameter('strength', strength), 0, 1);
  const blend = clamp(finiteParameter('blendStrength', blendStrength), 0, 1);
  const out = new ImageData(width, height);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
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

    const [sourceL, sourceA, sourceBStar] = rgbToLab(sourceR / 255, sourceG / 255, sourceB / 255);
    const sourceChroma = Math.hypot(sourceA, sourceBStar);
    let protection = 1;
    if (neutralProtection && sourceChroma < 8) protection = 0;
    if (skinProtection && sourceA > 5 && sourceBStar > 5 && sourceBStar > sourceA * 0.35) {
      protection *= 0.35;
    }
    const pixelAmount = amount * blend * protection;
    const targetA =
      referenceStats.meanA +
      (sourceA - sourceStats.meanA) * (referenceStats.stdA / Math.max(sourceStats.stdA, 0.01));
    const targetBStar =
      referenceStats.meanB +
      (sourceBStar - sourceStats.meanB) * (referenceStats.stdB / Math.max(sourceStats.stdB, 0.01));
    const finalA = sourceA * (1 - pixelAmount) + targetA * pixelAmount;
    const finalB = sourceBStar * (1 - pixelAmount) + targetBStar * pixelAmount;
    const [targetR, targetG, targetB] = labToRgb(sourceL, finalA, finalB);
    out.data[index] = byte(sourceR * (1 - pixelAmount) + targetR * 255 * pixelAmount);
    out.data[index + 1] = byte(sourceG * (1 - pixelAmount) + targetG * 255 * pixelAmount);
    out.data[index + 2] = byte(sourceB * (1 - pixelAmount) + targetB * 255 * pixelAmount);
  }

  return out;
}
