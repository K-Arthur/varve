/**
 * Page-range parsing and resolution (M13, ADR-0167).
 */

import { describe, expect, it } from 'vitest';
import type { Document } from '../document';
import { addPage, createDocument } from '../document';
import { PageRangeError, parsePageRange, resolvePageRangeExpression } from '../pageRange';

function fivePageDoc(): Document {
  let doc = createDocument('range', false);
  doc = addPage(doc, {});
  doc = addPage(doc, {});
  doc = addPage(doc, {});
  doc = addPage(doc, {});
  return doc;
}

describe('parsePageRange (M13)', () => {
  it('parses wildcard and empty as all', () => {
    expect(parsePageRange('')).toEqual({ kind: 'all' });
    expect(parsePageRange('*')).toEqual({ kind: 'all' });
  });

  it('parses current/selected/section', () => {
    expect(parsePageRange('current')).toEqual({ kind: 'current' });
    expect(parsePageRange('selected')).toEqual({ kind: 'selected' });
    expect(parsePageRange('section:Front Matter')).toEqual({
      kind: 'section',
      name: 'Front Matter',
    });
  });

  it('parses ranges, lists and parity', () => {
    expect(parsePageRange('1-3')).toEqual({
      kind: 'numbers',
      values: ['1', '2', '3'],
      parity: undefined,
    });
    expect(parsePageRange('1,3,7')).toEqual({ kind: 'numbers', values: ['1', '3', '7'] });
    expect(parsePageRange('1-5,8,10-12')).toEqual({
      kind: 'numbers',
      values: ['1', '2', '3', '4', '5', '8', '10', '11', '12'],
    });
    expect(parsePageRange('1-6 even')).toEqual({
      kind: 'numbers',
      values: ['1', '2', '3', '4', '5', '6'],
      parity: 'even',
    });
  });

  it('parses prefixed display numbers', () => {
    expect(parsePageRange('A-1–A-3')).toEqual({
      kind: 'prefixes',
      prefix: 'A-',
      values: ['1', '2', '3'],
    });
  });

  it('rejects malformed input', () => {
    expect(() => parsePageRange('abc')).toThrow(PageRangeError);
    expect(() => parsePageRange('3-1')).toThrow(PageRangeError);
    expect(() => parsePageRange('odd')).toThrow(PageRangeError);
    expect(() => parsePageRange('1-3,A-5')).toThrow(PageRangeError);
  });
});

describe('resolvePageRangeExpression (M13)', () => {
  it('resolves numbers against display numbering', () => {
    const doc = fivePageDoc();
    const ids = resolvePageRangeExpression(doc, '2-3');
    expect(ids.map((id) => doc.pages!.findIndex((p) => p.id === id) + 1)).toEqual([2, 3]);
  });

  it('resolves parity filters', () => {
    const doc = fivePageDoc();
    const even = resolvePageRangeExpression(doc, '1-5 even');
    expect(even.map((id) => doc.pages!.findIndex((p) => p.id === id) + 1)).toEqual([2, 4]);
  });

  it('resolves current from context', () => {
    const doc = fivePageDoc();
    const ids = resolvePageRangeExpression(doc, 'current', { activePageId: doc.pages![3]!.id });
    expect(ids).toEqual([doc.pages![3]!.id]);
  });

  it('resolves all', () => {
    const doc = fivePageDoc();
    expect(resolvePageRangeExpression(doc, '*')).toHaveLength(5);
  });
});
