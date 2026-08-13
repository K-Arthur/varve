/**
 * Explicit source-index mapping for Unicode text.
 *
 * Document and DOM selection offsets are UTF-16 code-unit offsets. Shaping
 * consumes Unicode scalars and emits clusters that may cover multiple source
 * units. Editing operates on extended grapheme boundaries. This module keeps
 * those units explicit and provides deterministic conversions without
 * normalizing or reordering the source string.
 */

export type BoundaryBias = 'floor' | 'ceil' | 'nearest';

export interface GraphemeBoundary {
  /** UTF-16 source offset where this extended grapheme starts. */
  index: number;
  /** Source substring covered by the grapheme. */
  segment: string;
}

export interface UnicodeIndexMap {
  readonly text: string;
  /** Includes 0 and text.length. */
  readonly codePointBoundaries: readonly number[];
  /** Includes 0 and text.length. */
  readonly graphemeBoundaries: readonly number[];
  /** Grapheme records, excluding the terminal boundary. */
  readonly graphemes: readonly GraphemeBoundary[];
}

/** Build all source-index views once for a text revision. */
export function createUnicodeIndexMap(text: string): UnicodeIndexMap {
  const codePointBoundaries = buildCodePointBoundaries(text);
  const graphemes = buildGraphemeBoundaries(text);
  return {
    text,
    codePointBoundaries,
    graphemeBoundaries: [...graphemes.map((g) => g.index), text.length],
    graphemes,
  };
}

export function codePointCount(map: UnicodeIndexMap): number {
  return Math.max(0, map.codePointBoundaries.length - 1);
}

export function graphemeCount(map: UnicodeIndexMap): number {
  return map.graphemes.length;
}

/** Convert a scalar index to a UTF-16 source offset. */
export function codePointToUtf16(map: UnicodeIndexMap, codePointIndex: number): number {
  const index = clampInteger(codePointIndex, 0, codePointCount(map));
  return map.codePointBoundaries[index] ?? map.text.length;
}

/**
 * Convert a UTF-16 source offset to a scalar index. Offsets inside a surrogate
 * pair are resolved to the containing scalar (floor) or the following scalar
 * (ceil).
 */
export function utf16ToCodePoint(
  map: UnicodeIndexMap,
  utf16Offset: number,
  bias: Exclude<BoundaryBias, 'nearest'> = 'floor',
): number {
  const offset = clampInteger(utf16Offset, 0, map.text.length);
  const boundaries = map.codePointBoundaries;
  const floor = upperBound(boundaries, offset) - 1;
  if (bias === 'floor' || floor >= boundaries.length - 1 || boundaries[floor] === offset) {
    return floor;
  }
  return floor + 1;
}

/** Convert a grapheme index to a UTF-16 source offset. */
export function graphemeToUtf16(map: UnicodeIndexMap, graphemeIndex: number): number {
  const index = clampInteger(graphemeIndex, 0, graphemeCount(map));
  return map.graphemeBoundaries[index] ?? map.text.length;
}

/** Find the grapheme containing a UTF-16 offset. */
export function utf16ToGrapheme(map: UnicodeIndexMap, utf16Offset: number): number {
  const offset = clampInteger(utf16Offset, 0, map.text.length);
  return Math.min(Math.max(0, upperBound(map.graphemeBoundaries, offset) - 1), graphemeCount(map));
}

/**
 * Snap an arbitrary UTF-16 offset to an extended grapheme boundary. Selection
 * starts use floor and selection ends use ceil so a selected grapheme is never
 * truncated.
 */
export function snapUtf16Offset(
  map: UnicodeIndexMap,
  utf16Offset: number,
  bias: BoundaryBias = 'nearest',
): number {
  const offset = clampInteger(utf16Offset, 0, map.text.length);
  const boundaries = map.graphemeBoundaries;
  if (bias === 'floor') return boundaries[upperBound(boundaries, offset) - 1] ?? 0;
  if (bias === 'ceil') return boundaries[lowerBound(boundaries, offset)] ?? map.text.length;
  const floor = boundaries[upperBound(boundaries, offset) - 1] ?? 0;
  const ceil = boundaries[lowerBound(boundaries, offset)] ?? map.text.length;
  return offset - floor <= ceil - offset ? floor : ceil;
}

