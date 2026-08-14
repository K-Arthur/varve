/// <reference path="../bidi-js.d.ts" />

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
      levels: [],
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
    levels: [...result.levels],
  };
}

/**
 * Line-local visual order for a logical sub-range (UAX #9 X8/L2).
 *
 * This replicates bidi-js's `getReorderedIndices(text, result, start, end)`
 * — L1.4 trailing whitespace/isolate reset + L2 block reversal restricted to
 * the line — without its per-call full-string allocations. The line is at
 * most a few hundred characters while paragraphs can be tens of thousands,
 * so the paragraph-level levels array is only read, never copied per line.
 * Returns paragraph-local character indices in left-to-right visual order.
 *
 * Parity with bidi-js is covered by `lineReorderParity.test.ts`.
 */
export function reorderLineIndices(
  text: string,
  levels: readonly number[],
  baseLevel: number,
  lineStart: number,
  lineEnd: number,
): number[] {
  if (text.length === 0 || lineEnd <= lineStart || levels.length === 0) return [];
  const lineLength = lineEnd - lineStart;
  const lineLevels = new Uint8Array(lineLength);
  for (let i = 0; i < lineLength; i++) {
    lineLevels[i] = levels[lineStart + i] ?? baseLevel;
  }

  // L1.4: trailing whitespace and isolate/formatting characters at the end of
  // the line reset to the paragraph level.
  for (let i = lineLength - 1; i >= 0 && isTrailingType(text.charCodeAt(lineStart + i)); i--) {
    lineLevels[i] = baseLevel;
  }

  // L2: from the highest level found to the lowest odd level on the line,
  // reverse any contiguous sequence of characters at that level or higher.
  const indices = new Array<number>(lineLength);
  for (let i = 0; i < lineLength; i++) indices[i] = lineStart + i;
  let maxLevel = 0;
  let minOddLevel = Infinity;
  for (let i = 0; i < lineLength; i++) {
    const level = lineLevels[i]!;
    if (level > maxLevel) maxLevel = level;
    const odd = level | 1;
    if (odd < minOddLevel) minOddLevel = odd;
  }
  for (let level = maxLevel; level >= minOddLevel; level--) {
    let i = 0;
    while (i < lineLength) {
      if (lineLevels[i]! >= level) {
        let j = i + 1;
        while (j < lineLength && lineLevels[j]! >= level) j++;
        reverseRange(indices, i, j);
        i = j;
      } else {
        i++;
      }
    }
  }
  return indices;
}

function reverseRange<T>(values: T[], start: number, end: number): void {
  let left = start;
  let right = end - 1;
  while (left < right) {
    const swap = values[left]!;
    values[left] = values[right]!;
    values[right] = swap;
    left++;
    right--;
  }
}

/**
 * L1.4 trailing types: whitespace (S, WS, B) and directional formatting
 * (RLE, LRE, RLO, LRO, PDF). Restricted to the classes bidi-js's type table
 * classifies so line reordering is byte-identical to the reference adapter;
 * BN and isolate characters (ZWSP/ZWNJ/ZWJ/LRM/RLM, LRI/RLI/FSI/PDI) are not
 * reset by the reference and are therefore not reset here. Exhaustive BMP
 * parity is covered by `lineReorderParity.test.ts`.
 */
function isTrailingType(code: number): boolean {
  return (
    code === 0x0009 ||
    code === 0x000a ||
    code === 0x000b ||
    code === 0x000c ||
    code === 0x000d ||
    code === 0x001c ||
    code === 0x001d ||
    code === 0x001e ||
    code === 0x001f ||
    code === 0x0020 ||
    code === 0x0085 ||
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
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
