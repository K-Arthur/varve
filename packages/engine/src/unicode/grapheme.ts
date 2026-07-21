/**
 * Grapheme cluster segmentation & codepoint-aware text utilities.
 *
 * Research basis:
 * - Unicode Standard Annex #29: Unicode Text Segmentation (grapheme/word boundaries)
 * - W3C CSS Text Module Level 3: grapheme as the atomic unit of user-perceived characters
 *
 * Design notes:
 * - The module prefers Intl.Segmenter (UAX #29 compliant, native in V8/JSC/WebKit)
 *   and falls back to a regex-based estimator for older engines or non-DOM contexts.
 * - All offset-based APIs return *string-index* (UTF-16 code unit) positions to match
 *   the JS string model used by the rest of the codebase (Span indices, textarea
 *   selection, etc.). Codepoint-counting variants are provided where shaping needs them.
 */

// Is this codepoint a combining mark (Unicode General Category M)?
// Pragmatic check for the fallback path — covers the most common mark blocks.
// Intl.Segmenter provides precise segmentation in the primary path.
function isCombiningMark(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) || // Combining Diacritical Marks
    (code >= 0x0483 && code <= 0x0489) || // Cyrillic combining
    (code >= 0x0591 && code <= 0x05bd) || // Hebrew combining
    code === 0x05bf ||
    (code >= 0x05c1 && code <= 0x05c2) ||
    (code >= 0x05c4 && code <= 0x05c5) ||
    code === 0x05c7 ||
    (code >= 0x0610 && code <= 0x061a) || // Arabic combining
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4) ||
    (code >= 0x06e7 && code <= 0x06e8) ||
    (code >= 0x06ea && code <= 0x06ed) ||
    code === 0x0711 ||
    (code >= 0x0730 && code <= 0x074a) || // Syriac combining
    (code >= 0x1dc0 && code <= 0x1dff) || // Combining Diacritical Marks Supplement
    (code >= 0x20d0 && code <= 0x20f0) || // Combining Marks for Symbols
    (code >= 0xfe00 && code <= 0xfe0f) || // Variation Selectors
    (code >= 0xfe20 && code <= 0xfe2f) || // Combining Half Marks
    (code >= 0x0900 && code <= 0x0dff) // Indic combining marks (broad block)
  );
}

/**
 * Grapheme cluster boundaries detected by Intl.Segmenter (UAX #29).
 */
export interface GraphemeBoundary {
  /** UTF-16 string index where the grapheme cluster starts. */
  index: number;
  /** The grapheme cluster as a string. */
  segment: string;
}

let segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !(Intl as { Segmenter?: unknown }).Segmenter) return null;
  if (!segmenter) {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return segmenter;
}

/**
 * Split text into grapheme clusters (perceived characters).
 * Falls back to regex-based segmentation if Intl.Segmenter is unavailable.
 */
export function splitGraphemes(text: string): string[] {
  const seg = getSegmenter();
  if (seg) {
    return [...seg.segment(text)].map((s) => s.segment);
  }
  return fallbackSplit(text);
}

/** Get grapheme cluster boundaries with string-index positions. */
export function graphemeBoundaries(text: string): GraphemeBoundary[] {
  const seg = getSegmenter();
  if (seg) {
    const result: GraphemeBoundary[] = [];
    for (const s of seg.segment(text)) {
      result.push({ index: s.index, segment: s.segment });
    }
    return result;
  }
  return fallbackBoundaries(text);
}

/** Count grapheme clusters (user-perceived characters). */
export function graphemeCount(text: string): number {
  const seg = getSegmenter();
  if (seg) {
    let count = 0;
    for (const _ of seg.segment(text)) count++;
    return count;
  }
  return fallbackSplit(text).length;
}

/**
 * Given a UTF-16 string index, return the grapheme cluster index it falls within.
 * Used to snap caret positions to grapheme boundaries on pointer hit-testing.
 */
export function graphemeIndexAt(text: string, utf16Index: number): number {
  const seg = getSegmenter();
  if (seg) {
    const boundaries: number[] = [];
    for (const s of seg.segment(text)) boundaries.push(s.index);
    // Find the last boundary whose start is <= utf16Index.
    for (let gi = boundaries.length - 1; gi >= 0; gi--) {
      if (boundaries[gi]! <= utf16Index) return gi;
    }
    return 0;
  }
  return fallbackGraphemeIndexAt(text, utf16Index);
}

/**
 * Convert a grapheme cluster index to a UTF-16 string index.
 */
export function utf16IndexAtGrapheme(text: string, graphemeIndex: number): number {
  const seg = getSegmenter();
  if (seg) {
    let gi = 0;
    for (const s of seg.segment(text)) {
      if (gi === graphemeIndex) return s.index;
      gi++;
    }
    return text.length;
  }
  return fallbackUtf16IndexAtGrapheme(text, graphemeIndex);
}

/** Convert a UTF-16 string index to a Unicode codepoint offset (for shaping). */
export function codepointOffset(text: string, utf16Index: number): number {
  let cp = 0;
  for (let i = 0; i < utf16Index && i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++; // skip low surrogate
    cp++;
  }
  return cp;
}

/** Convert a Unicode codepoint offset to a UTF-16 string index. */
export function utf16IndexAtCodepointOffset(text: string, codepointOffset: number): number {
  let cp = 0;
  for (let i = 0; i < text.length; i++) {
    if (cp === codepointOffset) return i;
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    cp++;
  }
  return text.length;
}

// ── Fallback segmentation (function‑based; less precise but dependency‑free) ──

function fallbackSplit(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = i + 1;
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && end < text.length) {
      end++; // consume low surrogate
    }
    // Consume subsequent combining marks (NSM) and ZWJ sequences.
    while (end < text.length && isCombiningMark(text.codePointAt(end)!)) end++;
    out.push(text.substring(i, end));
    i = end;
  }
  return out;
}

function fallbackBoundaries(text: string): GraphemeBoundary[] {
  const segs = fallbackSplit(text);
  const result: GraphemeBoundary[] = [];
  let idx = 0;
  for (const seg of segs) {
    result.push({ index: idx, segment: seg });
    idx += seg.length;
  }
  return result;
}

function fallbackGraphemeIndexAt(text: string, utf16Index: number): number {
  const boundaries = fallbackBoundaries(text);
  // Find the last boundary whose start is <= utf16Index (the containing grapheme).
  for (let gi = boundaries.length - 1; gi >= 0; gi--) {
    if (boundaries[gi]!.index <= utf16Index) return gi;
  }
  return 0;
}

function fallbackUtf16IndexAtGrapheme(text: string, graphemeIndex: number): number {
  const boundaries = fallbackBoundaries(text);
  if (graphemeIndex >= boundaries.length) return text.length;
  return boundaries[graphemeIndex]!.index;
}
