import { beforeEach, describe, expect, it } from 'vitest';
import { createAiParser } from './ai';
import { registerParser, resetRegistry } from './registry';
import { createSvgParser } from './svg';

describe('AI parser', () => {
  beforeEach(() => {
    resetRegistry();
    registerParser(createSvgParser());
  });

  const parser = createAiParser();

  it('detects AI via PDF header', () => {
    const data = new TextEncoder().encode('%PDF-1.6 AI file content');
    expect(parser.canParse(data)).toBe(true);
  });

  it('detects AI via EPS header', () => {
    const data = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0');
    expect(parser.canParse(data)).toBe(true);
  });

  it('rejects non-AI data', () => {
    expect(parser.canParse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(parser.canParse('<svg></svg>')).toBe(false);
  });

  it('returns supported extensions', () => {
    const exts = parser.supportedExtensions();
    expect(exts).toContain('ai');
  });

  it('returns a format name', () => {
    expect(parser.format).toBe('ai');
  });

  it('handles corrupt AI gracefully', () => {
    const result = parser.parse(new Uint8Array([0, 0, 0, 0]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.document).toBeDefined();
  });

  it('handles empty buffer gracefully', () => {
    const result = parser.parse(new Uint8Array(0));
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses AI file with embedded SVG content via PDF wrapper', () => {
    const aiContent = `%PDF-1.6
%\xC2\xA5\xC2\xB1\xC3\xAB
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300]
   /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (AI content) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
350
%%EOF`;
    const result = parser.parse(new TextEncoder().encode(aiContent));
    expect(result.document).toBeDefined();
    expect(Array.isArray(result.nodeIds)).toBe(true);
  });

  it('warns about AI-specific features that may lose fidelity', () => {
    const data = new TextEncoder().encode('%PDF-1.6 fake');
    const result = parser.parse(data);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
