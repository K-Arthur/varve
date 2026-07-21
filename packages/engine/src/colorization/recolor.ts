/**
 * Selective recoloring — applies hue shift, saturation scaling, and
 * luminance preservation within a mask region.
 *
 * Non-AI approach suitable for deterministic design-tool recoloring:
 * converts RGB to HSL, applies hue rotation and saturation scaling
 * within the masked region, converts back. Preserves source luminance
 * in the L* perceptual space when luminancePreservation > 0.
 */

import { labToRgb, rgbToLab } from '../nonSeparable';

export function selectiveRecolor(
  imageData: ImageData,
  maskData: Uint8Array,
  maskWidth: number,
  _maskHeight: number,
  targetHue: number,
  saturationScale: number,
  luminancePreservation: number,
): ImageData {
  const { data, width, height } = imageData;
  const pixelCount = width * height;
  const out = new ImageData(width, height);
  const outData = out.data;
  const lumPres = Math.max(0, Math.min(1, luminancePreservation));
  const hueRad = (targetHue * Math.PI) / 180;

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const mx = i % maskWidth;
    const my = Math.floor(i / maskWidth);
    const maskIdx = my * maskWidth + mx;
    const maskVal = (maskData[maskIdx] ?? 0) / 255;

    outData[idx] = data[idx]!;
    outData[idx + 1] = data[idx + 1]!;
    outData[idx + 2] = data[idx + 2]!;
    outData[idx + 3] = data[idx + 3]!;

    if (maskVal <= 0) continue;

    const r = data[idx]! / 255;
    const g = data[idx + 1]! / 255;
    const b = data[idx + 2]! / 255;

    if (saturationScale !== 1 || targetHue !== 0) {
      const [srcL, srcA, srcB] = rgbToLab(r, g, b);

      const saturation = Math.sqrt(srcA * srcA + srcB * srcB);
      const hue = Math.atan2(srcB, srcA);

      const newHue = hue + hueRad;
      const newSat = saturation * Math.max(0, saturationScale);

      const newA = newSat * Math.cos(newHue);
      const newB = newSat * Math.sin(newHue);

      const finalL = lumPres > 0 ? srcL * lumPres + srcL * (1 - lumPres) : srcL;
      const finalA = srcA * (1 - maskVal) + newA * maskVal;
      const finalB = srcB * (1 - maskVal) + newB * maskVal;

      const [outR, outG, outBval] = labToRgb(finalL, finalA, finalB);
      outData[idx] = Math.round(Math.min(255, Math.max(0, outR * 255)));
      outData[idx + 1] = Math.round(Math.min(255, Math.max(0, outG * 255)));
      outData[idx + 2] = Math.round(Math.min(255, Math.max(0, outBval * 255)));
    }
  }

  return out;
}