export function normalizeGraphemeRange(
  map: UnicodeIndexMap,
  start: number,
  end: number,
): { start: number; end: number } {
  const orderedStart = Math.min(start, end);
  const orderedEnd = Math.max(start, end);
  return {
    start: snapUtf16Offset(map, orderedStart, 'floor'),
    end: snapUtf16Offset(map, orderedEnd, 'ceil'),
  };
}

function buildCodePointBoundaries(text: string): number[] {
  const boundaries = [0];
  for (let offset = 0; offset < text.length; ) {
    const first = text.charCodeAt(offset);
    const isHigh = first >= 0xd800 && first <= 0xdbff;
    const second = offset + 1 < text.length ? text.charCodeAt(offset + 1) : 0;
    const isPair = isHigh && second >= 0xdc00 && second <= 0xdfff;
    offset += isPair ? 2 : 1;
    boundaries.push(offset);
  }
  return boundaries;
}

let graphemeSegmenter: Intl.Segmenter | null | undefined;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter !== undefined) return graphemeSegmenter;
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  } else {
    graphemeSegmenter = null;
  }
  return graphemeSegmenter;
}

function buildGraphemeBoundaries(text: string): GraphemeBoundary[] {
  const segmenter = getGraphemeSegmenter();
  if (segmenter) {
    return [...segmenter.segment(text)].map(({ index, segment }) => ({ index, segment }));
  }
  return fallbackGraphemeBoundaries(text);
}

function fallbackGraphemeBoundaries(text: string): GraphemeBoundary[] {
  const result: GraphemeBoundary[] = [];
  let offset = 0;
  while (offset < text.length) {
    const start = offset;
    const first = codePointAt(text, offset);
    offset += first.width;

    // UAX #29 keeps CRLF together.
    if (first.codePoint === 0x0d && text.charCodeAt(offset) === 0x0a) offset++;

    // Pair regional indicators.
    if (isRegionalIndicator(first.codePoint)) {
      const next = codePointAt(text, offset);
      if (isRegionalIndicator(next.codePoint)) offset += next.width;
    }

    // Extend marks, variation selectors, emoji modifiers, and ZWJ-linked
    // emoji/script sequences. Intl.Segmenter is the standards path; this is
    // only a safe fallback for older runtimes.
    while (offset < text.length) {
      const next = codePointAt(text, offset);
      if (isExtend(next.codePoint)) {
        offset += next.width;
        continue;
      }
      if (next.codePoint === 0x200d) {
        offset += next.width;
        if (offset < text.length) {
          const joined = codePointAt(text, offset);
          offset += joined.width;
        }
        continue;
      }
      break;
    }

    result.push({ index: start, segment: text.slice(start, offset) });
  }
  return result;
}

function codePointAt(text: string, offset: number): { codePoint: number; width: number } {
  const first = text.charCodeAt(offset);
  const second = text.charCodeAt(offset + 1);
  if (first >= 0xd800 && first <= 0xdbff && second >= 0xdc00 && second <= 0xdfff) {
    return { codePoint: (first - 0xd800) * 0x400 + second - 0xdc00 + 0x10000, width: 2 };
  }
  return { codePoint: first, width: 1 };
}

function isRegionalIndicator(codePoint: number): boolean {
  return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}

function isExtend(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x0483 && codePoint <= 0x0489) ||
    (codePoint >= 0x0591 && codePoint <= 0x05bd) ||
    (codePoint >= 0x0610 && codePoint <= 0x061a) ||
    (codePoint >= 0x064b && codePoint <= 0x065f) ||
    (codePoint >= 0x0900 && codePoint <= 0x0dff) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function lowerBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}
