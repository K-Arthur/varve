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
  outlineText(text: string, fontSize: number, fontFamily: string): Promise<string>;
}
