/**
 * Paragraph itemization for the canonical text layout pipeline.
 *
 * A logical document string is split at paragraph separators (U+000A). Each
 * paragraph is then resolved with UAX #9 (bidi-js): base direction, embedding
 * levels, logical runs, and per-character levels retained for line-local
 * reordering. Script itemization is layered on top so shaping runs can be
 * formed per (direction, level, script) tuple without ever mutating source
 * text, which stays in logical Unicode order.
 */

import type { BidiDirection, BidiRun } from '../unicode/bidiTypes';
import { analyzeParagraphUax9 } from '../unicode/bidiUax9';
import type { ScriptCode } from '../unicode/script';
import { detectScript } from '../unicode/script';

/** A paragraph's span inside the full document string. */
export interface ParagraphRange {
  /** Zero-based paragraph index. */
  index: number;
  /** UTF-16 offset of the paragraph start in the full text. */
  start: number;
  /** UTF-16 offset just past the paragraph's last character (no newline). */
  end: number;
  /** Paragraph-local source text (logical order, no normalization). */
  text: string;
}

/** A shaping run: one contiguous logical span with a single script and level. */
export interface ScriptedRun {
  /** Paragraph-local UTF-16 start. */
  start: number;
  /** Paragraph-local UTF-16 end. */
  end: number;
  /** ISO 15924 script code. Common/Unknown chars are absorbed into neighbors. */
  script: ScriptCode;
  /** UAX #9 run direction. */
  direction: BidiDirection;
  /** UAX #9 embedding level. */
  level: number;
}

/** One itemized paragraph: UAX #9 resolution plus script runs, no text mutation. */
export interface ItemizedParagraph {
  index: number;
  /** Document-local UTF-16 start. */
  sourceStart: number;
  /** Document-local UTF-16 end (exclusive). */
  sourceEnd: number;
  /** Paragraph-local source text. */
  text: string;
  baseDirection: BidiDirection;
  baseLevel: number;
  /** UAX #9 logical runs (paragraph-local UTF-16 offsets). */
  runs: readonly BidiRun[];
  /** UAX #9 embedding level per UTF-16 code unit (paragraph-local). */
  levels: readonly number[];
  /** Mirrored punctuation: logical index -> mirror character. */
  mirroredCharacters: ReadonlyMap<number, string>;
  /** Script-itemized shaping runs in logical order. */
  scriptedRuns: readonly ScriptedRun[];
}

export interface ItemizedText {
  /** Full logical document string. */
  text: string;
  paragraphs: readonly ItemizedParagraph[];
}

/**
 * Split a logical string into paragraphs at U+000A. A trailing newline yields
 * a final empty paragraph so a caret can sit after the last line break.
 */
export function splitParagraphs(text: string): ParagraphRange[] {
  if (text.length === 0) return [];
  const paragraphs: ParagraphRange[] = [];
  let index = 0;
  let start = 0;
  for (let offset = 0; offset <= text.length; offset++) {
    if (offset === text.length || text.charCodeAt(offset) === 0x0a) {
      paragraphs.push({ index, start, end: offset, text: text.slice(start, offset) });
      index++;
      start = offset + 1;
    }
  }
  return paragraphs;
}

/**
 * Itemize one paragraph: UAX #9 resolution plus script-itemized shaping runs.
 * `direction` accepts 'auto' (first-strong), 'ltr', 'rtl', or undefined
 * (first-strong, the Auto behavior).
 */
export function itemizeParagraph(
  range: ParagraphRange,
  direction?: BidiDirection | 'auto',
): ItemizedParagraph {
  const bidi = analyzeParagraphUax9(range.text, direction === 'auto' ? undefined : direction);
  return {
    index: range.index,
    sourceStart: range.start,
    sourceEnd: range.end,
    text: range.text,
    baseDirection: bidi.baseDirection,
    baseLevel: bidi.baseLevel,
    runs: bidi.runs,
    levels: [...(bidi.levels ?? [])],
    mirroredCharacters: bidi.mirroredCharacters ?? new Map(),
    scriptedRuns: buildScriptedRuns(bidi),
  };
}

/** Itemize a full document string into paragraphs (Auto base direction default). */
export function itemizeText(
  text: string,
  direction?: BidiDirection | 'auto',
): ItemizedText {
  return {
    text,
    paragraphs: splitParagraphs(text).map((range) => itemizeParagraph(range, direction)),
  };
}

/** One script run inside a logical BidiRun (paragraph-local UTF-16 offsets). */
interface ScriptSpan {
  start: number;
  end: number;
  script: ScriptCode;
}

/**
 * Segment a logical BidiRun by Unicode script. Common ('Zyyy') and inherited
 * ('Zzzz'-classified combining marks) characters are absorbed into the
 * surrounding run so digits and combining sequences shape with the nearby
 * script and never split a grapheme.
 */
function scriptSpansOf(text: string, start: number, end: number): ScriptSpan[] {
  const spans: ScriptSpan[] = [];
  let spanStart = start;
  let spanScript: ScriptCode | null = null;
  let pendingStart: number | null = null;
  const flush = (spanEnd: number): void => {
    if (spanEnd > spanStart && spanScript !== null) {
      spans.push({ start: spanStart, end: spanEnd, script: spanScript });
    }
  };
  for (let offset = start; offset < end; ) {
    const code = text.codePointAt(offset) ?? 0;
    const width = code > 0xffff ? 2 : 1;
    const script = detectScript(code);
    if (script === 'Zyyy' || script === 'Zzzz') {
      if (spanScript === null && pendingStart === null) {
        // Leading common/inherited chars absorb into the next strong run.
        pendingStart = offset;
      }
      // Otherwise absorb into the current span.
    } else if (spanScript === null) {
      spanStart = pendingStart ?? offset;
      pendingStart = null;
      spanScript = script;
    } else if (script !== spanScript) {
      flush(offset);
      spanStart = offset;
      spanScript = script;
    }
    offset += width;
  }
  flush(end);
  // A span of pure common/inherited characters keeps its own Zyyy run.
  if (spans.length === 0) spans.push({ start, end, script: 'Zyyy' });
  return spans;
}

function buildScriptedRuns(bidi: {
  text: string;
  runs: readonly BidiRun[];
}): ScriptedRun[] {
  const result: ScriptedRun[] = [];
  for (const run of bidi.runs) {
    for (const span of scriptSpansOf(bidi.text, run.start, run.end)) {
      result.push({
        start: span.start,
        end: span.end,
        script: span.script,
        direction: run.direction,
        level: run.level,
      });
    }
  }
  return result;
}
