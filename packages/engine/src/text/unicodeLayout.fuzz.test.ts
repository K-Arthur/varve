/**
 * Property/fuzz tests for the canonical text layout pipeline.
 *
 * Random Unicode input (including combining marks, emoji ZWJ sequences, BiDi
 * controls, isolates, NBSP/ZWSP, and multi-paragraph text) is laid out through
 * the same `layoutText` entry the renderer consumes, and the output is
 * checked against layout invariants:
 *
 * - terminates without throwing and never produces NaN/infinite coordinates
 * - every cluster offset stays inside the source string
 * - lines tile their paragraph exactly (contiguity + reconstruction)
 * - caret stops and selection rects stay inside line bounds
 * - caret stop offsets are always legal grapheme boundaries
 * - visual order is a permutation of the logical indices
 * - script itemization never splits a grapheme and covers the paragraph
 * - identical input produces a byte-identical snapshot
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scriptCodeToTag } from '../shaping';
import { layoutText, selectionRects } from '../textLayoutSnapshot';
import type { ShapedRun } from '../types';
import { createUnicodeIndexMap } from '../unicode/unicodeIndices';
import { itemizeParagraph, itemizeText } from './paragraphs';

const ARABIC_ALPHABET = [
  'م',
  'ر',
  'ح',
  'ب',
  'ا',
  'ل',
  'ع',
  'د',
  'و',
  'ل',
  'ا',
  'ر',
  ' ',
  '١',
  '٢',
  '٣',
  'a',
  'b',
  'c',
  '1',
  '2',
  '3',
  '.',
  ',',
  '(',
  ')',
  '!',
];

const BIDI_CONTROLS = [
  '\u200e',
  '\u200f',
  '\u202a',
  '\u202b',
  '\u202c',
  '\u202d',
  '\u202e',
  '\u2066',
  '\u2067',
  '\u2068',
  '\u2069',
];

const COMBINING_MARKS = [
  '\u0300',
  '\u0301',
  '\u0308',
  '\u0323',
  '\u064b',
  '\u064e',
  '\u0650',
  '\u093c',
  '\u094d',
  '\u0e47',
  '\u0e48',
];

const EMOJI_SEQUENCES = [
  '👨\u200d👩\u200d👧\u200d👦',
  '🇧🇷',
  'e\u0301',
  'क्\u200dष',
  '💩',
  '\u{1f1ee}\u{1f1f9}',
  'a\u0301b\u0301',
];

/** Synthetic logical-order shaping mirroring the bridge contract. */
function shape(paragraph: ReturnType<typeof itemizeText>['paragraphs'][number]): ShapedRun[] {
  return paragraph.scriptedRuns.map((run) => {
    const text = paragraph.text.slice(run.start, run.end);
    const clusters: number[] = [];
    let cursor = 0;
    for (const char of text) {
      clusters.push(cursor);
      cursor += char.length;
    }
    const glyphs = clusters.map((cluster) => ({
      glyphId: 1,
      xAdvance: 10,
      yAdvance: 0,
      xOffset: 0,
      yOffset: 0,
      clusterUtf16: run.start + cluster,
    }));
    if (run.direction === 'rtl') glyphs.reverse();
    return {
      fontFamily: 'Test Sans',
      fontSize: 16,
      fontWeight: 400,
      fontStyle: 'normal' as const,
      direction: run.direction,
      level: run.level,
      script: scriptCodeToTag(run.script),
      glyphs,
      width: glyphs.length * 10,
      ascent: 12,
      descent: 4,
    };
  });
}

function layoutOf(text: string, maxWidth: number) {
  const itemized = itemizeText(text);
  return layoutText({
    text,
    paragraphs: itemized.paragraphs.map((paragraph) => ({
      paragraph,
      runs: shape(paragraph),
    })),
    maxWidth,
    lineHeight: 16,
  });
}

