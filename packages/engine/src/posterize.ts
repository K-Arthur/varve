/**
 * Posterize — reduces the number of tonal levels per channel.
 *
 * Quantises each RGB channel to `levels` discrete steps (2-128).
 * Preserves alpha.
 *
 * Research basis: Photoshop Posterize adjustment.
 */

export interface PosterizeParams {
  levels: number;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function applyPosterize(data: ImageData, params: PosterizeParams): void {
  const levels = Math.max(2, Math.min(256, Math.round(params.levels)));
  const step = 255 / (levels - 1);
  const pixels = data.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a === 0) continue;

    pixels[i] = clamp(Math.round(pixels[i]! / step) * step);
    pixels[i + 1] = clamp(Math.round(pixels[i + 1]! / step) * step);
    pixels[i + 2] = clamp(Math.round(pixels[i + 2]! / step) * step);
  }
}
