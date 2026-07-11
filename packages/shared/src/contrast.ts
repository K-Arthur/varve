/**
 * WCAG 2.1 contrast utilities — relative luminance, contrast ratio,
 * WCAG level determination, and OKLCH-based auto-fix.
 *
 * Research basis: WCAG 2.1 §1.4.3 (Contrast Minimum),
 * §1.4.6 (Contrast Enhanced), CIE 15:2018, Ottosson (2020) Oklab.
 */

import {
  deltaEOk,
  gamutMapToSrgb,
  linearSrgbToOklab,
  oklabToOkLch,
  srgbToLinear,
} from './colorConversion';

/**
 * WCAG 2.1 relative luminance from sRGB 0-255 components.
 *
 * Formula: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 * where R/G/B are linearized (sRGB gamma expansion via srgbToLinear).
 *
 * Research basis: ITU-R BT.709-6 §2.1.1 (luminance coefficients),
 * sRGB IEC 61966-2-1 §5.1 (gamma).
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * WCAG 2.1 contrast ratio between two luminance values.
 *
 * Ratio = (L₁ + 0.05) / (L₂ + 0.05), with L₁ ≥ L₂.
 * Range: 1:1 (identical luminance) to 21:1 (black on white).
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA minimum contrast for normal-sized text. */
export const WCAG_AA_NORMAL = 4.5;

/** WCAG AA minimum contrast for large text (≥18pt or ≥14pt bold). */
export const WCAG_AA_LARGE = 3.0;

/** WCAG AAA minimum contrast for normal-sized text. */
export const WCAG_AAA_NORMAL = 7.0;

/** WCAG AAA minimum contrast for large text (≥18pt or ≥14pt bold). */
export const WCAG_AAA_LARGE = 4.5;

/**
 * Determine the WCAG compliance level for a given contrast ratio.
 *
 * @param ratio - The contrast ratio (≥1).
 * @param isLargeText - If true, uses large-text thresholds (AA ≥ 3:1, AAA ≥ 4.5:1).
 * @returns 'AAA', 'AA', or 'FAIL'.
 */
export function wcagLevel(ratio: number, isLargeText: boolean = false): 'AAA' | 'AA' | 'FAIL' {
  if (isLargeText) {
    if (ratio >= WCAG_AAA_LARGE) return 'AAA';
    if (ratio >= WCAG_AA_LARGE) return 'AA';
  } else {
    if (ratio >= WCAG_AAA_NORMAL) return 'AAA';
    if (ratio >= WCAG_AA_NORMAL) return 'AA';
  }
  return 'FAIL';
}

/**
 * Auto-fix a foreground color to meet a WCAG contrast target against a
 * background color, constrained by OKLCH lightness adjustment with a
 * ΔEOK < 5 perceptual bound.
 *
 * Algorithm:
 * 1. Both colors → Oklab, compute contrast ratio.
 * 2. If already meeting target, return null.
 * 3. Determine direction: lighter (fg L > bg L) or darker (fg L < bg L).
 * 4. Binary search the Oklab L axis (50 iterations) keeping a,b constant,
 *    clamping out-of-gamut linear sRGB channels to [0,1].
 * 5. Return the candidate closest to the original that meets the target,
 *    or null if ΔEOK ≥ 5 (perceptually unacceptable shift) or the target
 *    is unreachable on the lightness axis alone.
 *
 * @param fgR - Foreground red 0-255.
 * @param fgG - Foreground green 0-255.
 * @param fgB - Foreground blue 0-255.
 * @param bgR - Background red 0-255.
 * @param bgG - Background green 0-255.
 * @param bgB - Background blue 0-255.
 * @param targetRatio - Target contrast ratio (default WCAG_AA_NORMAL = 4.5).
 * @returns Fixed color or null if no fix possible or safe.
 */
export function autoFixContrast(
  fgR: number,
  fgG: number,
  fgB: number,
  bgR: number,
  bgG: number,
  bgB: number,
  targetRatio: number = WCAG_AA_NORMAL,
): {
  r: number;
  g: number;
  b: number;
  ratio: number;
  deltaEOK: number;
} | null {
  const bgLum = relativeLuminance(bgR, bgG, bgB);
  const fgLum = relativeLuminance(fgR, fgG, fgB);

  // Already meets target
  if (contrastRatio(fgLum, bgLum) >= targetRatio) return null;

  // Convert fg to Oklab, keeping a,b (chroma/hue) constant during search
  const fgLinear: [number, number, number] = [
    srgbToLinear(fgR),
    srgbToLinear(fgG),
    srgbToLinear(fgB),
  ];
  const [fgL, fgA, fgB_] = linearSrgbToOklab(fgLinear);

  // Background Oklab L for direction determination
  const [bgL] = linearSrgbToOklab([srgbToLinear(bgR), srgbToLinear(bgG), srgbToLinear(bgB)]);

  // Helper: Oklab → sRGB 0-255 via chroma-reduction gamut mapping
  // Preserves lightness and hue better than simple clamping for out-of-gamut colors.
  const oklabToSrgbGamutMapped = (L: number): [number, number, number] => {
    return gamutMapToSrgb(oklabToOkLch([L, fgA, fgB_]));
  };

  // Determine binary search range
  let lo: number;
  let hi: number;
  if (fgL >= bgL) {
    // Foreground lighter than background → make lighter
    lo = fgL;
    hi = 1;
  } else {
    // Foreground darker than background → make darker
    lo = 0;
    hi = fgL;
  }

  // Binary search on Oklab lightness
  const iterations = 50;
  for (let i = 0; i < iterations; i++) {
    const mid = (lo + hi) / 2;
    const [r, g, b] = oklabToSrgbGamutMapped(mid);
    const ratio = contrastRatio(relativeLuminance(r, g, b), bgLum);

    if (fgL >= bgL) {
      // Making lighter: higher mid → lighter → higher contrast
      if (ratio >= targetRatio) {
        hi = mid;
      } else {
        lo = mid;
      }
    } else {
      // Making darker: lower mid → darker → higher contrast
      if (ratio >= targetRatio) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  const resultL = fgL >= bgL ? hi : lo;
  const [resultR, resultG, resultB] = oklabToSrgbGamutMapped(resultL);
  const achievedRatio = contrastRatio(relativeLuminance(resultR, resultG, resultB), bgLum);

  if (achievedRatio < targetRatio) return null;

  // Enforce ΔEOK < 5 perceptual bound
  const dE = deltaEOk([fgR, fgG, fgB, 255], [resultR, resultG, resultB, 255]);
  if (dE >= 5) return null;

  return {
    r: resultR,
    g: resultG,
    b: resultB,
    ratio: achievedRatio,
    deltaEOK: dE,
  };
}
