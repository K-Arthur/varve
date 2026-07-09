/**
 * Cast shadow separation engine.
 *
 * Analyzes an original image and its foreground mask to detect and extract
 * cast shadows that fall on the background. The extracted shadow alpha layer
 * can be composited over different backgrounds, preserving realistic shadow
 * transparency.
 *
 * Detection uses three cues per pixel in the region near the foreground
 * boundary: luminance drop, colour temperature shift toward cool (blue),
 * and saturation reduction relative to the local unshadowed background.
 *
 * Research basis: Finlayson & Hordley (2001) "Color Constancy at a Pixel";
 * MacKenzie et al. "Shadow Removal via Spatially-Variant Illumination
 * Estimation"; classic shadow matting for compositing.
 */

import { featherMaskArray, findConnectedComponents, filterMaskByComponents } from './maskOps';

export interface ShadowSeparationOptions {
  /** Luminance threshold for shadow detection (0-255, default 30). */
  shadowThreshold?: number;
  /** Feather radius for shadow edge softening (px, default 2). */
  featherRadius?: number;
  /** Max distance from foreground to search for shadows (px, default 50). */
  searchDistance?: number;
  /** Minimum shadow region size in pixels (default 100). */
  minShadowSize?: number;
  /** Whether to separate alpha matte (true) or just detect (false). */
  extractShadow?: boolean;
}

export interface ShadowMatteResult {
  /** Single-channel alpha mask of the shadow (0-255 per pixel). */
  shadowMask: Uint8Array;
  /** Width of the mask. */
  width: number;
  /** Height of the mask. */
  height: number;
  /** Estimated shadow RGBA colour. */
  shadowColor: [number, number, number, number];
  /** Confidence score 0-1. */
  confidence: number;
  /** Whether shadow was detected at all. */
  hasShadow: boolean;
  /** Number of shadow regions found. */
  regionCount: number;
}

/**
 * Compute luminance from RGB using standard weighting.
 * Returns value in [0, 255].
 */
function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Simple saturation estimate: max(R,G,B) - min(R,G,B).
 */
function saturation(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * Morphological dilation of a binary/soft mask.
 * Each pixel takes the maximum of its neighbours within `radius`.
 * Pure typed-array implementation.
 */
function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0 || width <= 0 || height <= 0) return new Uint8Array(mask);
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxVal = 0;
      const y0 = Math.max(0, y - radius);
      const y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const v = mask[ny * width + nx] ?? 0;
          if (v > maxVal) maxVal = v;
        }
      }
      result[y * width + x] = maxVal;
    }
  }
  return result;
}

/**
 * Estimate the expected (unshadowed) background luminance for each pixel
 * in the search band by sampling nearby background pixels.  For pixels
 * that have no background sample within the sampling window, we fall back
 * to the global average background luminance.
 */
function estimateExpectedLuminance(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  bgRegion: Uint8Array,
  searchBand: Uint8Array,
  searchDistance: number,
): Float32Array {
  const { data, width, height } = imageData;
  const numPixels = width * height;
  const expectedLum = new Float32Array(numPixels);

  // Compute global average background luminance as fallback.
  let globalBgSum = 0;
  let globalBgCount = 0;
  for (let i = 0; i < numPixels; i++) {
    if (bgRegion[i]! > 128) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      globalBgSum += luminance(r, g, b);
      globalBgCount++;
    }
  }
  const globalBgLum = globalBgCount > 0 ? globalBgSum / globalBgCount : 255;

  // Fill known background luminance.
  for (let i = 0; i < numPixels; i++) {
    if (bgRegion[i]! > 128) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      expectedLum[i] = luminance(r, g, b);
    } else {
      expectedLum[i] = -1;
    }
  }

  // For each search-band pixel, sample the surrounding background.
  // Uses a discounted weight: nearer background pixels contribute more.
  const winRadius = Math.ceil(searchDistance * 1.5);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (searchBand[i]! <= 128) continue;

      let weightedSum = 0;
      let weightTotal = 0;
      const y0 = Math.max(0, y - winRadius);
      const y1 = Math.min(height - 1, y + winRadius);
      const x0 = Math.max(0, x - winRadius);
      const x1 = Math.min(width - 1, x + winRadius);

      for (let ny = y0; ny <= y1; ny++) {
        for (let nx = x0; nx <= x1; nx++) {
          const ni = ny * width + nx;
          if (bgRegion[ni]! > 128) {
            const dx = nx - x;
            const dy = ny - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const w = Math.max(0, 1 - dist / winRadius);
            weightedSum += (expectedLum[ni] ?? 0) * w;
            weightTotal += w;
          }
        }
      }

      expectedLum[i] = weightTotal > 0 ? weightedSum / weightTotal : globalBgLum;
    }
  }

  return expectedLum;
}

