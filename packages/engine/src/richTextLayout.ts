/**
 * Build a canonical layout snapshot for the engine's rich-text IR.
 *
 * Rich spans remain logical source ranges. Each styled segment is shaped
 * independently only at a formatting boundary, then the paragraph itemizer
 * and line visual-order pass assemble those results into one snapshot.
 * Canvas measurement remains an explicit fallback until a font-byte shaper
 * supplies the same request for every segment.
 */

import { scriptCodeToTag, shapeRun } from './shaping';
import { type ItemizedParagraph, itemizeParagraph, type ParagraphRange } from './text/paragraphs';
import type { TextLayoutSnapshot } from './textLayoutSnapshot';
import { type LayoutParagraphInput, layoutText } from './textLayoutSnapshot';
import type { RichText, ShapedRun, TextRun } from './types';

export interface RichTextMeasureContext {
  font: string;
  measureText(text: string): TextMetrics;
}

export interface RichTextLayoutDefaults {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  letterSpacing: number;
  tracking: number;
  direction?: 'ltr' | 'rtl' | 'auto';
  language?: string;
}

export interface RichTextLayoutOptions {
  maxWidth: number;
  lineHeight: number;
  sourceRevision?: string;
  fontRevision?: string;
  language?: string;
}

interface SpanRange {
  start: number;
  end: number;
  run: TextRun;
}

function spansForParagraph(runs: readonly TextRun[]): SpanRange[] {
  let offset = 0;
  return runs.map((run) => {
    const range = { start: offset, end: offset + run.text.length, run };
    offset = range.end;
    return range;
  });
}

function cloneRunWithOffset(
  run: ShapedRun,
  offset: number,
  script: string,
  level: number,
): ShapedRun {
  return {
    ...run,
    script,
    level,
    glyphs: run.glyphs.map((glyph) => ({
      ...glyph,
      clusterUtf16: glyph.clusterUtf16 + offset,
    })),
  };
}

function shapeParagraph(
  paragraph: ItemizedParagraph,
  sourceRuns: readonly TextRun[],
  defaults: RichTextLayoutDefaults,
  ctx: RichTextMeasureContext,
): ShapedRun[] {
  const spans = spansForParagraph(sourceRuns);
  const shaped: ShapedRun[] = [];
  for (const scripted of paragraph.scriptedRuns) {
    let cursor = scripted.start;
    while (cursor < scripted.end) {
      const span = spans.find((candidate) => cursor >= candidate.start && cursor < candidate.end);
      const end = Math.min(scripted.end, span?.end ?? scripted.end);
      const format = span?.run.format ?? {};
      const text = paragraph.text.slice(cursor, end);
      if (text.length > 0) {
        const runs = shapeRun({
          text,
          fontFamily: format.fontFamily ?? defaults.fontFamily,
          fontSize: format.fontSize ?? defaults.fontSize,
          fontWeight: format.fontWeight ?? defaults.fontWeight,
          fontStyle: format.fontStyle ?? defaults.fontStyle,
          letterSpacing: format.letterSpacing ?? defaults.letterSpacing,
          tracking: format.tracking ?? defaults.tracking,
          direction: scripted.direction,
          language: defaults.language,
          ctx: ctx as unknown as CanvasRenderingContext2D,
        });
        for (const run of runs) {
          shaped.push(
            cloneRunWithOffset(run, cursor, scriptCodeToTag(scripted.script), scripted.level),
          );
        }
      }
      cursor = end > cursor ? end : cursor + 1;
    }
  }
  return shaped;
}

function paragraphRange(index: number, text: string, start: number): ParagraphRange {
  return { index, start, end: start + text.length, text };
}

/** Build one snapshot for all logical rich-text paragraphs. */
export function layoutRichTextSnapshot(
  richText: RichText,
  defaults: RichTextLayoutDefaults,
  ctx: RichTextMeasureContext,
  options: RichTextLayoutOptions,
): TextLayoutSnapshot {
  let sourceOffset = 0;
  const paragraphs: LayoutParagraphInput[] = [];
  const sourceText: string[] = [];
  for (let index = 0; index < richText.paragraphs.length; index++) {
    const paragraph = richText.paragraphs[index];
    if (!paragraph) continue;
    const text = paragraph.runs.map((run) => run.text).join('');
    const itemized = itemizeParagraph(
      paragraphRange(index, text, sourceOffset),
      defaults.direction === 'auto' ? undefined : defaults.direction,
    );
    paragraphs.push({
      paragraph: itemized,
      runs: shapeParagraph(itemized, paragraph.runs, defaults, ctx),
    });
    sourceText.push(text);
    sourceOffset += text.length;
    if (index < richText.paragraphs.length - 1) sourceOffset += 1;
  }
  return layoutText({
    text: sourceText.join('\n'),
    paragraphs,
    maxWidth: options.maxWidth,
    lineHeight: options.lineHeight,
    sourceRevision: options.sourceRevision,
    fontRevision: options.fontRevision,
    language: options.language ?? defaults.language,
  });
}
