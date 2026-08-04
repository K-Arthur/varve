/**
 * Adaptive Contrast engine — sampled backdrop averaging, WCAG contrast
 * resolution, and hysteresis-based flicker prevention.
 *
 * Research basis: WCAG 2.1 §1.4.3 (Contrast Minimum), §1.4.6 (Contrast Enhanced),
 * OKLab perceptual uniform color space (Ottosson 2020).
 *
 * This module operates on raw color tuples and does not depend on
 * @varve/scene types — the editor-level integration provides the bridge.
 */

import { autoFixContrast, contrastRatio, relativeLuminance } from '@varve/shared';

export const DEFAULT_HYSTERESIS = 0.5;
export const MIN_CUSTOM_RATIO = 4.5;
export const MAX_CUSTOM_RATIO = 21;

/** The WCAG policy target for adaptive contrast. */
export type AdaptiveContrastPolicy = 'wcag-aa' | 'wcag-aaa' | 'custom';

export interface AdaptiveContrastConfig {
  enabled: boolean;
  /** Light candidate color as [r,g,b,a] 0-255 */
  lightColor?: [number, number, number, number];
  /** Dark candidate color as [r,g,b,a] 0-255 */
  darkColor?: [number, number, number, number];
  policy: AdaptiveContrastPolicy;
  /** Custom target ratio when policy is 'custom' (4.5 - 21) */
  customRatio?: number;
  /** Hysteresis threshold to prevent flickering (default 0.5) */
  hysteresis?: number;
}

export interface AdaptiveContrastResult {
  /** Resolved color as [r,g,b,a] in 0-255 range */
  resolved: [number, number, number, number];
  /** Achieved WCAG contrast ratio */
  ratio: number;
  /** The target ratio being aimed for */
  targetRatio: number;
  /** Whether the resolved color meets the contrast target */
  meetsTarget: boolean;
  /** Perceptual colour difference (ΔEOK) from original, 0 when no candidate used */
  deltaEOK: number;
}

/**
 * Compute target WCAG contrast ratio from policy.
 */
export function getTargetRatio(
  policy: AdaptiveContrastPolicy,
  customRatio: number | undefined,
  isLarge: boolean,
): number {
  if (policy === 'wcag-aaa') {
    return isLarge ? 4.5 : 7.0;
  }
  if (policy === 'custom') {
    return Math.max(MIN_CUSTOM_RATIO, Math.min(MAX_CUSTOM_RATIO, customRatio ?? 4.5));
  }
  return isLarge ? 3.0 : 4.5;
}

/**
 * Sample the average backdrop color from a canvas region.
 *
 * Creates or uses an offscreen canvas of the requested region size,
 * replays backdrop content via the provided replay function, then
 * averages all non-transparent pixels.
 *
 * @param width - Region width in px
 * @param height - Region height in px
 * @param replayFn - Replays backdrop into the given 2D context
 * @returns Average [r,g,b] 0-255 or null if no pixel data
 */
export function sampleRegionBackdrop(
  width: number,
  height: number,
  replayFn: (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => void,
): [number, number, number] | null {
  if (width <= 0 || height <= 0) return null;

  let offscreen: OffscreenCanvas;
  try {
    offscreen = new OffscreenCanvas(width, height);
  } catch {
    return null;
  }
  const ctx = offscreen.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.clearRect(0, 0, width, height);
  replayFn(ctx);

  try {
    const imageData = ctx.getImageData(0, 0, width, height);
    return averagePixelColor(imageData);
  } catch {
    return null;
  }
}

/**
 * Resolve an adaptive text color against a sampled backdrop.
 *
 * 1. Compute current WCAG contrast ratio between text fill and backdrop.
 * 2. If already meeting target, return null (no change needed).
 * 3. Try the darkColor candidate first (prefer dark text).
 * 4. If dark candidate doesn't meet target, try lightColor candidate.
 * 5. Fall back to binary OKLCH lightness search via autoFixContrast.
 *
 * @param fgRgba - Current text fill color [r,g,b,a] 0-255
 * @param backdropRgb - Sampled backdrop color [r,g,b] 0-255
 * @param config - Adaptive contrast configuration
 * @param fontSize - Text font size in px (for large-text threshold)
 * @param fontWeight - Text font weight
 * @returns Resolved result or null if already meeting target
 */
export function resolveAdaptiveTextColor(
  fgRgba: [number, number, number, number],
  backdropRgb: [number, number, number],
  config: AdaptiveContrastConfig,
  fontSize: number,
  fontWeight?: number,
): AdaptiveContrastResult | null {
  const [fr, fg, fb, fa] = fgRgba;
  if (fa < 255) return null;
  const [br, bg, bb] = backdropRgb;

  const isLarge = fontWeight != null && fontWeight >= 700 && fontSize >= 18;
  const targetRatio = getTargetRatio(config.policy, config.customRatio, isLarge);

  const currentRatio = contrastRatio(relativeLuminance(fr, fg, fb), relativeLuminance(br, bg, bb));
  if (currentRatio >= targetRatio) return null;

  const tryCandidate = (
    candidate: [number, number, number, number],
  ): AdaptiveContrastResult | null => {
    const [cr, cg, cb] = candidate;
    const candidateRatio = contrastRatio(
      relativeLuminance(cr, cg, cb),
      relativeLuminance(br, bg, bb),
    );
    if (candidateRatio >= targetRatio) {
      return {
        resolved: [cr, cg, cb, 255],
        ratio: candidateRatio,
        targetRatio,
        meetsTarget: true,
        deltaEOK: 0,
      };
    }
    return null;
  };

  if (config.darkColor) {
    const result = tryCandidate(config.darkColor);
    if (result) return result;
  }

  if (config.lightColor) {
    const result = tryCandidate(config.lightColor);
    if (result) return result;
  }

  const fixed = autoFixContrast(fr, fg, fb, br, bg, bb, targetRatio);
  if (fixed) {
    return {
      resolved: [fixed.r, fixed.g, fixed.b, 255],
      ratio: fixed.ratio,
      targetRatio,
      meetsTarget: fixed.ratio >= targetRatio,
      deltaEOK: fixed.deltaEOK,
    };
  }

  return null;
}

/**
 * Check whether a backdrop has changed significantly since the last resolve,
 * accounting for hysteresis to prevent flickering.
 *
 * @param backdropRgb - The newly sampled backdrop [r,g,b] 0-255
 * @param resolvedColorRgba - The previously resolved text color [r,g,b,a] 0-255
 * @param hysteresis - Hysteresis threshold (default 0.5)
 * @returns true if the backdrop changed enough to warrant re-evaluation
 */
export function backdropChangedSinceLastResolve(
  backdropRgb: [number, number, number],
  resolvedColorRgba: [number, number, number, number],
  hysteresis: number = DEFAULT_HYSTERESIS,
): boolean {
  const backgroundLum = relativeLuminance(...backdropRgb);
  const resolvedLum = relativeLuminance(
    resolvedColorRgba[0],
    resolvedColorRgba[1],
    resolvedColorRgba[2],
  );
  return Math.abs(backgroundLum - resolvedLum) > hysteresis;
}

function averagePixelColor(imageData: ImageData): [number, number, number] {
  const data = imageData.data;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a === 0) continue;
    totalR += (data[i]! * a) / 255;
    totalG += (data[i + 1]! * a) / 255;
    totalB += (data[i + 2]! * a) / 255;
    count++;
  }

  if (count === 0) return [0, 0, 0];
  return [Math.round(totalR / count), Math.round(totalG / count), Math.round(totalB / count)];
}