/**
 * Compute a shadow score for each search-band pixel based on three cues:
 * luminance difference, colour temperature shift, and saturation change.
 * Returns a value in [0, 1].
 */
function computeShadowScore(
  data: Uint8ClampedArray | Uint8Array,
  bgRegion: Uint8Array,
  searchBand: Uint8Array,
  expectedLum: Float32Array,
  width: number,
  height: number,
  shadowThreshold: number,
): Float32Array {
  const numPixels = width * height;
  const score = new Float32Array(numPixels);

  // Compute global average background colour ratios for temperature+sat comparison.
  let bgBoverRSum = 0;
  let bgSatSum = 0;
  let bgCount = 0;
  for (let i = 0; i < numPixels; i++) {
    if (bgRegion[i]! > 128) {
      const r = data[i * 4]!;
      const g = data[i * 4 + 1]!;
      const b = data[i * 4 + 2]!;
      bgBoverRSum += r > 0 ? b / r : 0;
      bgSatSum += saturation(r, g, b);
      bgCount++;
    }
  }
  const bgAvgBoverR = bgCount > 0 ? bgBoverRSum / bgCount : 1;
  const bgAvgSat = bgCount > 0 ? bgSatSum / bgCount : 128;

  for (let i = 0; i < numPixels; i++) {
    if (searchBand[i]! <= 128) {
      score[i] = 0;
      continue;
    }

    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const actualLum = luminance(r, g, b);
    const expected = expectedLum[i] ?? 255;

    // Cue 1: Luminance difference.
    const lumDiff = Math.max(0, expected - actualLum - shadowThreshold);
    const lumScore = Math.min(1, lumDiff / (255 - shadowThreshold));

    // Cue 2: Colour temperature shift (higher B/R ratio = more cool/blue).
    const actualBoverR = r > 0 ? b / r : 0;
    const tempShift = Math.max(0, actualBoverR - bgAvgBoverR);
    const tempScore = Math.min(1, tempShift / 2);

    // Cue 3: Saturation reduction.
    const actualSat = saturation(r, g, b);
    const satDrop = Math.max(0, bgAvgSat - actualSat);
    const satScore = Math.min(1, satDrop / (bgAvgSat + 1));

    // Combined score: lum is primary, temp and sat are supporting.
    // If luminance is not notably reduced, other cues alone cannot trigger.
    const combined = lumScore > 0.1 ? lumScore * 0.6 + tempScore * 0.2 + satScore * 0.2 : 0;

    score[i] = combined;
  }

  return score;
}

/**
 * Detect and extract cast shadows from an image + foreground mask.
 *
 * Three-cue detection (luminance drop, blue shift, saturation loss) produces
 * a continuous alpha matte for the shadow.  The shadow colour is estimated
 * as the alpha-weighted average of detected shadow pixels.
 *
 * @param imageData - Original RGBA image data.
 * @param foregroundMask - Binary mask (0 = background, 255 = foreground).
 * @param options - Detection options.
 * @returns Shadow matte result.
 */
