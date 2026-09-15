import { addNode, createDocument, type TextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { graphemeClusterOffsets, snapToGraphemeBoundary } from './grapheme';
import { replaceAll } from './replace';
import { searchInDocument } from './search';
import { DEFAULT_SEARCH_OPTIONS } from './types';

function makeTextDocument(text: string) {
  const node: TextNode = {
    id: 'text-1',
    kind: 'text',
    name: 'Body',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    rotation: 0,
    order: 'a0',
    text,
    transform: [1, 0, 0, 1, 0, 0],
    fill: { space: 'rgb', r: 16, g: 21, b: 31, a: 255 },
    fontSize: 16,
    strokes: [],
    effects: [],
  };
  return addNode(createDocument('Find and replace', true), node);
}

describe('find and replace', () => {
  it('replaces every match without invalidating later offsets', () => {
    const doc = makeTextDocument('cat cat cat');
    const result = replaceAll(
      doc,
      'cat',
      'hippopotamus',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );

    expect(result.count).toBe(3);
    expect(result.doc.nodes['text-1']?.kind).toBe('text');
    expect((result.doc.nodes['text-1'] as TextNode).text).toBe(
      'hippopotamus hippopotamus hippopotamus',
    );
  });

  it('expands regex capture groups during replace all', () => {
    const doc = makeTextDocument('foo-12 foo-7');
    const result = replaceAll(
      doc,
      String.raw`(foo)-(\d+)`,
      '$2:$1',
      { ...DEFAULT_SEARCH_OPTIONS, useRegex: true },
      'document',
      [],
      false,
      false,
      false,
    );

    expect(result.count).toBe(2);
    expect((result.doc.nodes['text-1'] as TextNode).text).toBe('12:foo 7:foo');
  });

  it('returns useful context on both sides of a match', () => {
    const doc = makeTextDocument('prefix target suffix');
    const result = searchInDocument(
      doc,
      'target',
      DEFAULT_SEARCH_OPTIONS,
      'document',
      [],
      false,
      false,
      false,
    );

    expect(result.results[0]?.contextSnippet).toBe('prefix target suffix');
  });

  it('snaps UTF-16 offsets to grapheme cluster boundaries', () => {
    const text = 'a\u0301b';
    expect(graphemeClusterOffsets(text)).toEqual([0, 2]);
    expect(snapToGraphemeBoundary(text, 1, 'start')).toBe(0);
    expect(snapToGraphemeBoundary(text, 1, 'end')).toBe(2);
  });
});
