import { describe, expect, it } from 'vitest';
import {
  getParser,
  getParserForExtension,
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
});
