import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativePrintEngine } from './native';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native print command arguments', () => {
  it.each([
    ['pdf-screen', 'export_pdf_with_options'],
    ['pdf-x1a', 'export_pdfx1a'],
    ['pdf-x4', 'export_pdfx4'],
  ] as const)('passes actual camelCase command arguments for %s', async (format, command) => {
    const manifestJson = JSON.stringify({ images: [], patterns: [] });
    const invoke = vi.fn(async (_command: string, args: Record<string, unknown>) => {
      // Default #[tauri::command] arguments are camelCase, independently of
      // the serialized fields inside optionsJson and manifestJson.
      expect(_command).toBe(command);
      expect(args.nodesJson).toBe('[]');
      expect(args.pageHeight).toBe(80);
      expect(args.optionsJson).toEqual(expect.any(String));
      expect(args.manifestJson).toBe(manifestJson);
      expect(Object.keys(args).some((key) => key.includes('_'))).toBe(false);
      return [37, 80, 68, 70];
    });
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
    const result = await createNativePrintEngine().exportPdf('[]', {
      format,
      pageWidth: 104,
      pageHeight: 80,
      manifestJson,
    });
    expect(result.data).toEqual(new Uint8Array([37, 80, 68, 70]));
  });

  it('passes native outlining arguments with the same command naming contract', async () => {
    const invoke = vi.fn(async (_command: string, args: Record<string, unknown>) => {
      expect(args).toEqual({ text: 'Poster', fontData: [1, 2], fontSize: 16 });
      return '[]';
    });
    vi.stubGlobal('window', { __TAURI__: { core: { invoke } } });
    await createNativePrintEngine().outlineText('Poster', 16, new Uint8Array([1, 2]));
    expect(invoke).toHaveBeenCalledWith('outline_text', expect.any(Object));
  });
});
