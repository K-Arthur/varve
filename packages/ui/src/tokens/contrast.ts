/**
 * WCAG 2.2 color-contrast utilities (Strata plan §6, §7 gate).
 *
 * Research basis: WCAG 2.x relative-luminance and contrast-ratio definitions
 * (W3C, 2023). These power the token audit and any runtime contrast checks.
 * Text pairs require >= 4.5:1 (AA) or 7:1 (AAA); UI / graphical objects and
 * large text require >= 3:1.
 */

/** RGB triplet, 0-255. */
export type Rgb = readonly [number, number, number];

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

/** Format an Rgb as `#rrggbb` (lowercase). */
export function toHex([r, g, b]: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
