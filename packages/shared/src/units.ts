/**
 * Unit conversion utilities for the Spec Panel (and general use).
 *
 * All conversions assume 96 DPI (standard screen resolution).
 * Pt = px × 72/96 = px × 0.75. Rem = px / base (16 default).
 * % = px / containerSize × 100.
 *
 * DocumentUnit extends SpecUnit with physical print units: mm, cm, in, pc.
 * These are used for document setup, bleed, physical dimensions, and print
 * production workflows.
 *
 * Research basis: CSS Values and Units Module Level 4 (W3C),
 * ISO 216 (paper sizes), PostScript point system (1pt = 1/72 inch).
 */

export type SpecUnit = 'px' | 'pt' | 'rem' | '%';

/** Physical + display units for document-level measurement. */
export type DocumentUnit = 'px' | 'pt' | 'mm' | 'cm' | 'in' | 'pc';

const DPI = 96;
const PT_PER_INCH = 72;
const MM_PER_INCH = 25.4;
const CM_PER_INCH = 2.54;
const PT_PER_PICA = 12;

/** Conversion factor: multiply a value in this unit by this factor to get px. */
export const UNIT_TO_PX: Record<DocumentUnit, number> = {
  px: 1,
  pt: DPI / PT_PER_INCH,
  mm: DPI / MM_PER_INCH,
  cm: DPI / CM_PER_INCH,
  in: DPI,
  pc: (DPI / PT_PER_INCH) * PT_PER_PICA,
};

/** Convert a value from one DocumentUnit to another. */
export function convertDocumentUnit(value: number, from: DocumentUnit, to: DocumentUnit): number {
  if (from === to) return value;
  const px = value * UNIT_TO_PX[from];
  return px / UNIT_TO_PX[to];
}

/** Convert a physical value to CSS px. */
export function physicalToPx(value: number, unit: DocumentUnit): number {
  return value * UNIT_TO_PX[unit];
}

/** Convert CSS px to a physical unit. */
export function pxToPhysical(px: number, unit: DocumentUnit): number {
  return px / UNIT_TO_PX[unit];
}

/**
 * Convert a physical value to true pixel count at an arbitrary export/print
 * DPI. This is NOT for Page/FrameNode geometry — those stay resolution-
 * independent world units via the fixed-96dpi physicalToPx above. Use this
 * only for rasterization/export/print pixel-count math (e.g. computing the
 * actual output pixel dimensions of a 210mm-wide document at 300dpi).
 */
export function physicalToPxAtDpi(value: number, unit: DocumentUnit, dpi: number): number {
  return value * UNIT_TO_PX[unit] * (dpi / DPI);
}

/** Inverse of physicalToPxAtDpi. */
export function pxAtDpiToPhysical(px: number, unit: DocumentUnit, dpi: number): number {
  return px / (UNIT_TO_PX[unit] * (dpi / DPI));
}

/** Format a physical value with its unit suffix, rounded to 2 decimals. */
export function formatPhysical(value: number, unit: DocumentUnit): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded}${unit}`;
}

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
