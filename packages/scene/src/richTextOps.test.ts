import { describe, expect, it } from 'vitest';
import {
  applyFormatToSelection,
  characterFormatValue,
  mergeAdjacentRuns,
  promoteToRichText,
  removeCharacterFormat,
  replaceTextInParagraph,
  splitRunAt,
} from './richTextOps';
import type { RichText, TextRun } from './typography';

function rich(...runs: TextRun[]): RichText {
  return { paragraphs: [{ runs }] };
}

describe('richTextOps', () => {
  describe('splitRunAt', () => {
    it('splits a run at the given offset', () => {
      const [a, b] = splitRunAt({ text: 'Hello', format: { fontWeight: 400 } }, 2);
      expect(a.text).toBe('He');
      expect(b.text).toBe('llo');
      expect(a.format).toEqual({ fontWeight: 400 });
      expect(b.format).toEqual({ fontWeight: 400 });
    });

    it('clamps offset to bounds', () => {
      const [a, b] = splitRunAt({ text: 'Hi' }, 99);
      expect(a.text).toBe('Hi');
      expect(b.text).toBe('');
    });

    it('does not split an extended grapheme cluster', () => {
      const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}';
      const [a, b] = splitRunAt({ text: `A${family}B` }, 3);
      expect(a.text).toBe('A');
      expect(b.text).toBe(`${family}B`);
    });
  });

  describe('mergeAdjacentRuns', () => {
    it('merges adjacent runs with identical format', () => {
      const para = mergeAdjacentRuns({
        runs: [
          { text: 'He', format: { fontWeight: 400 } },
          { text: 'llo', format: { fontWeight: 400 } },
        ],
      });
      expect(para.runs).toHaveLength(1);
      expect(para.runs[0]!.text).toBe('Hello');
    });

    it('keeps runs with different format separate', () => {
      const para = mergeAdjacentRuns({
        runs: [
          { text: 'He', format: { fontWeight: 400 } },
          { text: 'llo', format: { fontWeight: 700 } },
        ],
      });
      expect(para.runs).toHaveLength(2);
    });
  });

  describe('applyFormatToSelection', () => {
    it('applies bold to a selected range within a single run', () => {
      const result = applyFormatToSelection(
        rich({ text: 'Hello World' }),
        { start: { paragraphIndex: 0, offset: 6 }, end: { paragraphIndex: 0, offset: 11 } },
        { fontWeight: 700 },
      );
      expect(result.paragraphs[0]!.runs).toEqual([
        { text: 'Hello ' },
        { text: 'World', format: { fontWeight: 700 } },
      ]);
    });

    it('handles selection spanning multiple runs', () => {
      // After the format is applied, the merge step collapses adjacent runs
      // that share the same format into a single run.
      const result = applyFormatToSelection(
        rich(
          { text: 'Hello ', format: { fontWeight: 400 } },
          { text: 'World', format: { fontWeight: 400 } },
        ),
        { start: { paragraphIndex: 0, offset: 3 }, end: { paragraphIndex: 0, offset: 8 } },
        { fontWeight: 700 },
      );
      const runs = result.paragraphs[0]!.runs;
      expect(runs).toHaveLength(3);
      expect(runs[0]!.text).toBe('Hel');
      expect(runs[0]!.format).toEqual({ fontWeight: 400 });
      expect(runs[1]!.text).toBe('lo Wo');
      expect(runs[1]!.format).toEqual({ fontWeight: 700 });
      expect(runs[2]!.text).toBe('rld');
      expect(runs[2]!.format).toEqual({ fontWeight: 400 });
    });

    it('normalizes reversed selection', () => {
      const result = applyFormatToSelection(
        rich({ text: 'Hello' }),
        { start: { paragraphIndex: 0, offset: 4 }, end: { paragraphIndex: 0, offset: 1 } },
        { fontWeight: 700 },
      );
      expect(result.paragraphs[0]!.runs[0]!.text).toBe('H');
      expect(result.paragraphs[0]!.runs[1]!.text).toBe('ell');
      expect(result.paragraphs[0]!.runs[1]!.format).toEqual({ fontWeight: 700 });
    });

    it('expands a selection that lands inside a ZWJ grapheme', () => {
      const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}';
      const result = applyFormatToSelection(
        rich({ text: `A${family}B` }),
        { start: { paragraphIndex: 0, offset: 3 }, end: { paragraphIndex: 0, offset: 4 } },
        { fontWeight: 700 },
      );
      expect(result.paragraphs[0]!.runs).toEqual([
        { text: 'A' },
        { text: family, format: { fontWeight: 700 } },
        { text: 'B' },
      ]);
    });
  });

  describe('promoteToRichText', () => {
    it('creates a single-paragraph rich text from plain text', () => {
      const r = promoteToRichText(undefined, 'Hello');
      expect(r.paragraphs).toHaveLength(1);
      expect(r.paragraphs[0]!.runs[0]!.text).toBe('Hello');
    });

    it('splits on newlines into paragraphs', () => {
      const r = promoteToRichText(undefined, 'Line 1\nLine 2');
      expect(r.paragraphs).toHaveLength(2);
      expect(r.paragraphs[0]!.runs[0]!.text).toBe('Line 1');
      expect(r.paragraphs[1]!.runs[0]!.text).toBe('Line 2');
    });

    it('returns existing rich text unchanged', () => {
      const existing = rich({ text: 'Existing' });
      expect(promoteToRichText(existing, 'New')).toBe(existing);
    });
  });

  it('removes only requested character properties from a selection', () => {
    const rich = {
      paragraphs: [{ runs: [{ text: 'Hello', format: { fontWeight: 700, fontSize: 20 } }] }],
    };
    const next = removeCharacterFormat(
      rich,
      { start: { paragraphIndex: 0, offset: 1 }, end: { paragraphIndex: 0, offset: 4 } },
      ['fontWeight'],
    );
    expect(next.paragraphs[0]?.runs).toEqual([
      { text: 'H', format: { fontWeight: 700, fontSize: 20 } },
      { text: 'ell', format: { fontSize: 20 } },
      { text: 'o', format: { fontWeight: 700, fontSize: 20 } },
    ]);
  });

  it('reports mixed character values across selected runs', () => {
    const richText = rich(
      { text: 'A', format: { fontSize: 12 } },
      { text: 'B', format: { fontSize: 24 } },
    );
    expect(
      characterFormatValue(
        richText,
        { start: { paragraphIndex: 0, offset: 0 }, end: { paragraphIndex: 0, offset: 2 } },
        'fontSize',
      ),
    ).toEqual({
      value: 12,
      mixed: true,
    });
  });

  it('replaces text at grapheme boundaries and inherits the range style', () => {
    const rich = { paragraphs: [{ runs: [{ text: 'a\u0301b', format: { fontSize: 20 } }] }] };
    const next = replaceTextInParagraph(rich, 0, 1, 2, 'X');
    expect(next.paragraphs[0]?.runs).toEqual([{ text: 'Xb', format: { fontSize: 20 } }]);
  });
});
