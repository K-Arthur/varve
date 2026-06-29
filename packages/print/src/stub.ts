/**
 * @strata/print — stub backend for tests and web-only environments.
 *
 * Produces a minimal PDF-wrapped SVG document so the export pipeline can be
 * verified without the native Rust engine or Tauri IPC.
 */
import type { PdfExportOptions, PdfResult, PrintEngine } from './types';

export function createStubPrintEngine(): PrintEngine {
  return {
    backend: 'stub',

    async exportPdf(docJson: string, opts: PdfExportOptions): Promise<PdfResult> {
      // Minimal placeholder: wrap the JSON doc in a PDF header (not a real PDF,
      // just enough to verify the pipeline is wired).
      const docId = docJson.length > 0 ? 'doc' : 'empty';
      const header = `%PDF-1.4 (${opts.format} stub)`;
      const encoder = new TextEncoder();
      const data = encoder.encode(`${header}\n${docId}\n`);
      return { name: opts.title ?? 'export', data, format: opts.format, pages: 1 };
    },

    async outlineText(_text: string, _fontSize: number, _fontFamily: string): Promise<string> {
      // Stub: return the text as-is (no actual outlining).
      // Real outlining requires the Rust engine with ab_glyph.
      return JSON.stringify({
        error: 'Font outlining requires the native Tauri backend. ' +
          'See crates/strata-print/src/outline.rs for the Rust implementation.',
      });
    },
  };
}
