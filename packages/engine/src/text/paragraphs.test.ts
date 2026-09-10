import { describe, expect, it } from 'vitest';
import { createUnicodeIndexMap } from '../unicode/unicodeIndices';
import { BIDI_FIXTURES, SCRIPT_FIXTURES } from './fixtures';
import { itemizeParagraph, itemizeText, splitParagraphs } from './paragraphs';

describe('splitParagraphs', () => {
  it('splits on newlines with document offsets', () => {
    const ranges = splitParagraphs('abc\ndef');
    expect(ranges.map((r) => [r.index, r.start, r.end, r.text])).toEqual([
      [0, 0, 3, 'abc'],
      [1, 4, 7, 'def'],
    ]);
  });

  it('keeps a trailing empty paragraph after a final newline', () => {
    const ranges = splitParagraphs('ab\n');
    expect(ranges).toHaveLength(2);
    expect(ranges[1]).toMatchObject({ index: 1, start: 3, end: 3, text: '' });
  });

  it('returns no paragraphs for an empty string', () => {
    expect(splitParagraphs('')).toEqual([]);
  });
});

describe('itemizeText', () => {
  it('resolves base direction per paragraph (first-strong)', () => {
    const itemized = itemizeText('Hello\nمرحبا');
    expect(itemized.paragraphs).toHaveLength(2);
    expect(itemized.paragraphs[0]!.baseDirection).toBe('ltr');
    expect(itemized.paragraphs[1]!.baseDirection).toBe('rtl');
    expect(itemized.paragraphs[1]!.baseLevel).toBe(1);
  });

  it('applies an explicit paragraph direction override', () => {
    const itemized = itemizeText('Hello', 'rtl');
    expect(itemized.paragraphs[0]!.baseDirection).toBe('rtl');
    expect(itemized.paragraphs[0]!.baseLevel).toBe(1);
  });

  it('keeps source text logical and unmodified for RTL paragraphs', () => {
    const itemized = itemizeText(BIDI_FIXTURES.helloVarve);
    const paragraph = itemized.paragraphs[0]!;
    expect(paragraph.text).toBe('مرحبا Varve 2026!');
    expect(paragraph.baseDirection).toBe('rtl');
    expect(paragraph.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('exposes per-code-unit levels for line-local reordering', () => {
    const itemized = itemizeText(BIDI_FIXTURES.priceInArabic);
    const paragraph = itemized.paragraphs[0]!;
    expect(paragraph.levels).toHaveLength(paragraph.text.length);
    expect(paragraph.levels[0]).toBe(0);
    const arabicStart = paragraph.text.indexOf('دولار');
    expect(paragraph.levels[arabicStart]).toBe(1);
  });

  it('mirrors punctuation without touching source text', () => {
    const itemized = itemizeText('(abc)');
    expect(itemized.paragraphs[0]!.text).toBe('(abc)');
  });
});

describe('scriptedRuns', () => {
  it('itemizes a mixed Arabic/Latin paragraph into script runs', () => {
    const paragraph = itemizeParagraph(
      { index: 0, start: 0, end: 0, text: 'abc 123 عربي' },
      'auto',
    );
    const scripts = paragraph.scriptedRuns.map((run) => run.script);
    expect(scripts[0]).toBe('Latn');
    expect(scripts[scripts.length - 1]).toBe('Arab');
  });

  it('absorbs combining marks into the surrounding run', () => {
    const paragraph = itemizeParagraph({ index: 0, start: 0, end: 0, text: 'e\u0301' }, 'auto');
    expect(paragraph.scriptedRuns).toHaveLength(1);
    expect(paragraph.scriptedRuns[0]!.start).toBe(0);
    expect(paragraph.scriptedRuns[0]!.end).toBe(2);
  });

  it('absorbs Arabic harakat despite their block classifying them as Arab', () => {
    // U+064B (fathatan) lives in the Arabic block, so detectScript reports
    // 'Arab'; as an Mn mark it must still attach to the base character
    // instead of splitting the grapheme into its own run.
    const paragraph = itemizeParagraph({ index: 0, start: 0, end: 0, text: 'a\u064b' }, 'auto');
    expect(paragraph.scriptedRuns).toHaveLength(1);
    expect(paragraph.scriptedRuns[0]!.start).toBe(0);
    expect(paragraph.scriptedRuns[0]!.end).toBe(2);
  });

  it('absorbs Arabic harakat into an Arabic base run', () => {
    const paragraph = itemizeParagraph({ index: 0, start: 0, end: 0, text: 'عَرَبِيَّة' }, 'auto');
    expect(paragraph.scriptedRuns).toHaveLength(1);
    expect(paragraph.scriptedRuns[0]!.script).toBe('Arab');
    expect(paragraph.scriptedRuns[0]!.end).toBe(paragraph.text.length);
  });

  it('never splits grapheme clusters across script runs', () => {
    for (const text of [
      SCRIPT_FIXTURES.emojiZwj,
      SCRIPT_FIXTURES.emojiFlag,
      SCRIPT_FIXTURES.devanagari,
      SCRIPT_FIXTURES.thai,
    ]) {
      const paragraph = itemizeParagraph({ index: 0, start: 0, end: 0, text }, 'auto');
      const map = createUnicodeIndexMap(text);
      const splitPoints = paragraph.scriptedRuns.flatMap((run) => [run.start, run.end]);
      for (const point of splitPoints) {
        expect(map.graphemeBoundaries).toContain(point);
      }
    }
  });

  it('produces script runs in logical order for BiDi paragraphs', () => {
    const paragraph = itemizeParagraph(
      { index: 0, start: 0, end: 0, text: BIDI_FIXTURES.helloVarve },
      'auto',
    );
    let cursor = 0;
    for (const run of paragraph.scriptedRuns) {
      expect(run.start).toBe(cursor);
      cursor = run.end;
    }
    expect(cursor).toBe(paragraph.text.length);
  });
});
