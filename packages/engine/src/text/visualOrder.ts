/**
 * Line-level visual run ordering (UAX #9 X8/L2).
 *
 * Line breaking happens in logical order; afterwards each line's characters
 * are reordered with L1.4 + L2 restricted to the line (via bidi-js
 * `getReorderedIndices` over the sub-range). The result is the visual run
 * sequence a renderer, caret layer, and selection layer consume. Source text
 * stays logical; nothing here mutates it.
 */

import type { BidiDirection } from '../unicode/bidiTypes';
import { reorderLineIndices } from '../unicode/bidiUax9';
import type { ItemizedParagraph } from './paragraphs';

export interface LineVisualRun {
  /** Paragraph-local logical start (inclusive). */
  start: number;
  /** Paragraph-local logical end (exclusive). */
  end: number;
  /** UAX #9 embedding level of the run. */
  level: number;
  direction: BidiDirection;
  /** 0 = leftmost visual position on the line. */
  visualIndex: number;
}

/**
 * Resolve the visual run sequence for one wrapped line. `lineStart`/`lineEnd`
 * are paragraph-local logical UTF-16 offsets.
 */
export function lineVisualRuns(
  paragraph: ItemizedParagraph,
  lineStart: number,
  lineEnd: number,
): LineVisualRun[] {
  const indices = reorderLineIndices(
    paragraph.text,
    paragraph.levels,
    paragraph.baseLevel,
    lineStart,
    lineEnd,
  );
  const levelAt = (index: number): number =>
    paragraph.levels[index] ?? paragraph.baseLevel;
  const runs: LineVisualRun[] = [];
  let min = -1;
  let max = -1;
  let level = 0;
  const flush = (): void => {
    if (min >= 0) {
      runs.push({
        start: min,
        end: max + 1,
        level,
        direction: level % 2 === 1 ? 'rtl' : 'ltr',
        visualIndex: runs.length,
      });
    }
  };
  for (const index of indices) {
    if (index < lineStart || index >= lineEnd) continue;
    const nextLevel = levelAt(index);
    if (min < 0) {
      min = index;
      max = index;
      level = nextLevel;
      continue;
    }
    // The visual sequence walks a level block either forward (LTR) or
    // backward (RTL); extend the run while logical indices stay adjacent.
    if (nextLevel === level && (index === max + 1 || index === min - 1)) {
      min = Math.min(min, index);
      max = Math.max(max, index);
      continue;
    }
    flush();
    min = index;
    max = index;
    level = nextLevel;
  }
  flush();
  return runs;
}

/** Mirror replacement for a logical index in the paragraph, if any. */
export function mirroredCharAt(
  paragraph: ItemizedParagraph,
  logicalIndex: number,
): string | undefined {
  return paragraph.mirroredCharacters.get(logicalIndex);
}