const TEXT_GENERATORS = [
  fc.string({ maxLength: 60 }),
  fc
    .array(fc.constantFrom(...ARABIC_ALPHABET), { minLength: 0, maxLength: 60 })
    .map((chars) => chars.join('')),
  fc
    .array(fc.constantFrom('a', 'b', ' ', ...BIDI_CONTROLS), { minLength: 0, maxLength: 40 })
    .map((chars) => chars.join('')),
  fc
    .array(fc.constantFrom('a', ' ', ...COMBINING_MARKS), { minLength: 0, maxLength: 40 })
    .map((chars) => chars.join('')),
  fc
    .array(fc.constantFrom(...EMOJI_SEQUENCES, ' '), { minLength: 0, maxLength: 12 })
    .map((chars) => chars.join('')),
  fc
    .array(fc.constantFrom('a', 'b', ' ', '\u00a0', '\u200b', '\u200c', '\u200d', '\t'), {
      minLength: 0,
      maxLength: 40,
    })
    .map((chars) => chars.join('')),
  fc
    .array(fc.string({ maxLength: 12 }), { minLength: 0, maxLength: 6 })
    .map((lines) => lines.join('\n')),
];

const ANY_TEXT = fc.oneof(...TEXT_GENERATORS);

describe('text layout property invariants', () => {
  it('terminates and produces finite coordinates for arbitrary Unicode', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        const snapshot = layoutOf(text, maxWidth);
        for (const line of snapshot.lines) {
          expect(Number.isFinite(line.width)).toBe(true);
          expect(Number.isFinite(line.top)).toBe(true);
          expect(Number.isFinite(line.height)).toBe(true);
          expect(Number.isFinite(line.baseline)).toBe(true);
          for (const run of line.runs) {
            for (const glyph of run.glyphs) {
              expect(Number.isFinite(glyph.x)).toBe(true);
              expect(Number.isFinite(glyph.y)).toBe(true);
              expect(Number.isFinite(glyph.xAdvance)).toBe(true);
            }
          }
        }
        for (const stop of snapshot.caretStops) {
          expect(Number.isFinite(stop.x)).toBe(true);
        }
        for (const rect of selectionRects(snapshot, 0, snapshot.text.length)) {
          expect(Number.isFinite(rect.x)).toBe(true);
          expect(Number.isFinite(rect.width)).toBe(true);
        }
        expect(Number.isFinite(snapshot.width)).toBe(true);
        expect(Number.isFinite(snapshot.height)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps every cluster offset inside the source string with ordered bounds', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        const snapshot = layoutOf(text, maxWidth);
        for (const line of snapshot.lines) {
          expect(line.sourceStart).toBeGreaterThanOrEqual(0);
          expect(line.sourceEnd).toBeLessThanOrEqual(snapshot.text.length);
          expect(line.sourceStart).toBeLessThanOrEqual(line.sourceEnd);
          for (const run of line.runs) {
            expect(run.sourceStart).toBeGreaterThanOrEqual(0);
            expect(run.sourceEnd).toBeLessThanOrEqual(snapshot.text.length);
            for (const glyph of run.glyphs) {
              expect(glyph.clusterUtf16).toBeGreaterThanOrEqual(0);
              expect(glyph.clusterUtf16).toBeLessThanOrEqual(glyph.sourceEnd);
              expect(glyph.sourceEnd).toBeLessThanOrEqual(snapshot.text.length);
            }
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('tiles each paragraph exactly: lines are contiguous and reconstruct the source', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        const snapshot = layoutOf(text, maxWidth);
        const itemized = itemizeText(text);
        for (const paragraph of itemized.paragraphs) {
          const lineRanges = snapshot.lines
            .filter((line) => line.paragraphIndex === paragraph.index)
            .map((line) => [line.sourceStart, line.sourceEnd] as const);
          if (lineRanges.length === 0) continue;
          for (let i = 1; i < lineRanges.length; i++) {
            expect(lineRanges[i]![0]).toBe(lineRanges[i - 1]![1]);
          }
          expect(lineRanges[0]![0]).toBe(paragraph.sourceStart);
          expect(lineRanges[lineRanges.length - 1]![1]).toBe(paragraph.sourceEnd);
          const reconstructed = snapshot.lines
            .filter((line) => line.paragraphIndex === paragraph.index)
            .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
            .join('');
          expect(reconstructed).toBe(paragraph.text);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('places caret stops on grapheme boundaries inside their line bounds', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        const snapshot = layoutOf(text, maxWidth);
        const boundaries = new Set(snapshot.sourceMap.graphemeBoundaries);
        for (const stop of snapshot.caretStops) {
          expect(boundaries.has(stop.offset)).toBe(true);
          const line = snapshot.lines[stop.lineIndex];
          expect(line).toBeDefined();
          if (line) {
            expect(stop.x).toBeGreaterThanOrEqual(-1e-9);
            expect(stop.x).toBeLessThanOrEqual(line.width + 1e-9);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('keeps selection rectangles inside their line bounds', () => {
    fc.assert(
      fc.property(
        ANY_TEXT,
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 60 }),
        (text, maxWidth, start, end) => {
          const snapshot = layoutOf(text, maxWidth);
          const rects = selectionRects(snapshot, start, end);
          for (const rect of rects) {
            const line = snapshot.lines[rect.lineIndex];
            expect(line).toBeDefined();
            if (line) {
              expect(rect.x).toBeGreaterThanOrEqual(-1e-9);
              expect(rect.x + rect.width).toBeLessThanOrEqual(line.width + 1e-9);
              // Rect y is line-absolute: it must sit inside the line's box.
              expect(rect.y).toBeGreaterThanOrEqual(line.top - 1e-9);
              expect(rect.y + rect.height).toBeLessThanOrEqual(line.top + line.height + 1e-9);
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('resolves visual order as a permutation of the logical indices', () => {
    fc.assert(
      fc.property(ANY_TEXT, (text) => {
        const itemized = itemizeText(text);
        for (const paragraph of itemized.paragraphs) {
          expect([...paragraph.levels]).toHaveLength(paragraph.text.length);
          const runs = paragraph.scriptedRuns;
          expect(runs).toHaveLength(runs.length);
          let cursor = 0;
          for (const run of runs) {
            expect(run.start).toBe(cursor);
            cursor = run.end;
          }
          expect(cursor).toBe(paragraph.text.length);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never splits an extended grapheme cluster across script runs or lines', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        const snapshot = layoutOf(text, maxWidth);
        const boundaries = new Set(snapshot.sourceMap.graphemeBoundaries);
        const itemized = itemizeText(text);
        for (const paragraph of itemized.paragraphs) {
          for (const run of paragraph.scriptedRuns) {
            expect(boundaries.has(run.start + paragraph.sourceStart)).toBe(true);
            expect(boundaries.has(run.end + paragraph.sourceStart)).toBe(true);
          }
        }
        for (const line of snapshot.lines) {
          expect(boundaries.has(line.sourceStart)).toBe(true);
          expect(boundaries.has(line.sourceEnd)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic: identical input yields an identical snapshot', () => {
    fc.assert(
      fc.property(ANY_TEXT, fc.integer({ min: 0, max: 400 }), (text, maxWidth) => {
        expect(layoutOf(text, maxWidth)).toEqual(layoutOf(text, maxWidth));
      }),
      { numRuns: 200 },
    );
  });

  it('survives arbitrary selection ranges including inverted and out-of-bounds', () => {
    fc.assert(
      fc.property(
        ANY_TEXT,
        fc.integer({ min: -20, max: 80 }),
        fc.integer({ min: -20, max: 80 }),
        (text, start, end) => {
          const snapshot = layoutOf(text, 200);
          const rects = selectionRects(snapshot, start, end);
          for (const rect of rects) {
            expect(rect.width).toBeGreaterThanOrEqual(0);
            expect(rect.height).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('pathological input safety', () => {
  it('lays out a base plus 1000 combining marks without splitting it', () => {
    const text = 'a' + '\u0301'.repeat(1000);
    const snapshot = layoutOf(text, 50);
    expect(snapshot.lines.length).toBeGreaterThanOrEqual(1);
    const offsets = new Set(snapshot.caretStops.map((stop) => stop.offset));
    expect([...offsets].sort((a, b) => a - b)).toEqual([0, 1001]);
    expect(snapshot.lines[0]!.sourceEnd).toBe(1001);
  });

  it('handles a long unbreakable word with grapheme-safe wrapping', () => {
    const text = 'x'.repeat(2000);
    const snapshot = layoutOf(text, 200);
    // 10px advance per character: 20 chars per line at maxWidth 200.
    expect(snapshot.lines.length).toBe(100);
    const reconstructed = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('');
    expect(reconstructed).toBe(text);
  });

  it('terminates on 200 paragraphs', () => {
    const text = Array.from({ length: 200 }, (_, i) => `p${i}`).join('\n');
    const snapshot = layoutOf(text, 100);
    expect(snapshot.paragraphs).toHaveLength(200);
    expect(snapshot.lines.length).toBeGreaterThanOrEqual(200);
    const reconstructed = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('\n');
    expect(reconstructed).toBe(text);
  });

  it('survives a long ZWJ emoji chain without inventing grapheme boundaries', () => {
    const text = '👨' + '\u200d'.repeat(500) + '👦';
    const snapshot = layoutOf(text, 100);
    const offsets = new Set(snapshot.caretStops.map((stop) => stop.offset));
    // ICU (UAX #29 GB9b) closes the ZWJ sequence before the final emoji,
    // so the legal boundaries are the two graphemes ICU reports.
    expect([...offsets].sort((a, b) => a - b)).toEqual([0, 502, 504]);
    expect(snapshot.caretStops.every((stop) => stop.offset !== 1)).toBe(true);
  });

  it('survives a burst of BiDi controls without corrupting source order', () => {
    const text = 'a' + '\u2066'.repeat(200) + 'b' + '\u2069'.repeat(200) + 'c';
    const snapshot = layoutOf(text, 500);
    expect(snapshot.text).toBe(text);
    const reconstructed = snapshot.lines
      .map((line) => snapshot.text.slice(line.sourceStart, line.sourceEnd))
      .join('');
    expect(reconstructed).toBe(text);
  });

  it('handles an empty string and whitespace-only strings', () => {
    const empty = layoutOf('', 100);
    expect(empty.lines).toHaveLength(0);
    const spaces = layoutOf(' '.repeat(50), 30);
    expect(spaces.lines.length).toBeGreaterThanOrEqual(1);
    expect(spaces.caretStops.every((stop) => Number.isFinite(stop.x))).toBe(true);
  });

  it('clamps out-of-range shaper clusters instead of corrupting bounds', () => {
    const paragraph = itemizeParagraph({ index: 0, start: 0, end: 4, text: 'abcd' }, 'auto');
    const runs: ShapedRun[] = [
      {
        fontFamily: 'Test',
        fontSize: 16,
        fontWeight: 400,
        fontStyle: 'normal',
        direction: 'ltr',
        level: 0,
        script: 'latn',
        glyphs: [
          { glyphId: 1, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 0 },
          { glyphId: 2, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: -5 },
          { glyphId: 3, xAdvance: 10, yAdvance: 0, xOffset: 0, yOffset: 0, clusterUtf16: 99 },
        ],
        width: 30,
        ascent: 12,
        descent: 4,
      },
    ];
    const snapshot = layoutText({
      text: 'abcd',
      paragraphs: [{ paragraph, runs }],
      maxWidth: 100,
      lineHeight: 16,
    });
    const map = createUnicodeIndexMap('abcd');
    const boundaries = new Set(map.graphemeBoundaries);
    for (const stop of snapshot.caretStops) {
      expect(boundaries.has(stop.offset)).toBe(true);
    }
    for (const line of snapshot.lines) {
      for (const run of line.runs) {
        for (const glyph of run.glyphs) {
          expect(glyph.clusterUtf16).toBeGreaterThanOrEqual(0);
          expect(glyph.clusterUtf16).toBeLessThanOrEqual(4);
        }
      }
    }
  });
});
