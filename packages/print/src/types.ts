/**
 * @strata/print — types for the print/PDF export facade.
 */
import type { ExportFormat } from '@strata/scene';

export interface PdfExportOptions {
  pageWidth?: number;
  pageHeight?: number;
  title?: string;
  author?: string;
  format: ExportFormat; // 'pdf-screen' | 'pdf-x1a' | 'pdf-x4'
  bleedMm?: number;
  includeCropMarks?: boolean;
  includeRegistrationMarks?: boolean;
  enforceDpi?: number;
  outlineText?: boolean;
  /** When true, converts fills to CMYK (used for PDF/X-1a). */
  useCmyk?: boolean;
  /** ICC print profile name (e.g. "Fogra39", "GRACoL2006", "SWOP Coated"). */
  iccProfile?: string;
  /** When true, includes CMYK colour bars on the output. */
  colorBars?: boolean;
  /** JSON-serialized resource manifest with decoded image bytes for pattern fills. */
  manifestJson?: string;
}

export interface PdfResult {
  name: string;
  data: Uint8Array;
  format: ExportFormat;
  pages: number;
}

export interface PrintEngine {
  readonly backend: 'native' | 'stub';
  exportPdf(docJson: string, opts: PdfExportOptions): Promise<PdfResult>;
  outlineText(text: string, fontSize: number, fontData: Uint8Array): Promise<string>;
}
