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
      const pageHeight = _opts.pageHeight ?? 1080;
      const optionsJson = JSON.stringify({
        pageWidth: _opts.pageWidth ?? 1920,
        pageHeight,
        title: _opts.title ?? 'Strata Export',
        author: _opts.author ?? 'Strata',
        bleedMm: _opts.bleedMm ?? 3,
        includeCropMarks: _opts.includeCropMarks ?? false,
        includeRegistrationMarks: _opts.includeRegistrationMarks ?? false,
        enforceDpi: _opts.enforceDpi ?? 300,
        outlineText: _opts.outlineText ?? false,
        iccProfile: _opts.iccProfile ?? 'Fogra39',
        colorBars: _opts.colorBars ?? false,
        format,
        useCmyk: _opts.useCmyk ?? false,
      });

      let command: string;
      let useCmyk = _opts.useCmyk ?? false;

      if (format === 'pdf-x1a') {
        command = 'export_pdfx1a';
        useCmyk = true;
      } else if (format === 'pdf-x4') {
        command = 'export_pdfx4';
      } else {
        command = 'export_pdf_with_options';
      }

      const data = await core.invoke(command, {
        nodes_json: _docJson,
        page_height: pageHeight,
        use_cmyk: useCmyk,
        options_json: optionsJson,
      });

      const numbers = Array.isArray(data) ? (data as number[]) : [];
      return {
        name: _opts.title ?? 'export',
        data: new Uint8Array(numbers),
        format,
        pages: 1,
      };
    },

    async outlineText(text: string, fontSize: number, fontData: Uint8Array): Promise<string> {
      const core = getCore();
      const result = String(
        await core.invoke('outline_text', {
          text,
          font_data: Array.from(fontData),
          font_size: fontSize,
        }),
      );
      return result;
    },
  };
}
