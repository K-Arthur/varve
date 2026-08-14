/**
 * Unicode subsystem barrel — grapheme segmentation, BiDi layout, script detection.
 */

export type { BidiClass, BidiDirection, BidiParagraph, BidiRun } from './bidi';
export {
  analyzeParagraph,
  autoParagraphDirection,
  bidiClassOf,
  logicalToVisual,
  reorderRuns,
  segmentRuns,
  visualToLogical,
} from './bidi';
export type { GraphemeBoundary } from './grapheme';
export {
  codepointOffset,
  graphemeBoundaries,
  graphemeCount,
  graphemeIndexAt,
  splitGraphemes,
  utf16IndexAtCodepointOffset,
  utf16IndexAtGrapheme,
} from './grapheme';
export type { ScriptCode, ScriptRun } from './script';
export {
  detectScript,
  dominantScript,
  segmentByScript,
} from './script';
export type { BoundaryBias, UnicodeIndexMap } from './unicodeIndices';
export {
  codePointCount,
  codePointToUtf16,
  createUnicodeIndexMap,
  graphemeCount as indexedGraphemeCount,
  graphemeToUtf16,
  normalizeGraphemeRange,
  snapUtf16Offset,
  utf16ToCodePoint,
  utf16ToGrapheme,
} from './unicodeIndices';
