/**
 * UAX #9 adapter backed by bidi-js.
 *
 * bidi-js is conformance-tested against the Unicode Bidirectional Algorithm.
 * This adapter converts its character-level embedding result into Varve's
 * logical UTF-16 run contract and keeps the resolved visual order available
 * for caret and hit-testing consumers.
 */

import bidiFactory from 'bidi-js';
import type { BidiDirection, BidiParagraph, BidiRun } from './bidiTypes';

const bidi = bidiFactory();

export function analyzeParagraphUax9(
  text: string,
  explicitDirection?: BidiDirection,
): BidiParagraph {
  if (text.length === 0) {
    return {
      text,
      baseDirection: explicitDirection ?? 'ltr',
      baseLevel: explicitDirection === 'rtl' ? 1 : 0,
      runs: [],
      visualRuns: [],
      visualOrder: [],
      mirroredCharacters: new Map(),
    };
  }

  const result = bidi.getEmbeddingLevels(text, explicitDirection ?? 'auto');
  const paragraph = result.paragraphs.find((candidate) => candidate.start === 0) ??
    result.paragraphs[0] ?? {
      start: 0,
      end: text.length - 1,
      level: explicitDirection === 'rtl' ? 1 : 0,
    };
  const end = Math.min(text.length, paragraph.end + 1);
  const runs = buildRuns(result.levels, paragraph.start, end);
  const resolvedVisualOrder = bidi.getReorderedIndices(
    text,
    result,
    paragraph.start,
    paragraph.end,
  );
  // Varve's existing caret API numbers RTL visual positions from the logical
  // paragraph start (the rightmost insertion side). Keep that public
  // convention while retaining bidi-js's full UAX #9 resolution.
  const visualOrder =
    paragraph.level % 2 === 1 ? [...resolvedVisualOrder].reverse() : resolvedVisualOrder;
  const visualRuns = uniqueRunsInVisualOrder(visualOrder, runs);
  const mirroredCharacters = bidi.getMirroredCharactersMap(
    text,
    result.levels,
    paragraph.start,
    paragraph.end,
  );
  const baseLevel = paragraph.level;
  return {
    text,
    baseDirection: baseLevel % 2 === 1 ? 'rtl' : 'ltr',
    baseLevel,
    runs,
    visualRuns,
    visualOrder,
    mirroredCharacters,
  };
}

function buildRuns(levels: Uint8Array, start: number, end: number): BidiRun[] {
  const runs: BidiRun[] = [];
  let runStart = start;
  while (runStart < end) {
    const level = levels[runStart] ?? 0;
    const runDirection: BidiDirection = level % 2 === 1 ? 'rtl' : 'ltr';
    let runEnd = runStart + 1;
    while (runEnd < end && (levels[runEnd] ?? 0) === level) runEnd++;
    runs.push({ start: runStart, end: runEnd, direction: runDirection, level });
    runStart = runEnd;
  }
  return runs;
}

function uniqueRunsInVisualOrder(indices: readonly number[], runs: readonly BidiRun[]): BidiRun[] {
  const seen = new Set<BidiRun>();
  const result: BidiRun[] = [];
  for (const index of indices) {
    const run = runs.find((candidate) => index >= candidate.start && index < candidate.end);
    if (run && !seen.has(run)) {
      seen.add(run);
      result.push(run);
    }
  }
  return result;
}
