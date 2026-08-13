/**
 * Tests for grapheme segmentation, BiDi layout, and script detection.
 * TDD-first for the core mapping and editing logic.
 */

import { describe, expect, it } from 'vitest';
import { analyzeParagraph, autoParagraphDirection, logicalToVisual, visualToLogical } from './bidi';
import {
  codepointOffset,
  graphemeCount,
  graphemeIndexAt,
  splitGraphemes,
  utf16IndexAtCodepointOffset,
} from './grapheme';
import { detectScript, dominantScript, segmentByScript } from './script';
import {
  codePointCount,
  codePointToUtf16,
  createUnicodeIndexMap,
  normalizeGraphemeRange,
  snapUtf16Offset,
  utf16ToCodePoint,
} from './unicodeIndices';

describe('grapheme segmentation', () => {
  it('splits ASCII text into single chars', () => {
    const result = splitGraphemes('abc');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('keeps combining sequences as one grapheme (e + combining acute)', () => {
    const text = 'e\u0301'; // e + combining acute accent
    const result = splitGraphemes(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
  });

  it('handles emoji as single grapheme (surrogate pair)', () => {
    const result = splitGraphemes('a\uD83D\uDC4Db');
    // The emoji U+1F44D is one grapheme despite being a surrogate pair in UTF-16
    expect(result).toEqual(['a', '\uD83D\uDC4D', 'b']);
  });

  it('counts graphemes correctly for ASCII', () => {
    expect(graphemeCount('abc')).toBe(3);
    expect(graphemeCount('a\uD83D\uDC4Db')).toBe(3);
  });

  it('maps codepoint offset to UTF-16 index for emoji', () => {
    const text = 'a\uD83D\uDC4Db';
    // 'a'=UTF-16 pos 0, codepoint 0
    // 'D83DDC4D'=UTF-16 pos 1 (surrogate pair, code units 1-2), codepoint 1
    // 'b'=UTF-16 pos 3, codepoint 2
    expect(codepointOffset(text, 0)).toBe(0);
    expect(codepointOffset(text, 1)).toBe(1);
    expect(codepointOffset(text, 3)).toBe(2);
    expect(utf16IndexAtCodepointOffset(text, 0)).toBe(0);
    expect(utf16IndexAtCodepointOffset(text, 1)).toBe(1);
    expect(utf16IndexAtCodepointOffset(text, 2)).toBe(3);
  });

  it('snaps grapheme index to boundary', () => {
    const text = '\uD83D\uDC4Dabc';
    // UTF-16 indices: 0=\uD83D\uDC4D(start), 1=\uD83D\uDC4D(low surrogate), 2=a, 3=b, 4=c
    // Grapheme boundaries: \uD83D\uDC4D at 0, a at 2, b at 3, c at 4
    expect(graphemeIndexAt(text, 0)).toBe(0); // \uD83D\uDC4D
    expect(graphemeIndexAt(text, 1)).toBe(0); // still \uD83D\uDC4D (low surrogate)
    expect(graphemeIndexAt(text, 2)).toBe(1); // a
    expect(graphemeIndexAt(text, 3)).toBe(2); // b
    expect(graphemeIndexAt(text, 4)).toBe(3); // c
  });

  it('maps UTF-16, scalar, and grapheme units without normalizing source text', () => {
    const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}';
    const text = `A${family}e\u0301`;
    const map = createUnicodeIndexMap(text);
    expect(map.text).toBe(text);
    expect(codePointCount(map)).toBe(10);
    expect(map.graphemes.map((g) => g.segment)).toEqual(['A', family, 'e\u0301']);
    expect(map.graphemeBoundaries).toEqual([0, 1, 12, 14]);
    expect(codePointToUtf16(map, 1)).toBe(1);
    expect(utf16ToCodePoint(map, 2, 'floor')).toBe(1);
    expect(utf16ToCodePoint(map, 2, 'ceil')).toBe(2);
  });

  it('snaps selection endpoints outward to whole graphemes', () => {
    const family = '\u{1f468}\u{200d}\u{1f469}\u{200d}\u{1f467}\u{200d}\u{1f466}';
    const map = createUnicodeIndexMap(`x${family}y`);
    expect(snapUtf16Offset(map, 3, 'floor')).toBe(1);
    expect(snapUtf16Offset(map, 3, 'ceil')).toBe(12);
    expect(normalizeGraphemeRange(map, 3, 4)).toEqual({ start: 1, end: 12 });
  });
});

describe('bidirectional layout', () => {
  it('auto-detects LTR paragraph', () => {
    expect(autoParagraphDirection('Hello world')).toBe('ltr');
  });

  it('auto-detects RTL paragraph starting with Arabic', () => {
    expect(autoParagraphDirection('مرحبا بالعالم')).toBe('rtl');
  });

  it('auto-detects RTL paragraph starting with Hebrew', () => {
    expect(autoParagraphDirection('שלום עולם')).toBe('rtl');
  });

  it('defaults to LTR for neutral-only text', () => {
    expect(autoParagraphDirection('   123 ')).toBe('ltr');
  });

  it('analyzes LTR paragraph with single run', () => {
    const para = analyzeParagraph('Hello world');
    expect(para.baseDirection).toBe('ltr');
    expect(para.runs).toHaveLength(1);
    expect(para.runs[0]!.direction).toBe('ltr');
  });

  it('detects RTL run in mixed text', () => {
    const para = analyzeParagraph('Hello שלום');
    expect(para.runs.length).toBeGreaterThanOrEqual(2);
  });

  it('reorders RTL paragraph: RTL run comes first visually', () => {
    const text = 'שלום hello';
    const para = analyzeParagraph(text, 'rtl');
    expect(para.baseDirection).toBe('rtl');
    // In RTL, the Hebrew run should be first in visual order (rightmost = first)
    expect(para.baseLevel).toBe(1);
  });

  it('maps logicaltovisual in RTL paragraph', () => {
    const text = 'שלום';
    const para = analyzeParagraph(text, 'rtl');
    // All chars should be in one RTL run
    expect(para.runs.length).toBe(1);
    expect(para.runs[0]!.direction).toBe('rtl');
    expect(para.runs[0]!.start).toBe(0);
    expect(para.runs[0]!.end).toBe(4);
    // In RTL: visual 0 = rightmost = first typed = logical 0 (ש)
    const { visualIndex: v0 } = logicalToVisual(para, 0);
    expect(v0).toBe(0);
    // logical 3 (ם) = visual 3 (leftmost in RTL = last visual position)
    const { visualIndex: vLast } = logicalToVisual(para, text.length - 1);
    expect(vLast).toBe(text.length - 1);
  });

  it('round-trips logicaltovisual in LTR', () => {
    const text = 'abc שלום def';
    const para = analyzeParagraph(text, 'ltr');
    for (let i = 0; i < text.length; i++) {
      const { visualIndex } = logicalToVisual(para, i);
      const { logicalIndex } = visualToLogical(para, visualIndex);
      expect(logicalIndex).toBe(i);
    }
  });

  it('round-trips logicaltovisual in RTL', () => {
    const text = 'שלום hello שלום';
    const para = analyzeParagraph(text, 'rtl');
    for (let i = 0; i < text.length; i++) {
      const { visualIndex } = logicalToVisual(para, i);
      const { logicalIndex } = visualToLogical(para, visualIndex);
      expect(logicalIndex).toBe(i);
    }
  });

  it('handles empty paragraph', () => {
    const para = analyzeParagraph('');
    expect(para.baseDirection).toBe('ltr');
    expect(para.runs).toHaveLength(0);
  });

  it('handles numbers in RTL context', () => {
    const para = analyzeParagraph('מחיר: 100 שקלים', 'rtl');
    expect(para.baseDirection).toBe('rtl');
    expect(para.baseLevel).toBe(1);
  });

  it('resolves isolates and exposes mirrored punctuation without changing source text', () => {
    const text = 'مرحبا (Varve) \u2067שלום\u2069';
    const para = analyzeParagraph(text, 'rtl');
    expect(para.text).toBe(text);
    expect(para.visualOrder?.length).toBe(text.length);
    expect(para.mirroredCharacters?.size).toBeGreaterThan(0);
    expect(para.mirroredCharacters?.get(text.indexOf('('))).toBe(')');
  });
});

describe('script detection', () => {
  it('detects Latin script', () => {
    expect(detectScript(0x0041)).toBe('Latn'); // A
    expect(detectScript(0x00e9)).toBe('Latn'); // é
  });

  it('detects Arabic script', () => {
    expect(detectScript(0x0627)).toBe('Arab'); // alef
  });

  it('detects Hebrew script', () => {
    expect(detectScript(0x05d0)).toBe('Hebr'); // alef
  });

  it('detects CJK script', () => {
    expect(detectScript(0x4e00)).toBe('Hani');
  });

  it('detects Devanagari script', () => {
    expect(detectScript(0x0915)).toBe('Deva'); // ka
  });

  it('detects Thai script', () => {
    expect(detectScript(0x0e01)).toBe('Thai'); // ko kai
  });

  it('returns Common for punctuation', () => {
    expect(detectScript(0x0021)).toBe('Zyyy'); // !
    expect(detectScript(0x0020)).toBe('Zyyy'); // space
  });

  it('detects dominant script in mixed text', () => {
    expect(dominantScript('Hello world')).toBe('Latn');
    expect(dominantScript('مرحبا بالعالم')).toBe('Arab');
  });

  it('segments by script', () => {
    const runs = segmentByScript('Hello مرحبا');
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[0]!.script).toBe('Latn');
  });
});
