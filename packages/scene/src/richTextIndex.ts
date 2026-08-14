import { createUnicodeIndexMap, normalizeGraphemeRange, snapUtf16Offset } from '@varve/engine';
import type { Paragraph, RichText } from './typography';

export interface RichTextRunRange {
  paragraphIndex: number;
  runIndex: number;
  start: number;
  end: number;
}

export interface RichTextParagraphRange {
  paragraphIndex: number;
  start: number;
  end: number;
  text: string;
  runs: readonly RichTextRunRange[];
}

export interface RichTextIndex {
  text: string;
  paragraphs: readonly RichTextParagraphRange[];
}

/**
 * Build a logical source index for rich text. Newlines are derived separators,
 * not stored in runs; all paragraph and run ranges remain UTF-16 offsets into
 * their paragraph-local source text.
 */
export function createRichTextIndex(rich: RichText): RichTextIndex {
  let documentOffset = 0;
  const paragraphs: RichTextParagraphRange[] = [];
  for (let paragraphIndex = 0; paragraphIndex < rich.paragraphs.length; paragraphIndex++) {
    const paragraph = rich.paragraphs[paragraphIndex]!;
    const text = paragraph.runs.map((run) => run.text).join('');
    let offset = 0;
    const runs = paragraph.runs.map((run, runIndex) => {
      const range = { paragraphIndex, runIndex, start: offset, end: offset + run.text.length };
      offset += run.text.length;
      return range;
    });
    paragraphs.push({
      paragraphIndex,
      start: documentOffset,
      end: documentOffset + text.length,
      text,
      runs,
    });
    documentOffset += text.length + (paragraphIndex < rich.paragraphs.length - 1 ? 1 : 0);
  }
  return { text: paragraphs.map((paragraph) => paragraph.text).join('\n'), paragraphs };
}

export function normalizeRichTextRange(
  paragraph: Paragraph,
  start: number,
  end: number,
): { start: number; end: number } {
  const text = paragraph.runs.map((run) => run.text).join('');
  return normalizeGraphemeRange(createUnicodeIndexMap(text), start, end);
}

export function snapRichTextOffset(paragraph: Paragraph, offset: number): number {
  const text = paragraph.runs.map((run) => run.text).join('');
  return snapUtf16Offset(createUnicodeIndexMap(text), offset, 'nearest');
}

export function findRichTextRun(
  index: RichTextIndex,
  paragraphIndex: number,
  offset: number,
): RichTextRunRange | undefined {
  const paragraph = index.paragraphs[paragraphIndex];
  if (!paragraph) return undefined;
  return (
    paragraph.runs.find((run) => offset >= run.start && offset < run.end) ??
    paragraph.runs[paragraph.runs.length - 1]
  );
}
