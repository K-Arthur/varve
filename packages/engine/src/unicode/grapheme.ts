/**
 * Grapheme cluster and source-offset helpers.
 *
 * All offsets are UTF-16 code-unit offsets unless the function name says
 * codepoint or grapheme. The implementation delegates to UnicodeIndexMap so
 * every consumer shares one boundary contract.
 */

import {
  codePointCount,
  codePointToUtf16,
  createUnicodeIndexMap,
  graphemeToUtf16,
  graphemeCount as mapGraphemeCount,
  utf16ToCodePoint,
  utf16ToGrapheme,
} from './unicodeIndices';

export type { GraphemeBoundary } from './unicodeIndices';

export function splitGraphemes(text: string): string[] {
  const map = createUnicodeIndexMap(text);
  return map.graphemes.map(({ segment }) => segment);
}

export function graphemeBoundaries(text: string): Array<{ index: number; segment: string }> {
  return [...createUnicodeIndexMap(text).graphemes];
}

export function graphemeCount(text: string): number {
  return mapGraphemeCount(createUnicodeIndexMap(text));
}

export function graphemeIndexAt(text: string, utf16Index: number): number {
  return utf16ToGrapheme(createUnicodeIndexMap(text), utf16Index);
}

export function utf16IndexAtGrapheme(text: string, graphemeIndex: number): number {
  return graphemeToUtf16(createUnicodeIndexMap(text), graphemeIndex);
}

export function codepointOffset(text: string, utf16Index: number): number {
  return utf16ToCodePoint(createUnicodeIndexMap(text), utf16Index);
}

export function utf16IndexAtCodepointOffset(text: string, offset: number): number {
  return codePointToUtf16(createUnicodeIndexMap(text), offset);
}

/** Scalar count for callers that need it without constructing another map. */
export function codepointCount(text: string): number {
  return codePointCount(createUnicodeIndexMap(text));
}
