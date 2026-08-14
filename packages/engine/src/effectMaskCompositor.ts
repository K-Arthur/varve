import type { EffectMaskBindingIR } from './types';

export interface PixelImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function coverageAt(mask: PixelImageData, offset: number, binding: EffectMaskBindingIR): number {
  const alpha = mask.data[offset + 3]! / 255;
  if (binding.type === 'luminance') {
    const r = srgbToLinear(mask.data[offset]! / 255);
    const g = srgbToLinear(mask.data[offset + 1]! / 255);
    const b = srgbToLinear(mask.data[offset + 2]! / 255);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) * alpha;
  }
  return alpha;
}

/**
 * Cross-fade one evaluated effect stage with its input using premultiplied
 * alpha semantics. This is the canonical `I * (1-M) + E * M` operation and is
 * deliberately independent of how a backend obtains the mask pixels.
 */
export function compositeMaskedEffectPixels(
  input: PixelImageData,
  evaluated: PixelImageData,
  mask: PixelImageData,
  binding: EffectMaskBindingIR,
): PixelImageData {
  const width = Math.min(input.width, evaluated.width, mask.width);
  const height = Math.min(input.height, evaluated.height, mask.height);
  const out = new Uint8ClampedArray(width * height * 4);
  const density = Math.max(0, Math.min(1, binding.density ?? 1));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const maskOffset = (y * mask.width + x) * 4;
      let coverage = coverageAt(mask, maskOffset, binding) * density;
      if (binding.inverted) coverage = 1 - coverage;
      coverage = Math.max(0, Math.min(1, coverage));

      const inputAlpha = input.data[offset + 3]! / 255;
      const evaluatedAlpha = evaluated.data[offset + 3]! / 255;
      const outputAlpha = inputAlpha * (1 - coverage) + evaluatedAlpha * coverage;
      out[offset + 3] = Math.round(outputAlpha * 255);
      for (let channel = 0; channel < 3; channel++) {
        const inputPremul = (input.data[offset + channel]! / 255) * inputAlpha;
        const evaluatedPremul = (evaluated.data[offset + channel]! / 255) * evaluatedAlpha;
        const outputPremul = inputPremul * (1 - coverage) + evaluatedPremul * coverage;
        out[offset + channel] =
          outputAlpha > 0 ? Math.round((outputPremul / outputAlpha) * 255) : 0;
      }
    }
  }
  return { data: out, width, height };
}
