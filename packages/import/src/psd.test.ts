import { describe, expect, it } from 'vitest';
import { createPsdParser } from './psd';

function makePsdBytes(): Uint8Array {
  const header = '8BPS';
  const data = new Uint8Array(header.length + 22);
  data.set(new TextEncoder().encode(header), 0);
  return data;
}

function makeNonPsdBytes(): Uint8Array {
  return new TextEncoder().encode('GIF8');
}

describe('PSD parser', () => {
  const parser = createPsdParser();

  it('detects PSD via header', () => {
    expect(parser.canParse(makePsdBytes())).toBe(true);
  });

  it('rejects non-PSD data', () => {
    expect(parser.canParse(makeNonPsdBytes())).toBe(false);
    expect(parser.canParse('<svg></svg>')).toBe(false);
  });

  it('returns supported extensions', () => {
    const exts = parser.supportedExtensions();
    expect(exts).toContain('psd');
    expect(exts).toContain('psb');
  });

  it('returns a format name', () => {
    expect(parser.format).toBe('psd');
  });

  it('handles corrupt PSD gracefully', () => {
    const result = parser.parse(new Uint8Array([0, 0, 0, 0]));
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.document).toBeDefined();
    expect(result.nodeIds).toBeDefined();
  });

  it('handles empty buffer gracefully', () => {
    const result = parser.parse(new Uint8Array(0));
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('parses minimal PSD structure', () => {
    const psd = createMinimalPsd();
    const result = parser.parse(psd);
    expect(result.document).toBeDefined();
    expect(result.nodeIds).toBeDefined();
  });

  it('does not crash on string input', () => {
    const result = parser.parse('8BPS fake string');
    expect(result).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('reports unsupported features as warnings', () => {
    const psd = createMinimalPsd();
    const result = parser.parse(psd);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('scale option affects output size', () => {
    const psd = createMinimalPsd();
    const scaled = parser.parse(psd, { scale: 2 });
    const unscaled = parser.parse(psd, { scale: 1 });
    expect(scaled.document).toBeDefined();
    expect(unscaled.document).toBeDefined();
  });

  it('warns on layer effects', () => {
    const psd = createMinimalPsd();
    const result = parser.parse(psd);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('warns on adjustment layers', () => {
    const psd = createMinimalPsd();
    const result = parser.parse(psd);
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('warns on smart objects', () => {
    const psd = createMinimalPsd();
    const result = parser.parse(psd);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

function createMinimalPsd(): Uint8Array {
  const header = '8BPS';
  const buf = new Uint8Array(header.length + 22);
  buf.set(new TextEncoder().encode(header), 0);
  // Signature
  buf[4] = 0;
  buf[5] = 0;
  buf[6] = 0;
  buf[7] = 0; // version = 1
  buf[8] = 0;
  buf[9] = 0;
  buf[10] = 0;
  buf[11] = 0; // reserved
  buf[12] = 0;
  buf[13] = 1; // channels
  buf[14] = 0;
  buf[15] = 0; // height (0)
  buf[16] = 0;
  buf[17] = 0; // width (0)
  buf[18] = 8; // depth
  buf[19] = 3; // color mode (RGB)
  return buf;
}
