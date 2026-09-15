/**
 * Deterministic CSV/TSV/Markdown parsing and formula-safe export.
 */
import { describe, expect, it } from 'vitest';
import {
  escapeSpreadsheetFormula,
  parseDelimitedText,
  parseMarkdownTable,
  toDelimitedText,
} from './delimited';

describe('parseDelimitedText', () => {
  it('parses plain TSV rows preserving empty cells', () => {
    const { rows, delimiter } = parseDelimitedText('a\tb\n\tc\n', { delimiter: '\t' });
    expect(delimiter).toBe('\t');
    expect(rows).toEqual([
      ['a', 'b'],
      ['', 'c'],
    ]);
  });

  it('detects the delimiter from the first line', () => {
    expect(parseDelimitedText('a,b,c\n1,2,3\n').delimiter).toBe(',');
    expect(parseDelimitedText('a\tb\n1\t2\n').delimiter).toBe('\t');
    expect(parseDelimitedText('a;b\n1;2\n').delimiter).toBe(';');
  });

  it('handles quoted fields with embedded delimiters, newlines, and escaped quotes', () => {
    const { rows } = parseDelimitedText('"hello, world","line1\nline2","say ""hi"""\n1,2,3\n', {
      delimiter: ',',
    });
    expect(rows[0]).toEqual(['hello, world', 'line1\nline2', 'say "hi"']);
    expect(rows[1]).toEqual(['1', '2', '3']);
  });

  it('preserves empty cells and pads ragged rows', () => {
    const { rows } = parseDelimitedText('a\tb\tc\n1\t2\nx\n', { delimiter: '\t' });
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
      ['x', '', ''],
    ]);
  });

  it('handles CRLF line endings', () => {
    const { rows } = parseDelimitedText('a\tb\r\nc\td\r\n', { delimiter: '\t' });
    expect(rows).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('rejects oversized input', () => {
    expect(() => parseDelimitedText('a'.repeat(51_000_000))).toThrow(/safety bound/);
  });

  it('bounds rows and columns with warnings', () => {
    const { rows, warnings } = parseDelimitedText('a\tb\tc\td\n1\t2\t3\t4\n', {
      delimiter: '\t',
      maxColumns: 3,
      maxRows: 1,
    });
    expect(rows[0]).toHaveLength(3);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('is lenient with malformed quotes (unterminated quote consumed to end)', () => {
    const { rows } = parseDelimitedText('a\t"unterminated\nb\tc', { delimiter: '\t' });
    expect(rows[0]).toEqual(['a', 'unterminated\nb\tc']);
  });

  it('empty input produces an empty matrix; whitespace is a field', () => {
    expect(parseDelimitedText('').rows).toEqual([]);
    expect(parseDelimitedText('   ').rows).toEqual([['   ']]);
  });

  it('never evaluates content (no formula execution possible)', () => {
    const { rows } = parseDelimitedText('=1+1\t=cmd()\t@SUM(A1)\n', { delimiter: '\t' });
    expect(rows[0]).toEqual(['=1+1', '=cmd()', '@SUM(A1)']);
  });
});

describe('parseMarkdownTable', () => {
  it('parses a GFM table, dropping the separator row', () => {
    const { rows } = parseMarkdownTable('| Name | Qty |\n| --- | ---: |\n| A | 1 |\n| B | 2 |');
    expect(rows).toEqual([
      ['Name', 'Qty'],
      ['A', '1'],
      ['B', '2'],
    ]);
  });

  it('handles escaped pipes in cells', () => {
    const { rows } = parseMarkdownTable('| a\\|b | c |\n| --- | --- |\n| x | y |');
    expect(rows[0]).toEqual(['a|b', 'c']);
  });

  it('returns an empty matrix for non-table input', () => {
    expect(parseMarkdownTable('just text').rows).toEqual([]);
  });
});

describe('formula-safe export', () => {
  it('escapes spreadsheet formula triggers with a leading quote', () => {
    expect(escapeSpreadsheetFormula('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeSpreadsheetFormula('+123')).toBe("'+123");
    expect(escapeSpreadsheetFormula('-5')).toBe("'-5");
    expect(escapeSpreadsheetFormula('@SUM')).toBe("'@SUM");
    expect(escapeSpreadsheetFormula('plain')).toBe('plain');
    expect(escapeSpreadsheetFormula('')).toBe('');
  });

  it('round trips a matrix through TSV export/parse', () => {
    const matrix = [
      ['Name', 'Notes'],
      ['A', 'has\ttab'],
      ['B', 'quote "inside"'],
    ];
    const tsv = toDelimitedText(matrix, '\t', { escapeFormulas: false });
    const { rows } = parseDelimitedText(tsv, { delimiter: '\t' });
    expect(rows).toEqual(matrix);
  });

  it('quotes fields containing the delimiter, quotes, or newlines', () => {
    const tsv = toDelimitedText([['a,b', 'say "hi"', 'x\ny']], ',', { escapeFormulas: false });
    expect(tsv).toBe('"a,b","say ""hi""","x\ny"');
  });

  it('applies the escape policy on export', () => {
    const tsv = toDelimitedText([['=1+1', 'ok']], '\t', { escapeFormulas: true });
    expect(tsv).toBe("'=1+1\tok");
  });
});
