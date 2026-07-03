import { beforeEach, describe, expect, it } from 'vitest';
import { createEpsParser } from './eps';
import { registerParser, resetRegistry } from './registry';
import { createSvgParser } from './svg';

describe('EPS parser', () => {
  beforeEach(() => {
    resetRegistry();
    registerParser(createSvgParser());
  });

  const parser = createEpsParser();

  it('detects EPS via PostScript header', () => {
    const data = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0');
    expect(parser.canParse(data)).toBe(true);
  });

  it('detects EPS via alternative header', () => {
    const data = new TextEncoder().encode('%%BoundingBox: 0 0 100 100');
    expect(parser.canParse(data)).toBe(true);
  });

  it('rejects non-EPS data', () => {
    expect(parser.canParse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(parser.canParse('<svg></svg>')).toBe(false);
  });

  it('returns supported extensions', () => {
    const exts = parser.supportedExtensions();
    expect(exts).toContain('eps');
    expect(exts).toContain('epsf');
  });

  it('returns a format name', () => {
    expect(parser.format).toBe('eps');
  });

  it('handles corrupt EPS gracefully', () => {
    const result = parser.parse(new Uint8Array([0, 0, 0, 0]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.document).toBeDefined();
  });

  it('handles empty buffer gracefully', () => {
    const result = parser.parse(new Uint8Array(0));
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses basic EPS content with rectangle', () => {
    const epsContent = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 200 150
%%Title: Test EPS
0 0 200 150 rectfill
%%EOF`;
    const result = parser.parse(new TextEncoder().encode(epsContent));
    expect(result.document).toBeDefined();
    expect(Array.isArray(result.nodeIds)).toBe(true);
  });

  it('parses EPS with text content', () => {
    const epsContent = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 400 300
/Times-Roman findfont 24 scalefont setfont
100 200 moveto (Hello World) show
%%EOF`;
    const result = parser.parse(new TextEncoder().encode(epsContent));
    expect(result.document).toBeDefined();
  });

  it('warns about unsupported EPS features', () => {
    const epsContent = `%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 400 300
clippath stroke
%%EOF`;
    const result = parser.parse(new TextEncoder().encode(epsContent));
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});
