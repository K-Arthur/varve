/**
 * @strata/print — Tauri native backend.
 *
 * Calls the strata-print Rust crate via IPC for PDF assembly and font
 * outlining. On web/stub environments, this file should NOT be imported
 * (tree-shaken via the facade in index.ts).
 */
import type { PdfExportOptions, PdfResult, PrintEngine } from './types';

async function core() {
  const mod = await import('@tauri-apps/api/core');
  return mod;
}

export function createNativePrintEngine(): PrintEngine {
  return {
    backend: 'native',

    async exportPdf(docJson, opts): Promise<PdfResult> {
      const c = await core();
      const command = opts.format === 'pdf-x1a' ? 'export_pdfx1a'
        : opts.format === 'pdf-x4' ? 'export_pdfx4'
        : 'export_pdf';

      const data: number[] = await c.invoke(command, {
        docJson,
        pageWidth: opts.pageWidth ?? 1920,
        pageHeight: opts.pageHeight ?? 1080,
        bleedMm: opts.bleedMm ?? 3,
        includeCropMarks: opts.includeCropMarks ?? false,
        includeRegistrationMarks: opts.includeRegistrationMarks ?? false,
        enforceDpi: opts.enforceDpi ?? 300,
        outlineText: opts.outlineText ?? false,
      });

      return {
        name: opts.title ?? 'export',
        data: new Uint8Array(data),
        format: opts.format,
        pages: 1,
      };
    },

    async outlineText(text, fontSize, fontFamily): Promise<string> {
      const c = await core();
      const result: string = await c.invoke('outline_text', {
        text,
        fontSize,
        fontFamily,
      });
      return result;
    },
  };
}
