/**
 * Color harmonization — adjusts source image to match reference color
 * statistics (mean and variance in LAB) with neutral-region protection.
 *
 * Based on the same Reinhard (2001) LAB statistics matching used for
 * color transfer, but with:
 *   - Weaker strength (default 0.5) for subtle adjustment
 *   - Neutral protection: pixels near L*=50, a*=0, b*=0 are adjusted less
 *   - Skin protection: a* > 5 region adjustment is reduced
 */

import { labToRgb, rgbToLab } from '../nonSeparable';

export function harmonize(
  source: ImageData,
  reference: ImageData,
  strength: number,
  neutralProtection: boolean,
): ImageData {
  const { data: srcData, width, height } = source;
  const { data: refData } = reference;
  const pixelCount = width * height;
  const out = new ImageData(width, height);
  const outData = out.data;

  let refSumA = 0;
  let refSumB = 0;
  let refSumA2 = 0;
  let refSumB2 = 0;
  let srcSumA = 0;
  let srcSumB = 0;
  const refCount = Math.min(pixelCount, Math.floor(refData.length / 4));
  for (let i = 0; i < refCount; i++) {
    const idx = i * 4;
    const r = refData[idx]! / 255;
    const g = refData[idx + 1]! / 255;
    const b = refData[idx + 2]! / 255;
    const [, a, bb] = rgbToLab(r, g, b);
    refSumA += a;
    refSumB += bb;
    refSumA2 += a * a;
    refSumB2 += bb * bb;
  }
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = srcData[idx]! / 255;
    const g = srcData[idx + 1]! / 255;
    const b = srcData[idx + 2]! / 255;
    const [, a, bb] = rgbToLab(r, g, b);
    srcSumA += a;
    srcSumB += bb;
  }

  const refMeanA = refSumA / refCount;
  const refMeanB = refSumB / refCount;
  const refStdA = Math.sqrt(Math.max(0, refSumA2 / refCount - refMeanA * refMeanA));
  const refStdB = Math.sqrt(Math.max(0, refSumB2 / refCount - refMeanB * refMeanB));
  const srcMeanA = srcSumA / pixelCount;
  const srcMeanB = srcSumB / pixelCount;

  const s = Math.max(0, Math.min(1, strength));

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const r = srcData[idx]! / 255;
    const g = srcData[idx + 1]! / 255;
    const b = srcData[idx + 2]! / 255;

    const [srcL, srcA, srcB] = rgbToLab(r, g, b);

    let weight = s;
    if (neutralProtection) {
      const neutralDist = Math.sqrt(srcA * srcA + srcB * srcB);
      const neutralWeight = Math.min(1, neutralDist / 15);
      const skinWeight = srcA > 5 ? 0.5 : 1;
      weight = s * Math.max(0.1, neutralWeight * skinWeight);
    }

    const targetA = refMeanA + (srcA - srcMeanA) * (refStdA / Math.max(refStdA, 0.01));
    const targetB = refMeanB + (srcB - srcMeanB) * (refStdB / Math.max(refStdB, 0.01));

    const finalA = srcA * (1 - weight) + targetA * weight;
    const finalB = srcB * (1 - weight) + targetB * weight;

    const [outR, outG, outBval] = labToRgb(srcL, finalA, finalB);
    outData[idx] = Math.round(Math.min(255, Math.max(0, outR * 255)));
    outData[idx + 1] = Math.round(Math.min(255, Math.max(0, outG * 255)));
    outData[idx + 2] = Math.round(Math.min(255, Math.max(0, outBval * 255)));
    outData[idx + 3] = srcData[idx + 3]!;
  }

  return out;
}
