import { replaceRichTextRange } from './richTextOps';
import type { RichText } from './typography';

export interface FlatMapping {
  paragraphIndex: number;
  runIndex: number;
  runOffset: number;
}

export interface RichTextMatch {
  flatStart: number;
  flatEnd: number;
  paragraphs: {
    paragraphIndex: number;
    runIndex: number;
    runOffset: number;
    length: number;
  }[];
}

export function flatTextFromRichText(rich: RichText): {
  text: string;
  mapping: FlatMapping[];
} {
  let text = '';
  const mapping: FlatMapping[] = [];
  for (let pi = 0; pi < rich.paragraphs.length; pi++) {
    const para = rich.paragraphs[pi];
    if (!para) continue;
    for (let ri = 0; ri < para.runs.length; ri++) {
      const run = para.runs[ri];
      if (!run) continue;
      for (let ro = 0; ro < run.text.length; ro++) {
        mapping.push({ paragraphIndex: pi, runIndex: ri, runOffset: ro });
        text += run.text[ro];
      }
    }
    if (pi < rich.paragraphs.length - 1) {
      text += '\n';
      mapping.push({ paragraphIndex: -1, runIndex: -1, runOffset: -1 });
    }
  }
  return { text, mapping };
}

export function flatToRichSelection(
  rich: RichText,
  flatStart: number,
  flatEnd: number,
): {
  paraSegments: {
    paragraphIndex: number;
    runIndex: number;
    runOffset: number;
    length: number;
  }[];
} {
  const { text, mapping } = flatTextFromRichText(rich);
  const clampedStart = Math.max(0, Math.min(flatStart, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(flatEnd, text.length));
  const segments: {
    paragraphIndex: number;
    runIndex: number;
    runOffset: number;
    length: number;
  }[] = [];

  for (let pos = clampedStart; pos < clampedEnd; ) {
    const m = mapping[pos];
    if (!m || m.paragraphIndex < 0) {
      pos++;
      continue;
    }
    const currentPara = m.paragraphIndex;
    const currentRun = m.runIndex;
    const runStartInRun = m.runOffset;
    const para = rich.paragraphs[currentPara];
    if (!para) {
      pos++;
      continue;
    }
    const run = para.runs[currentRun];
    if (!run) {
      pos++;
      continue;
    }
    const runEndInRun = Math.min(run.text.length, runStartInRun + (clampedEnd - pos));
    segments.push({
      paragraphIndex: currentPara,
      runIndex: currentRun,
      runOffset: runStartInRun,
      length: runEndInRun - runStartInRun,
    });
    pos += runEndInRun - runStartInRun;
  }

  return { paraSegments: segments };
}

/**
 * Replace a flat UTF-16 range in a rich-text story.
 *
 * @deprecated Prefer `replaceRichTextRange` from `./richTextOps` directly. This
 * function is a thin compatibility wrapper: it previously reimplemented range
 * rewriting and mishandled paragraph separators (a `\n` in the flat surface was
 * skipped rather than joining paragraphs). It now delegates to the canonical
 * operation so the two can never diverge again.
 */
export function richTextReplace(
  rich: RichText,
  matchFlatStart: number,
  matchFlatEnd: number,
  replacement: string,
): RichText {
  return replaceRichTextRange(rich, matchFlatStart, matchFlatEnd, replacement);
}

export function richTextSearch(
  rich: RichText,
  _flatText: string,
  matches: { start: number; end: number }[],
): RichTextMatch[] {
  return matches.map((m) => {
    const segments = flatToRichSelection(rich, m.start, m.end).paraSegments;
    return {
      flatStart: m.start,
      flatEnd: m.end,
      paragraphs: segments,
    };
  });
}
