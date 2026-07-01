/**
 * WCAG 2.2 color-contrast utilities + OKLCH color space (Strata redesign).
 *
 * Research basis: WCAG 2.x relative-luminance and contrast-ratio definitions
 * (W3C, 2023). OKLCH color space (Björn Ottosson, 2020) used for perceptually
 * uniform color tokens. All tokens are stored in OKLCH; Rgb is an intermediate
 * for WCAG math only.
 *
 * Text pairs require >= 4.5:1 (AA) or 7:1 (AAA); UI / graphical objects and
 * large text require >= 3:1.
 */

/** RGB triplet, 0-255. */
export type Rgb = readonly [number, number, number];

/** OKLCH color — perceptually uniform color representation. */
export interface Oklch {
  /** Perceived lightness 0–1 (0=black, 1=white). */
  L: number;
  /** Chroma (saturation, independent of hue) — typically 0–0.37 for sRGB, can go higher for P3. */
  C: number;
  /** Hue angle 0–360 (red~20, yellow~90, green~145, blue~250, purple~320). */
  H: number;
}

/**
 * Convert sRGB (0-255) to OKLab, then to OKLCH.
 * Based on Björn Ottosson's OKLab color space (2020).
 */
export function rgbToOklch([r, g, b]: Rgb): Oklch {
  const rLin = srgbToLinear(r / 255);
  const gLin = srgbToLinear(g / 255);
  const bLin = srgbToLinear(b / 255);

  // Linear sRGB → LMS cone response
  let l = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  let m = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
  let s = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

  // Non-linear compression (cube root)
  const lC = Math.cbrt(l);
  const mC = Math.cbrt(m);
  const sC = Math.cbrt(s);

  // LMS → OKLab
  const L = 0.2104542553 * lC + 0.793617785 * mC - 0.0040720468 * sC;
  const a = 1.9779984951 * lC - 2.428592205 * mC + 0.4505937099 * sC;
  const bVal = 0.0259040371 * lC + 0.7827717662 * mC - 0.808675766 * sC;

  // OKLab → OKLCH
  return {
    L,
    C: Math.sqrt(a * a + bVal * bVal),
    H: (Math.atan2(bVal, a) * 180) / Math.PI,
  };
}

/**
 * Round OKLCH values to reasonable CSS precision.
 * L: 4 decimal places, C: 4 decimal places, H: 2 decimal places.
 */
export function roundOklch(c: Oklch): Oklch {
  return {
    L: Math.round(c.L * 10000) / 10000,
    C: Math.round(c.C * 10000) / 10000,
    H: Math.round(c.H * 100) / 100,
  };
}

/** Format an Oklch as CSS `oklch(L C H)`. */
export function oklchToCss(c: Oklch): string {
  return `oklch(${c.L} ${c.C} ${c.H})`;
}

/** Hard-compare OKLCH values for test equality (avoids floating-point drift). */
export function oklchEqual(a: Oklch, b: Oklch, tolerance = 0.001): boolean {
  return (
    Math.abs(a.L - b.L) <= tolerance &&
    Math.abs(a.C - b.C) <= tolerance &&
    Math.abs(a.H - b.H) <= tolerance
  );
}

/**
 * Convert OKLCH back to sRGB Rgb (0-255).
 * Returns clamped [0,255] values — out-of-gamut colors are clipped.
 */
export function oklchToRgb(c: Oklch): Rgb {
  const H = (c.H * Math.PI) / 180;
  const a = c.C * Math.cos(H);
  const bVal = c.C * Math.sin(H);

  // OKLab → LMS'
  const lC = c.L + 0.3963377774 * a + 0.2158037573 * bVal;
  const mC = c.L - 0.1055613458 * a - 0.0638541728 * bVal;
  const sC = c.L - 0.0894841775 * a - 1.291485548 * bVal;

  // Apply cube
  const l = lC * lC * lC;
  const m = mC * mC * mC;
  const s = sC * sC * sC;

  // LMS' → linear sRGB
  const rLin = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  // Linear → sRGB gamma, clamp to [0,255]
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)));

  return [clamp(rLin), clamp(gLin), clamp(bLin)];
}

/** sRGB 0-1 to linear. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear to sRGB 0-1. */
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB color (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio between two sRGB colors (range 1..21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Contrast ratio between two OKLCH colors (converts to Rgb internally). */
export function oklchContrastRatio(a: Oklch, b: Oklch): number {
  return contrastRatio(oklchToRgb(a), oklchToRgb(b));
}

export type ContrastGrade = 'AA' | 'AAA' | 'UI';

/** Minimum ratio required for a grade (WCAG 2.2). */
export function minimumRatio(grade: ContrastGrade): number {
  switch (grade) {
    case 'AA':
      return 4.5;
    case 'AAA':
      return 7;
    case 'UI':
      return 3;
  }
}

export function passes(grade: ContrastGrade, a: Rgb, b: Rgb): boolean {
  return contrastRatio(a, b) >= minimumRatio(grade);
}

export function oklchPasses(grade: ContrastGrade, a: Oklch, b: Oklch): boolean {
  return oklchContrastRatio(a, b) >= minimumRatio(grade);
}

/** Format an Rgb as `#rrggbb` (lowercase). */
export function toHex([r, g, b]: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
