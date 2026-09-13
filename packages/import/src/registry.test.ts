import { describe, expect, it } from 'vitest';
import { createAiParser } from './ai';
import { createPsdParser } from './psd';
import {
  getImportAcceptString,
  getParser,
  getParserForExtension,
  getParserForFile,
  listSupportedExtensions,
  listSupportedFormats,
  registerParser,
  resetRegistry,
} from './registry';
import { createSvgParser } from './svg';

describe('ImportRegistry', () => {
  it('registers and retrieves a parser by format name', () => {
    resetRegistry();
    const parser = createSvgParser();
    registerParser(parser);
    expect(getParser('svg')).toBe(parser);
  });

  it('returns undefined for unregistered format', () => {
    resetRegistry();
    expect(getParser('fig')).toBeUndefined();
  });

  it('finds parser by file extension', () => {
    resetRegistry();
    const parser = createSvgParser();
    registerParser(parser);
    expect(getParserForExtension('svg')).toBe(parser);
    expect(getParserForExtension('.svg')).toBe(parser);
    expect(getParserForExtension('SVG')).toBe(parser);
  });

  it('lists all supported formats', () => {
    resetRegistry();
    const parser = createSvgParser();
    registerParser(parser);
    const formats = listSupportedFormats();
    expect(formats).toContain('svg');
    expect(formats.length).toBe(1);
  });

  it('lists raster + parser extensions through the canonical source', () => {
    resetRegistry();
    registerParser(createSvgParser());
    const exts = listSupportedExtensions();
    // Raster fallback formats are always present even without a parser.
    for (const r of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'avif']) {
      expect(exts).toContain(r);
    }
    // Registered parser extensions are included.
    expect(exts).toContain('svg');
    // LUT formats are deliberately excluded from the scene-import list.
    expect(exts).not.toContain('cube');
  });

  it('builds an accept string covering raster, parsers and LUT formats', () => {
    resetRegistry();
    registerParser(createSvgParser());
    const accept = getImportAcceptString();
    expect(accept).toContain('.svg');
    expect(accept).toContain('.png');
    expect(accept).toContain('.cube');
    expect(accept.startsWith('.')).toBe(true);
  });

  it('keeps format-specific adapters ahead of generic container signatures', () => {
    resetRegistry();
    const svg = createSvgParser();
    const ai = createAiParser();
    const psd = createPsdParser();
    registerParser(svg);
    registerParser(ai);
    registerParser(psd);

    const pdfCompatibleAi = new TextEncoder().encode('%PDF-1.7\n% Illustrator wrapper');
    const largePhotoshop = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x02]);

    expect(getParserForFile('artwork.ai', pdfCompatibleAi)).toBe(ai);
    expect(getParserForFile('artwork.psb', largePhotoshop)).toBe(psd);
  });
});
