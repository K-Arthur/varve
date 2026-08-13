/**
 * Line-breaking primitives (UAX #14-adjacent).
 *
 * A paragraph is segmented into break units — words and whitespace — that the
 * layout engine greedily fills into lines. Units never split an extended
 * grapheme cluster, and CJK ideographs are individual units so they wrap
 * between any two characters. Thai relies on Intl.Segmenter's dictionary
 * segmentation where available; the fallback never breaks inside a grapheme.
 */

/** Whitespace incl. NBSP, ZWSP, and Unicode space separators. */
const WHITESPACE_RE = /^[\t\n\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u200b\ufeff]+$/;

/** Whitespace that permits a line break before it (space, tab, ZWSP, ...). */
const BREAKABLE_WS_RE = /^[\t\n\f\r \u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u200b\ufeff]+$/;

export interface BreakUnit {
  /** Paragraph-local UTF-16 start. */
  start: number;
  /** Paragraph-local UTF-16 end (exclusive). */
  end: number;
  text: string;
  /** Whitespace-only unit (space, NBSP, ZWSP, tab, ...). */
  isWhitespace: boolean;
  /** Word-like unit (letters/digits). Punctuation attaches to its word. */
  isWord: boolean;
  /** May a line break before this unit when the line overflows? */
  isBreakable: boolean;
}

let wordSegmenter: Intl.Segmenter | null | undefined;

function getWordSegmenter(): Intl.Segmenter | null {
  if (wordSegmenter !== undefined) return wordSegmenter;
  if (typeof Intl === 'undefined' || !Intl.Segmenter) {
    wordSegmenter = null;
    return null;
  }
  wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  return wordSegmenter;
}

/**
 * Segment a paragraph into break units. Each unit is a maximal word-like
 * segment (including attached punctuation) or a whitespace run; units never
 * split graphemes. NBSP is whitespace but never a break opportunity (ICU may
 * emit it as its own segment; it must stay glued to a word).
 */
export function segmentBreakUnits(text: string): BreakUnit[] {
  if (text.length === 0) return [];
  const segmenter = getWordSegmenter();
  if (segmenter) {
    const units: BreakUnit[] = [];
    for (const segment of segmenter.segment(text)) {
      const t = segment.segment;
      units.push({
        start: segment.index,
        end: segment.index + t.length,
        text: t,
        isWhitespace: isWhitespaceUnit(t),
        isWord: segment.isWordLike === true,
        isBreakable: BREAKABLE_WS_RE.test(t) && !NBSP_ONLY_RE.test(t),
      });
    }
    return units;
  }
  return fallbackBreakUnits(text);
}

const NBSP_ONLY_RE = /^[\u00a0]+$/;

/**
 * Break an over-long unit at extended grapheme boundaries. Used when a single
 * word cannot fit on a line: the fallback line break must never split a
 * user-perceived character.
 */
export function graphemeBreakUnits(
  start: number,
  end: number,
  text: string,
  map: {
    graphemeBoundaries: readonly number[];
  },
): BreakUnit[] {
  const units: BreakUnit[] = [];
  const boundaries = map.graphemeBoundaries;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const unitStart = Math.max(boundaries[i]!, start);
    const unitEnd = Math.min(boundaries[i + 1]!, end);
    if (unitEnd > unitStart) {
      const t = text.slice(unitStart, unitEnd);
      const isWs = isWhitespaceUnit(t);
      units.push({
        start: unitStart,
        end: unitEnd,
        text: t,
        isWhitespace: isWs,
        isWord: !isWs,
        isBreakable: BREAKABLE_WS_RE.test(t) && !NBSP_ONLY_RE.test(t),
      });
    }
  }
  return units;
}

/** Whether this unit allows a line break before it when the line overflows. */
export function canBreakBefore(unit: BreakUnit): boolean {
  return unit.isBreakable;
}

export function isWhitespaceUnit(text: string): boolean {
  return text.length > 0 && WHITESPACE_RE.test(text);
}

function fallbackBreakUnits(text: string): BreakUnit[] {
  const units: BreakUnit[] = [];
  const parts = text.split(/(\s+)/);
  let offset = 0;
  for (const part of parts) {
    if (part.length === 0) continue;
    const isWs = isWhitespaceUnit(part);
    if (!isWs && containsCJK(part)) {
      for (const char of part) {
        units.push({
          start: offset,
          end: offset + char.length,
          text: char,
          isWhitespace: false,
          isWord: true,
          isBreakable: false,
        });
        offset += char.length;
      }
      continue;
    }
    units.push({
      start: offset,
      end: offset + part.length,
      text: part,
      isWhitespace: isWs,
      isWord: !isWs,
      isBreakable: isWs && !NBSP_ONLY_RE.test(part),
    });
    offset += part.length;
  }
  return units;
}

function containsCJK(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0x3040 && code <= 0x309f) ||
      (code >= 0x30a0 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      return true;
    }
  }
  return false;
}
