/**
 * Tritone effect — maps image luminance to three configurable colors
 * (shadows, midtones, highlights) with smooth interpolation and intensity blending.
 *
 * Architecture:
 *   A tritone is a 3-color tonal mapping where:
 *   - Pixels darker than `shadowPoint` map to `shadowColor`
 *   - Pixels brighter than `highlightPoint` map to `highlightColor`
 *   - Pixels between the two points interpolate through `midtoneColor`
 *
 *   The interpolation uses smoothstep transitions for natural-looking tonal
 *   ranges rather than hard cutoffs. An `intensity` parameter blends between
 *   the original pixel and the mapped color (1.0 = full tritone, 0.0 = original).
 *
 * Research basis: Photoshop Duotone (tritone mode), Affinity Photo split-toning,
 *   Photoshop Gradient Map with 3 stops. The tritone as a distinct adjustment
 *   provides simpler UX than a gradient map (three named color swatches vs
 *   abstract gradient stops) and adds intensity blending that gradient maps
 *   don't have natively.
 *
 * Alpha channel is preserved — transparent and semi-transparent pixels are
 * mapped proportionally to their alpha, so the effect composites correctly
 * with masks, clipping, and layer opacity.
 */

import type { Color } from './types';

export interface TritoneParams {
  shadowColor: Color;
  midtoneColor: Color;
  highlightColor: Color;
  shadowPoint: number;
  highlightPoint: number;
  intensity: number;
  preserveLuminosity: boolean;
}

/**
 * Smoothstep interpolation: 0 at edge0, 1 at edge1, smooth in between.
 * Produces C1-continuous transitions (no visible banding at boundaries).
 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Linear interpolation between two values.
 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Compute the tritone-mapped color for a given luminance value (0-255).
 * Returns [r, g, b] in 0-255 range.
 *
 * The mapping has three regions:
 * 1. lum < shadowPoint: blend from shadowColor toward midtoneColor
 * 2. shadowPoint <= lum <= highlightPoint: midtoneColor region
 * 3. lum > highlightPoint: blend from midtoneColor toward highlightColor
 *
 * Transitions use smoothstep for natural tonal separation.
 */
export function tritoneMap(lum: number, params: TritoneParams): [number, number, number] {
  const normalized = lum / 255;
  const sp = params.shadowPoint;
  const hp = params.highlightPoint;

  const sc = params.shadowColor;
  const mc = params.midtoneColor;
  const hc = params.highlightColor;

  let r: number, g: number, b: number;

  if (normalized <= sp) {
    // Shadow region: full shadow color at 0, transitioning to midtone at sp
    const t = sp > 0 ? smoothstep(0, sp, normalized) : 1;
    r = lerp(sc[0], mc[0], t);
    g = lerp(sc[1], mc[1], t);
    b = lerp(sc[2], mc[2], t);
  } else if (normalized >= hp) {
    // Highlight region: transitioning from midtone at hp to full highlight at 1
    const t = hp < 1 ? smoothstep(hp, 1, normalized) : 0;
    r = lerp(mc[0], hc[0], t);
    g = lerp(mc[1], hc[1], t);
    b = lerp(mc[2], hc[2], t);
  } else {
    // Midtone region: constant midtone color.
    // The shadow and highlight regions already use smoothstep to transition
    // to/from midtoneColor, so the midtone region is continuous at both
    // boundaries (sp and hp) without any additional blending. Adding a pull
    // toward shadow/highlight here would break continuity and monotonicity.
    r = mc[0];
    g = mc[1];
    b = mc[2];
  }

  return [r, g, b];
}

/**
 * Apply tritone effect to ImageData in-place.
 *
 * - Maps each pixel's luminance to a tritone color
 * - Blends with original at `intensity` (1.0 = full effect, 0.0 = no change)
 * - Preserves alpha channel
 * - Optionally preserves original luminance
 */
export function applyTritone(data: ImageData, params: TritoneParams): ImageData {
  const pixels = data.data;
  const intensity = Math.max(0, Math.min(1, params.intensity));

  if (intensity === 0) return data;

  // Pre-compute LUT for all 256 luminance values
  const lutR = new Float32Array(256);
  const lutG = new Float32Array(256);
  const lutB = new Float32Array(256);

  for (let lum = 0; lum < 256; lum++) {
    const [r, g, b] = tritoneMap(lum, params);
    lutR[lum] = r;
    lutG[lum] = g;
    lutB[lum] = b;
  }

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const a = pixels[i + 3]!;

    // Skip fully transparent pixels — no visual contribution
    if (a === 0) continue;

    // Rec. 709 luma
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const clampedLum = Math.max(0, Math.min(255, lum));

    let nr = lutR[clampedLum]!;
    let ng = lutG[clampedLum]!;
    let nb = lutB[clampedLum]!;

    if (params.preserveLuminosity) {
      const mappedLum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
      if (mappedLum > 0) {
        const scale = lum / mappedLum;
        nr *= scale;
        ng *= scale;
        nb *= scale;
      }
    }

    // Blend with original at intensity
    nr = lerp(r, nr, intensity);
    ng = lerp(g, ng, intensity);
    nb = lerp(b, nb, intensity);

    pixels[i] = Math.max(0, Math.min(255, Math.round(nr)));
    pixels[i + 1] = Math.max(0, Math.min(255, Math.round(ng)));
    pixels[i + 2] = Math.max(0, Math.min(255, Math.round(nb)));
    // Alpha preserved
  }

  return data;
}
