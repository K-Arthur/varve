import { mergeAdjacentRuns } from './richTextOps';
import type { Paragraph, RichText, TextRun } from './typography';

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

export function richTextReplace(
  rich: RichText,
  matchFlatStart: number,
  matchFlatEnd: number,
  replacement: string,
): RichText {
  const { text, mapping } = flatTextFromRichText(rich);
  if (matchFlatStart < 0 || matchFlatEnd > text.length || matchFlatStart > matchFlatEnd) {
    return rich;
  }

  const clonePara = (p: Paragraph): Paragraph => ({
    ...p,
    runs: p.runs.map((r) => ({ ...r, text: r.text })),
  });

  const result: RichText = {
    paragraphs: rich.paragraphs.map(clonePara),
  };

  const firstMapping = mapping[matchFlatStart];

  let inheritFormat: TextRun['format'] | undefined;
  let inheritStyleId: NodeId | undefined;
  if (firstMapping && firstMapping.paragraphIndex >= 0) {
    const srcPara = result.paragraphs[firstMapping.paragraphIndex];
    if (srcPara) {
      const srcRun = srcPara.runs[firstMapping.runIndex];
      if (srcRun) {
        inheritFormat = srcRun.format;
        inheritStyleId = srcRun.characterStyleId;
      }
    }
  }

  const segments = flatToRichSelection(rich, matchFlatStart, matchFlatEnd).paraSegments;

  for (const seg of segments) {
    const { paragraphIndex, runIndex, runOffset, length } = seg;
    const para = result.paragraphs[paragraphIndex];
    if (!para) continue;
    const run = para.runs[runIndex];
    if (!run) continue;

    const before = run.text.slice(0, runOffset);
    const after = run.text.slice(runOffset + length);
    run.text = before + after;
  }

  const insertParaIdx = firstMapping ? firstMapping.paragraphIndex : 0;
  const insertRunIdx = firstMapping ? firstMapping.runIndex : 0;
  const insertPara = result.paragraphs[insertParaIdx];
  if (!insertPara) return rich;

  const destRun = insertPara.runs[insertRunIdx];
  if (!destRun) {
    insertPara.runs.splice(insertRunIdx, 0, {
      text: replacement,
      format: inheritFormat,
      characterStyleId: inheritStyleId,
    });
  } else {
    destRun.text =
      destRun.text.slice(0, firstMapping?.runOffset ?? 0) +
      replacement +
      destRun.text.slice(firstMapping?.runOffset ?? 0);
  }

  result.paragraphs = result.paragraphs
    .filter((p): p is Paragraph => p !== undefined)
    .map(mergeAdjacentRuns);

  return result;
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

import type { NodeId } from './types';
