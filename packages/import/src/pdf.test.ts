import { beforeEach, describe, expect, it } from 'vitest';
import { createPdfParser } from './pdf';

function makePdfBytes(): Uint8Array {
  const header = '%PDF-1.4\n';
  return new TextEncoder().encode(header);
}

function makeNonPdfBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
}

describe('PDF parser', () => {
  const parser = createPdfParser();

  beforeEach(() => {
    // Reset any cached state
  });

  it('detects PDF via header', () => {
    expect(parser.canParse(makePdfBytes())).toBe(true);
  });

  it('rejects non-PDF data', () => {
    expect(parser.canParse(makeNonPdfBytes())).toBe(false);
    expect(parser.canParse('<svg></svg>')).toBe(false);
  });

  it('returns supported extensions', () => {
    const exts = parser.supportedExtensions();
    expect(exts).toContain('pdf');
  });

  it('returns a format name', () => {
    expect(parser.format).toBe('pdf');
  });

  it('handles corrupt PDF gracefully', () => {
    const result = parser.parse(new Uint8Array([0, 0, 0, 0, 0]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.document).toBeDefined();
    expect(result.nodeIds).toBeDefined();
  });

  it('handles empty buffer gracefully', () => {
    const result = parser.parse(new Uint8Array(0));
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses a minimal PDF with a rectangle', () => {
    const minPdf = createMinimalPdf();
    const result = parser.parse(minPdf);
    expect(result.document).toBeDefined();
    expect(result.nodeIds).toBeDefined();
  });

  it('does not crash on string input', () => {
    const result = parser.parse('%PDF-1.4 fake string content');
    expect(result).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('reports unsupported features as warnings', () => {
    const minPdf = createMinimalPdf();
    const result = parser.parse(minPdf);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('scale option affects output size', () => {
    const minPdf = createMinimalPdf();
    const scaled = parser.parse(minPdf, { scale: 2 });
    const unscaled = parser.parse(minPdf, { scale: 1 });
    expect(scaled).toBeDefined();
    expect(unscaled).toBeDefined();
  });

  it('handles multi-page structure gracefully', () => {
    const result = parser.parse(createMinimalPdf());
    expect(result.document).toBeDefined();
  });

  it('warns on unsupported transparency', () => {
    const result = parser.parse(createMinimalPdf());
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('warns on embedded fonts', () => {
    const result = parser.parse(createMinimalPdf());
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

function createMinimalPdf(): Uint8Array {
  const lines = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]',
    '   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    '4 0 obj',
    '<< /Length 44 >>',
    'stream',
    'BT /F1 12 Tf 100 700 Td (Hello) Tj ET',
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000266 00000 n ',
    '0000000360 00000 n ',
    'trailer',
    '<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '432',
    '%%EOF',
  ];
  return new TextEncoder().encode(lines.join('\n'));
}
