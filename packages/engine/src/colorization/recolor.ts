/**
 * Deterministic selective recoloring in CIELAB L*C*h*.
 *
 * The operation is intentionally source based: it never processes a prior
 * generated result, keeps alpha untouched, and applies mask coverage and
 * blend strength exactly once at the final composite. `hueMode: 'set'` is an
 * absolute target hue; `hueMode: 'rotate'` retains the source hue relationship.
 */

import { labToRgb, rgbToLab } from '../nonSeparable';

export type RecolorHueMode = 'set' | 'rotate';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteParameter(name: string, value: number): number {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  return value;
}

function sampleMask(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
): number {
  // Pixel-centre mapping makes a one-pixel mask cover the whole source and
  // keeps masks authored at another resolution aligned without assuming that
  // either dimension matches the image.
  const maskX = ((sourceX + 0.5) * maskWidth) / sourceWidth - 0.5;
  const maskY = ((sourceY + 0.5) * maskHeight) / sourceHeight - 0.5;
  const x0 = clamp(Math.floor(maskX), 0, maskWidth - 1);
  const y0 = clamp(Math.floor(maskY), 0, maskHeight - 1);
  const x1 = clamp(x0 + 1, 0, maskWidth - 1);
  const y1 = clamp(y0 + 1, 0, maskHeight - 1);
  const tx = clamp(maskX - Math.floor(maskX), 0, 1);
  const ty = clamp(maskY - Math.floor(maskY), 0, 1);
  const top = (mask[y0 * maskWidth + x0] ?? 0) * (1 - tx) + (mask[y0 * maskWidth + x1] ?? 0) * tx;
  const bottom =
    (mask[y1 * maskWidth + x0] ?? 0) * (1 - tx) + (mask[y1 * maskWidth + x1] ?? 0) * tx;
  return (top * (1 - ty) + bottom * ty) / 255;
}

function outputByte(value: number): number {
  return Math.round(clamp(Number.isFinite(value) ? value : 0, 0, 255));
}

/**
 * Recolor pixels covered by a mask.
 *
 * `saturationScale` scales existing chroma. For a neutral pixel, a measured
 * 32 L*a*b* chroma seed is used so tinting can introduce color instead of
 * multiplying zero into zero. `chromaStrength` then scales that target chroma.
 * With luminance preservation at 1, source L* is retained; at 0, the target
 * uses the neutral mid-tone L*=50. This is a deliberate tonal mapping, not an
 * unlabelled mix of HSL lightness and linear luminance.
 */
export function selectiveRecolor(
  imageData: ImageData,
  maskData: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  targetHue: number,
  saturationScale: number,
  luminancePreservation: number,
  blendStrength = 1,
  hueMode: RecolorHueMode = 'set',
  chromaStrength = 1,
  neutralProtection = false,
  skinProtection = false,
): ImageData {
  const { width, height, data } = imageData;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Source dimensions must be positive integers');
  }
  if (
    !Number.isSafeInteger(maskWidth) ||
    !Number.isSafeInteger(maskHeight) ||
    maskWidth <= 0 ||
    maskHeight <= 0
  ) {
    throw new Error('Mask dimensions must be positive integers');
  }
  if (maskData.length < maskWidth * maskHeight) {
    throw new Error('mask dimensions exceed mask data length');
  }
  if (data.length < pixelCount * 4) throw new Error('Source data is shorter than its dimensions');
  if (hueMode !== 'set' && hueMode !== 'rotate') throw new Error('Unsupported hue mode');

  const hue = finiteParameter('targetHue', targetHue);
  const saturation = Math.max(0, finiteParameter('saturationScale', saturationScale));
  const luminance = clamp(finiteParameter('luminancePreservation', luminancePreservation), 0, 1);
  const blend = clamp(finiteParameter('blendStrength', blendStrength), 0, 1);
  const chroma = clamp(finiteParameter('chromaStrength', chromaStrength), 0, 2);
  const output = new ImageData(width, height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const sourceR = data[index] ?? 0;
      const sourceG = data[index + 1] ?? 0;
      const sourceB = data[index + 2] ?? 0;
      const alpha = data[index + 3] ?? 255;
      output.data[index + 3] = alpha;

      if (alpha === 0 || blend === 0) {
        output.data[index] = sourceR;
        output.data[index + 1] = sourceG;
        output.data[index + 2] = sourceB;
        continue;
      }

      const coverage = sampleMask(maskData, maskWidth, maskHeight, x, y, width, height) * blend;
      if (coverage <= 0) {
        output.data[index] = sourceR;
        output.data[index + 1] = sourceG;
        output.data[index + 2] = sourceB;
        continue;
      }

      const [sourceL, sourceA, sourceBStar] = rgbToLab(sourceR / 255, sourceG / 255, sourceB / 255);
      const sourceChroma = Math.hypot(sourceA, sourceBStar);
      const sourceHue = ((Math.atan2(sourceBStar, sourceA) * 180) / Math.PI + 360) % 360;
      const targetHueDegrees = hueMode === 'rotate' && sourceChroma > 0.5 ? sourceHue + hue : hue;
      const targetChroma = clamp(Math.max(sourceChroma, 32) * saturation * chroma, 0, 120);
      const targetL = sourceL * luminance + 50 * (1 - luminance);
      const targetRad = (targetHueDegrees * Math.PI) / 180;
      let targetA = targetChroma * Math.cos(targetRad);
      let targetBValue = targetChroma * Math.sin(targetRad);

      // Protection is deliberately conservative and local. Pure grayscale is
      // not protected: that is the primary tint/colorize use case. Near-neutral
      // authored chroma and skin-like pixels are only softened when the user
      // explicitly enables the corresponding heuristic.
      let protection = 1;
      if (neutralProtection && sourceChroma > 0.01 && sourceChroma < 8) protection *= 0.15;
      if (skinProtection && sourceA > 5 && sourceBStar > 5 && sourceBStar > sourceA * 0.35) {
        protection *= 0.35;
      }
      targetA = sourceA + (targetA - sourceA) * protection;
      targetBValue = sourceBStar + (targetBValue - sourceBStar) * protection;

      const [targetR, targetG, targetB] = labToRgb(targetL, targetA, targetBValue);
      output.data[index] = outputByte(sourceR * (1 - coverage) + targetR * 255 * coverage);
      output.data[index + 1] = outputByte(sourceG * (1 - coverage) + targetG * 255 * coverage);
      output.data[index + 2] = outputByte(sourceB * (1 - coverage) + targetB * 255 * coverage);
    }
  }

  return output;
}
