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
