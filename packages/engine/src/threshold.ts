/**
 * Threshold — deterministic binary tonal adjustment.
 *
 * The persisted `level` remains a 0–255 value for compatibility with the
 * existing document format. The input is straight-alpha, sRGB-encoded RGBA;
 * the default tonal source is Rec. 709 relative luminance in that documented
 * encoded space. Alpha and hidden RGB are preserved.
 */

export const THRESHOLD_ALGORITHM_VERSION = 1 as const;

export type ThresholdLuminanceMode = 'relative-luminance' | 'average-rgb' | 'max-channel';

export interface ThresholdParams {
  /** Luminance threshold 0-255 (default 128). Fractional levels are allowed. */
  level: number;
  luminanceMode?: ThresholdLuminanceMode;
  algorithmVersion?: typeof THRESHOLD_ALGORITHM_VERSION;
}

export function normalizeThresholdParams(
  value: Partial<ThresholdParams> | undefined,
): ThresholdParams {
  const rawLevel = value?.level;
  return {
    level: Number.isFinite(rawLevel) ? Math.max(0, Math.min(255, rawLevel!)) : 128,
    luminanceMode:
      value?.luminanceMode === 'average-rgb' || value?.luminanceMode === 'max-channel'
        ? value.luminanceMode
        : 'relative-luminance',
    algorithmVersion: THRESHOLD_ALGORITHM_VERSION,
  };
}

/** Compute the documented tonal coordinate for one byte pixel. */
export function thresholdLuminance(
  r: number,
  g: number,
  b: number,
  mode: ThresholdLuminanceMode = 'relative-luminance',
): number {
  switch (mode) {
    case 'average-rgb':
      return (r + g + b) / 3;
    case 'max-channel':
      return Math.max(r, g, b);
    case 'relative-luminance':
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
}

function passesThreshold(luminance: number, level: number): boolean {
  // Rec. 709's decimal weights can represent pure white as the last bit
  // below 255, so retain the documented inclusive endpoint for byte colors.
  return luminance >= level - 1e-6;
}

/** Evaluate one straight-alpha sRGB byte pixel without mutating the input. */
export function applyThresholdPixel(
  pixel: readonly [number, number, number, number],
  input: Partial<ThresholdParams> | ThresholdParams,
): [number, number, number, number] {
  if (pixel[3] === 0) return [pixel[0], pixel[1], pixel[2], pixel[3]];
  const params = normalizeThresholdParams(input);
  const luminance = thresholdLuminance(pixel[0], pixel[1], pixel[2], params.luminanceMode);
  const value = passesThreshold(luminance, params.level) ? 255 : 0;
  return [value, value, value, pixel[3]];
}

/** Apply Threshold in place. The returned reference is the input buffer. */
export function applyThreshold(
  data: ImageData,
  input: Partial<ThresholdParams> | ThresholdParams,
): ImageData {
  const params = normalizeThresholdParams(input);
  const pixels = data.data;

  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const luminance = thresholdLuminance(
      pixels[i]!,
      pixels[i + 1]!,
      pixels[i + 2]!,
      params.luminanceMode,
    );
    const value = passesThreshold(luminance, params.level) ? 255 : 0;
    pixels[i] = value;
    pixels[i + 1] = value;
    pixels[i + 2] = value;
  }
  return data;
}
