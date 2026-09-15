import { beforeEach, describe, expect, it } from 'vitest';
import { registerParser, resetRegistry } from './registry';
import type { ImportParser } from './types';
import { validateImport } from './validation';

function makeValidationParser(
  format: string,
  extensions: string[],
  canParse: (data: string | Uint8Array) => boolean,
): ImportParser {
  return {
    format,
    supportedExtensions: () => extensions,
    canParse,
    parse: () => ({
      document: {
        id: '',
        name: '',
        formatVersion: '1',
        rootChildren: [],
        nodes: {},
        components: {},
        nextId: 1,
      },
      nodeIds: [],
      warnings: [],
    }),
  };
}

describe('validateImport', () => {
  beforeEach(() => {
    resetRegistry();
    registerParser(
      makeValidationParser('svg', ['svg'], (data) => {
        const str = typeof data === 'string' ? data : new TextDecoder().decode(data);
        return str.trim().startsWith('<svg');
      }),
    );
    registerParser(
      makeValidationParser('pdf', ['pdf'], (data) => {
        if (typeof data === 'string') return false;
        return new TextDecoder().decode(data.slice(0, 5)) === '%PDF-';
      }),
    );
  });

  it('detects format from filename extension', async () => {
    const result = await validateImport('<svg><rect/></svg>', 'drawing.svg');
    expect(result.valid).toBe(true);
    expect(result.format).toBe('svg');
  });

  it('reports unsupported features', async () => {
    const parser: ImportParser = {
      format: 'test',
      supportedExtensions: () => ['test'],
      canParse: () => true,
      parse: () => {
        const doc = {
          id: '',
          name: '',
          formatVersion: '1',
          rootChildren: ['n1'],
          nodes: { n1: { id: 'n1', kind: 'shape' as const, index: 0, name: 'Test' } },
          components: {},
          nextId: 2,
        };
        return {
          document: doc as never,
          nodeIds: ['n1'],
          warnings: ['Gradient fill unsupported', 'Pattern fill unsupported'],
        };
      },
    };
    resetRegistry();
    registerParser(parser);
    const result = await validateImport(new Uint8Array([0, 0, 0, 0, 0]), 'file.test');
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it('estimates node count from structure analysis', async () => {
    const result = await validateImport(
      '<svg><rect/><circle/><text>hi</text></svg>',
      'drawing.svg',
    );
    expect(result.estimatedNodeCount).toBeGreaterThanOrEqual(1);
  });

  it('handles empty file gracefully', async () => {
    resetRegistry();
    registerParser(makeValidationParser('svg', ['svg'], () => false));
    const result = await validateImport(new Uint8Array(0), 'empty.svg');
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles corrupt file gracefully', async () => {
    resetRegistry();
    registerParser(makeValidationParser('pdf', ['pdf'], () => false));
    const result = await validateImport(new Uint8Array([255, 255, 255, 255]), 'corrupt.pdf');
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns invalid for unknown format', async () => {
    resetRegistry();
    const result = await validateImport(new Uint8Array([1, 2, 3, 4]), 'unknown.xyz');
    expect(result.valid).toBe(false);
    expect(result.format).toBe('xyz');
    expect(
      result.warnings.some(
        (w) => w.includes('Unknown') || w.includes('unknown') || w.includes('No parser'),
      ),
    ).toBe(true);
  });
});