export function extractCastShadow(
  imageData: { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
  foregroundMask: Uint8Array,
  options?: ShadowSeparationOptions,
): ShadowMatteResult {
  const { data, width, height } = imageData;
  const numPixels = width * height;

  const shadowThreshold = options?.shadowThreshold ?? 30;
  const featherRadius = options?.featherRadius ?? 2;
  const searchDistance = options?.searchDistance ?? 50;
  const minShadowSize = options?.minShadowSize ?? 100;
  const extractShadow = options?.extractShadow ?? true;

  const empty: ShadowMatteResult = {
    shadowMask: new Uint8Array(numPixels),
    width,
    height,
    shadowColor: [0, 0, 0, 0] as [number, number, number, number],
    confidence: 0,
    hasShadow: false,
    regionCount: 0,
  };

  if (width === 0 || height === 0 || numPixels === 0) {
    return { ...empty, width, height, shadowMask: new Uint8Array(0) };
  }

  // Count foreground pixels to detect trivial cases.
  let fgCount = 0;
  for (let i = 0; i < numPixels; i++) {
    if (foregroundMask[i]! > 128) fgCount++;
  }

  // No foreground → no cast shadow.
  if (fgCount === 0) return empty;

  // Dilate foreground to define the search band.
  const dilatedFG = dilateMask(foregroundMask, width, height, searchDistance);

  // Search band = dilated - original foreground boundary region.
  const searchBand = new Uint8Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    searchBand[i] = dilatedFG[i]! > 128 && foregroundMask[i]! <= 128 ? 255 : 0;
  }

  // If foreground fills everything or search band is empty, no shadow.
  let bandCount = 0;
  for (let i = 0; i < numPixels; i++) {
    if (searchBand[i]! > 128) bandCount++;
  }
  if (bandCount === 0) return empty;

  // Background region = exterior of dilated foreground.
  const bgRegion = new Uint8Array(numPixels);
  let bgCount = 0;
  for (let i = 0; i < numPixels; i++) {
    const isBg = dilatedFG[i]! <= 128;
    bgRegion[i] = isBg ? 255 : 0;
    if (isBg) bgCount++;
  }

  // If the background region has too few pixels to produce a reliable
  // luminance reference, bail.  This happens when the search distance
  // is large relative to the image (e.g., dilation covers everything).
  // Require at least 2% of the image or 10 pixels, whichever is larger.
  const minBgPixels = Math.max(10, Math.floor(numPixels * 0.02));
  if (bgCount < minBgPixels) return empty;

  // Step 1: Estimate expected background luminance in the search band.
  const expectedLum = estimateExpectedLuminance(imageData, bgRegion, searchBand, searchDistance);

  // Step 2: Compute multi-cue shadow score for each search-band pixel.
  const shadowScore = computeShadowScore(
    data,
    bgRegion,
    searchBand,
    expectedLum,
    width,
    height,
    shadowThreshold,
  );

  // Step 3: Threshold to binary for component analysis.
  const SCORE_THRESHOLD = 0.08;
  const shadowBinary = new Uint8Array(numPixels);
  for (let i = 0; i < numPixels; i++) {
    shadowBinary[i] = shadowScore[i]! > SCORE_THRESHOLD ? 255 : 0;
  }

  // Step 4: Connected-component filtering by minimum size.
  const components = findConnectedComponents(shadowBinary, width, height, SCORE_THRESHOLD * 255);
  const largeComponents = new Set(
    components.filter((c) => c.pixelCount >= minShadowSize).map((c) => c.id),
  );
  const hasShadow = largeComponents.size > 0;

  // Step 5: Build continuous shadow alpha mask.
  // Only keep pixels that belong to a sufficiently large component.
  let shadowMask: Uint8Array;
  if (extractShadow && hasShadow) {
    const rawMask = new Uint8Array(numPixels);
    for (let i = 0; i < numPixels; i++) {
      rawMask[i] = Math.round((shadowScore[i] ?? 0) * 255);
    }

    shadowMask = filterMaskByComponents(rawMask, width, height, largeComponents, 1);

    if (featherRadius > 0) {
      shadowMask = featherMaskArray(shadowMask, width, height, featherRadius);
    }
  } else {
    shadowMask = new Uint8Array(numPixels);
  }

  // Step 6: Compute shadow colour as alpha-weighted average of detected pixels.
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  let totalAlpha = 0;
  let shadowPixelCount = 0;

  for (let i = 0; i < numPixels; i++) {
    const a = shadowMask[i]!;
    if (a > 0) {
      totalR += data[i * 4]! * a;
      totalG += data[i * 4 + 1]! * a;
      totalB += data[i * 4 + 2]! * a;
      totalAlpha += a;
      shadowPixelCount++;
    }
  }

  const shadowColor: [number, number, number, number] =
    totalAlpha > 0
      ? [
          Math.round(totalR / totalAlpha),
          Math.round(totalG / totalAlpha),
          Math.round(totalB / totalAlpha),
          Math.round(totalAlpha / shadowPixelCount),
        ]
      : [0, 0, 0, 0];

  // Step 7: Compute confidence from shadow intensity, region count, and
  // colour temperature evidence.
  const avgShadowAlpha = shadowPixelCount > 0 ? totalAlpha / (shadowPixelCount * 255) : 0;
  const regionFactor = Math.min(1, largeComponents.size / 3);
  const confidence = hasShadow ? Math.min(1, avgShadowAlpha * 0.5 + regionFactor * 0.3 + 0.2) : 0;

  return {
    shadowMask,
    width,
    height,
    shadowColor,
    confidence,
    hasShadow,
    regionCount: largeComponents.size,
  };
}
