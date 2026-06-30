/**
 * @strata/print — Tauri native backend.
 *
 * Calls the strata-print Rust crate via Tauri IPC (window.__TAURI__.core.invoke)
 * for PDF assembly and font outlining. On web/stub environments, this file
 * should NOT be imported (tree-shaken via the facade in index.ts).
 *
 * Research basis: same pattern as @strata/engine's nativeEngine()
 * (packages/engine/src/engine.ts:80-98).
 */
import type { PdfExportOptions, PdfResult, PrintEngine } from './types';

function getCore(): { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } {
  const tauri = (window as unknown as { __TAURI__?: Record<string, unknown> }).__TAURI__;
  const core = tauri?.core as {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  if (!core?.invoke) throw new Error('Tauri core IPC not available');
  return core as { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
}

export function createNativePrintEngine(): PrintEngine {
  return {
    backend: 'native',

    async exportPdf(_docJson: string, _opts: PdfExportOptions): Promise<PdfResult> {
      const core = getCore();
      const format = _opts.format;
      const command =
        format === 'pdf-x1a'
          ? 'export_pdfx1a'
          : format === 'pdf-x4'
            ? 'export_pdfx4'
            : 'export_pdf';

      const data = await core.invoke(command, {
        docJson: _docJson,
        pageWidth: _opts.pageWidth ?? 1920,
        pageHeight: _opts.pageHeight ?? 1080,
        bleedMm: _opts.bleedMm ?? 3,
        includeCropMarks: _opts.includeCropMarks ?? false,
        includeRegistrationMarks: _opts.includeRegistrationMarks ?? false,
        enforceDpi: _opts.enforceDpi ?? 300,
        outlineText: _opts.outlineText ?? false,
      });

      const numbers = Array.isArray(data) ? (data as number[]) : [];
      return {
        name: _opts.title ?? 'export',
        data: new Uint8Array(numbers),
        format,
        pages: 1,
      };
    },

    async outlineText(text: string, fontSize: number, fontFamily: string): Promise<string> {
      const core = getCore();
      const result = String(await core.invoke('outline_text', { text, fontSize, fontFamily }));
      return result;
    },
  };
}
