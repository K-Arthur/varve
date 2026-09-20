/**
 * Build a canonical layout snapshot for the engine's rich-text IR.
 *
 * Rich spans remain logical source ranges. Each styled segment is shaped
 * independently only at a formatting boundary, then the paragraph itemizer
 * and line visual-order pass assemble those results into one snapshot.
 * Canvas measurement remains an explicit fallback until a font-byte shaper
 * supplies the same request for every segment.
 */

import { textMeasureRevision, variationSettingsKey } from '@varve/shared';
import { inheritedFontReference } from './font/fontFaceInheritance';
import type { FontReference } from './font/fontIdentity';
import { fontReferenceKey } from './font/fontIdentity';
import { scriptCodeToTag, shapeRun } from './shaping';
import { type ItemizedParagraph, itemizeParagraph, type ParagraphRange } from './text/paragraphs';
import type { TextLayoutSnapshot } from './textLayoutSnapshot';
import { type LayoutParagraphInput, layoutText } from './textLayoutSnapshot';
import type {
  OpenTypeFeatureMap,
  RichText,
  ShapedRun,
  TextOrientation,
  TextRun,
  WritingMode,
} from './types';

export interface RichTextMeasureContext {
  font: string;
  measureText(text: string): TextMetrics;
}

export interface RichTextLayoutDefaults {
  fontFamily: string;
  fontReference?: FontReference;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  letterSpacing: number;
  tracking: number;
  lineHeight?: number;
  direction?: 'ltr' | 'rtl' | 'auto';
  language?: string;
  openTypeFeatures?: OpenTypeFeatureMap;
  variableAxes?: Record<string, number>;
  writingMode?: WritingMode;
  textOrientation?: TextOrientation;
}

export interface RichTextLayoutOptions {
  maxWidth: number;
  /** Per-line width limits for contour (balloon) wrapping. */
  lineWidths?: readonly number[] | undefined;
  lineHeight: number;
  paragraphSpacing?: number;
  sourceRevision?: string;
  fontRevision?: string;
  language?: string;
  writingMode?: WritingMode;
  textOrientation?: TextOrientation;
  /** Optional caller-provided additions to the canonical typography identity. */
  featureKey?: string;
  variationKey?: string;
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
        const runFamily = format.fontFamily ?? defaults.fontFamily;
        const runReference = inheritedFontReference(
          defaults.fontFamily,
          defaults.fontReference,
          format.fontFamily,
          format.fontReference,
        );
        const lineHeight =
          (format.lineHeight ?? defaults.lineHeight ?? 1.4) *
          (format.fontSize ?? defaults.fontSize);
        const runs = shapeRun({
          text,
          fontFamily: runFamily,
          fontSize: format.fontSize ?? defaults.fontSize,
          fontWeight: format.fontWeight ?? defaults.fontWeight,
          fontStyle: format.fontStyle ?? defaults.fontStyle,
          letterSpacing: format.letterSpacing ?? defaults.letterSpacing,
          tracking: format.tracking ?? defaults.tracking,
          openTypeFeatures: format.openTypeFeatures ?? defaults.openTypeFeatures,
          variableAxes: format.variableFontSettings ?? defaults.variableAxes,
          fontReference: runReference,
          direction: scripted.direction,
          language: format.language ?? defaults.language,
          ctx: ctx as unknown as CanvasRenderingContext2D,
        });
        for (const run of runs) {
          shaped.push(
            cloneRunWithOffset(
              { ...run, lineHeight },
              cursor,
              scriptCodeToTag(scripted.script),
              scripted.level,
            ),
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

/** Stable JSON for authored feature maps, including ranged settings. */
function stableTypographyValue(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableTypographyValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableTypographyValue(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function typographyIdentityKeys(
  richText: RichText,
  defaults: RichTextLayoutDefaults,
): { featureKey: string; variationKey: string; faceKey: string } {
  const featureValues = [
    defaults.openTypeFeatures,
    ...richText.paragraphs.flatMap((paragraph) =>
      paragraph.runs.map((run) => run.format?.openTypeFeatures ?? defaults.openTypeFeatures),
    ),
  ];
  const variationValues = [
    variationSettingsKey(defaults.variableAxes),
    ...richText.paragraphs.flatMap((paragraph) =>
      paragraph.runs.map((run) =>
        variationSettingsKey(run.format?.variableFontSettings ?? defaults.variableAxes),
      ),
    ),
  ];
  const faceValues = [
    defaults.fontReference,
    ...richText.paragraphs.flatMap((paragraph) =>
      paragraph.runs.map((run) =>
        inheritedFontReference(
          defaults.fontFamily,
          defaults.fontReference,
          run.format?.fontFamily,
          run.format?.fontReference,
        ),
      ),
    ),
  ]
    .filter((reference): reference is FontReference => reference !== undefined)
    .map((reference) => fontReferenceKey(reference));
  return {
    featureKey: stableTypographyValue(featureValues),
    variationKey: variationValues.join('|'),
    faceKey: faceValues.join('|'),
  };
}

/** Build one snapshot for all logical rich-text paragraphs. */
export function layoutRichTextSnapshot(
  richText: RichText,
  defaults: RichTextLayoutDefaults,
  ctx: RichTextMeasureContext,
  options: RichTextLayoutOptions,
): TextLayoutSnapshot {
  const typographyKeys = typographyIdentityKeys(richText, defaults);
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
    lineWidths: options.lineWidths,
    lineHeight: options.lineHeight,
    paragraphSpacing: options.paragraphSpacing,
    sourceRevision: options.sourceRevision,
    fontRevision: [options.fontRevision ?? textMeasureRevision(), typographyKeys.faceKey]
      .filter(Boolean)
      .join('|'),
    language: options.language ?? defaults.language,
    writingMode: options.writingMode ?? defaults.writingMode,
    textOrientation: options.textOrientation ?? defaults.textOrientation,
    featureKey: [typographyKeys.featureKey, options.featureKey ?? ''].filter(Boolean).join('|'),
    variationKey: [typographyKeys.variationKey, options.variationKey ?? '']
      .filter(Boolean)
      .join('|'),
  });
}
