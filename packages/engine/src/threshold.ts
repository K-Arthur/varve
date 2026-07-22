/**
 * Threshold — binary image conversion at a given luminance level.
 *
 * Every pixel with luminance >= threshold becomes white (255,255,255);
 * everything below becomes black (0,0,0).  Alpha is preserved.
 *
 * Research basis: Photoshop Threshold adjustment layer.
 */

export interface ThresholdParams {
  /** Luminance threshold 0-255 (default 128). */
  level: number;
}

function srgbLuminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function applyThreshold(data: ImageData, params: ThresholdParams): void {
  const level = Math.max(0, Math.min(255, Math.round(params.level ?? 128)));
  const pixels = data.data;

  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3]!;
    if (a === 0) continue;

    const lum = srgbLuminance(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!);
    const val = lum >= level - 0.001 ? 255 : 0;
    pixels[i] = val;
    pixels[i + 1] = val;
    pixels[i + 2] = val;
  }
}
