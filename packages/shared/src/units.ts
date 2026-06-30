/**
 * Unit conversion utilities for the Spec Panel (and general use).
 *
 * All conversions assume 96 DPI (standard screen resolution).
 * Pt = px × 72/96 = px × 0.75. Rem = px / base (16 default).
 * % = px / containerSize × 100.
 *
 * Research basis: CSS Values and Units Module Level 4 (W3C).
 */

export type SpecUnit = 'px' | 'pt' | 'rem' | '%';

const DPI = 96;
const PT_PER_INCH = 72;

export function pxToPt(px: number): number {
  return (px * PT_PER_INCH) / DPI;
}

export function ptToPx(pt: number): number {
  return (pt * DPI) / PT_PER_INCH;
}

export function pxToRem(px: number, baseFontSize = 16): number {
  return px / baseFontSize;
}

export function remToPx(rem: number, baseFontSize = 16): number {
  return rem * baseFontSize;
}

export function pxToPercent(px: number, containerSize: number): number {
  if (containerSize === 0) return 0;
  return (px / containerSize) * 100;
}

export function percentToPx(percent: number, containerSize: number): number {
  return (percent / 100) * containerSize;
}

export function convertPx(
  value: number,
  to: SpecUnit,
  baseFontSize = 16,
  containerSize = 100,
): number {
  switch (to) {
    case 'px':
      return value;
    case 'pt':
      return pxToPt(value);
    case 'rem':
      return pxToRem(value, baseFontSize);
    case '%':
      return pxToPercent(value, containerSize);
  }
}

export function convertToPx(
  value: number,
  from: SpecUnit,
  baseFontSize = 16,
  containerSize = 100,
): number {
  switch (from) {
    case 'px':
      return value;
    case 'pt':
      return ptToPx(value);
    case 'rem':
      return remToPx(value, baseFontSize);
    case '%':
      return percentToPx(value, containerSize);
  }
}

export function formatValue(value: number, unit: SpecUnit): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit === '%' ? '%' : unit}`;
}
