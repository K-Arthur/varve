import { describe, expect, it } from 'vitest';
import { createRichTextIndex, findRichTextRun, normalizeRichTextRange } from './richTextIndex';

describe('rich text logical source index', () => {
  it('keeps paragraph and run ranges in logical source order', () => {
    const rich = {
      paragraphs: [{ runs: [{ text: 'A' }, { text: 'B' }] }, { runs: [{ text: 'C' }] }],
    };
    const index = createRichTextIndex(rich);
    expect(index.text).toBe('AB\nC');
    expect(index.paragraphs[1]).toMatchObject({ start: 3, end: 4, text: 'C' });
    expect(findRichTextRun(index, 0, 1)).toMatchObject({ runIndex: 1, start: 1, end: 2 });
  });

  it('normalizes selection endpoints to grapheme boundaries', () => {
    const paragraph = { runs: [{ text: 'a\u0301b' }] };
    expect(normalizeRichTextRange(paragraph, 1, 2)).toEqual({ start: 0, end: 2 });
  });
});
