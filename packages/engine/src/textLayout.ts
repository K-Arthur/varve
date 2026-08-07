/**
 * Rich text layout engine.
 * Lays out mixed-format rich text into measured lines for canvas rendering.
 * Handles per-run font sizing, wrapping, and overflow detection.
 *
 * Phase B: Replaced estimateTextWidth with real canvas measureText when
 * available (browser/DOM). Falls back to proportional estimate in non-DOM
 * environments (tests, SSR). Added CJK-aware line breaking via Intl.Segmenter
 * when available, with fallback to whitespace splitting.
 *
 * Research basis: CanvasRenderingContext2D.measureText, Intl.Segmenter (UAX #14),
 * Figma text layout engine, HarfBuzz line breaking.
 */

import type { OpenTypeFeatureMap, VariableFontSettings } from './types';

export interface RichTextRun {
  text: string;
  format?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    textDecoration?: 'none' | 'underline' | 'line-through';
    letterSpacing?: number;
    tracking?: number;
    openTypeFeatures?: OpenTypeFeatureMap;
    variableFontSettings?: VariableFontSettings;
    maxLines?: number;
    /** Run color (ManagedColor since schema 2.14; legacy tuples accepted). */
    color?: import('@varve/shared').ManagedColorShim | readonly [number, number, number, number];
  };
}

export interface RichTextParagraph {
  runs: RichTextRun[];
  format?: { maxLines?: number };
}

export interface RichTextInput {
  paragraphs: RichTextParagraph[];
}

export interface LayoutLine {
  runs: LayoutRun[];
  width: number;
  height: number;
}

export interface LayoutRun {
  text: string;
  format: {
    fontSize: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: string;
    textDecoration?: 'none' | 'underline' | 'line-through';
    /** Run color carried through layout; applied by the renderer. */
    color?: import('@varve/shared').ManagedColorShim | readonly [number, number, number, number];
  };
  font: string;
  featureSettings: string;
  variationSettings: string;
  width: number;
  height: number;
  /** X position of this run within its line. */
  x: number;
  /** Y position of this run's baseline within the layout. */
  y: number;
}

export interface RichTextLayout {
  lines: LayoutLine[];
  width: number;
  height: number;
  overset: boolean;
}

export function buildFontString(
  fontSize: number,
  fontFamily: string,
  fontWeight?: number,
  fontStyle?: string,
): string {
  const weight = fontWeight ? `${fontWeight} ` : '';
  const style = fontStyle && fontStyle !== 'normal' ? `${fontStyle} ` : '';
  return `${style}${weight}${fontSize}px ${fontFamily}`;
}

function buildFeatureSettings(openTypeFeatures?: OpenTypeFeatureMap): string {
  if (!openTypeFeatures || Object.keys(openTypeFeatures).length === 0) return '';
  const entries = Object.entries(openTypeFeatures).filter(([k]) => k !== 'custom');
  const custom = openTypeFeatures.custom;
  if (custom) entries.push(...Object.entries(custom));
  if (entries.length === 0) return '';
  const features = entries.map(([k, v]) => `"${k}" ${v ? 1 : 0}`).join(', ');
  return `font-feature-settings: ${features}`;
}

function buildVariationSettings(variableFontSettings?: VariableFontSettings): string {
  if (!variableFontSettings || Object.keys(variableFontSettings).length === 0) return '';
  const axes = Object.entries(variableFontSettings)
    .map(([k, v]) => `"${k}" ${v}`)
    .join(', ');
  return `font-variation-settings: ${axes}`;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

/** Cached offscreen canvas for measureText calls (created lazily). */
let measureCanvas: HTMLCanvasElement | null = null;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas');
  }
  return measureCanvas.getContext('2d');
}

/** Measure text width using canvas measureText when available, else estimate. */
export function measureRunWidth(text: string, font: string, fontSize: number): number {
  const ctx = getMeasureContext();
  if (ctx) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }
  return estimateTextWidth(text, fontSize);
}

/** CJK Unicode range detection for line breaking. */
function isCJK(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
    (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
    (code >= 0x3040 && code <= 0x309f) || // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) || // Katakana
    (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
  );
}

/** Contains CJK characters that allow breaking between any two chars. */
function containsCJK(text: string): boolean {
  for (const char of text) {
    if (isCJK(char)) return true;
  }
  return false;
}

/** Intl.Segmenter for word-level segmentation (cached). */
let segmenter: Intl.Segmenter | null = null;

function getWordSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
  if (!segmenter) {
    segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  }
  return segmenter;
}

/** Split text into breakable units (words + spaces, or CJK chars). */
function splitIntoBreakUnits(text: string): string[] {
  const seg = getWordSegmenter();
  if (seg && containsCJK(text)) {
    const units: string[] = [];
    for (const { segment } of seg.segment(text)) {
      units.push(segment);
    }
    return units;
  }
  return text.split(/(\s+)/);
}

export function layoutRichText(
  richText: RichTextInput,
  maxWidth: number,
  defaultFormat: { fontSize: number; fontFamily: string },
): RichTextLayout {
  const lines: LayoutLine[] = [];
  let totalWidth = 0;
  let totalHeight = 0;
  let overset = false;
  let lineCount = 0;

  for (const paragraph of richText.paragraphs) {
    const maxLines = paragraph.format?.maxLines ?? Infinity;
    let currentLine: LayoutRun[] = [];
    let currentLineWidth = 0;
    let currentLineHeight = 0;

    for (const run of paragraph.runs) {
      const fontSize = run.format?.fontSize ?? defaultFormat.fontSize;
      const fontFamily = run.format?.fontFamily ?? defaultFormat.fontFamily;
      const fontWeight = run.format?.fontWeight;
      const fontStyle = run.format?.fontStyle;
      const textDecoration = run.format?.textDecoration;

      const font = buildFontString(fontSize, fontFamily, fontWeight, fontStyle);
      const featureSettings = buildFeatureSettings(run.format?.openTypeFeatures);
      const variationSettings = buildVariationSettings(run.format?.variableFontSettings);

      const words = splitIntoBreakUnits(run.text);
      const runTracking = run.format?.tracking ?? 0;
      for (const word of words) {
        if (word === '') continue;
        const trackingWidth = (runTracking * fontSize * Math.max(word.length - 1, 0)) / 1000;
        const wordWidth = measureRunWidth(word, font, fontSize) + trackingWidth;

        if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
          if (lineCount >= maxLines - 1) {
            overset = true;
            break;
          }
          lines.push({
            runs: currentLine.map((r) => ({
              ...r,
              width: measureRunWidth(r.text, r.font, r.format.fontSize),
              height: r.format.fontSize * 1.2,
            })),
            width: currentLineWidth,
            height: currentLineHeight || fontSize * 1.2,
          });
          totalHeight += currentLineHeight || fontSize * 1.2;
          totalWidth = Math.max(totalWidth, currentLineWidth);
          lineCount++;
          currentLine = [];
          currentLineWidth = 0;
          currentLineHeight = 0;
        }

        currentLine.push({
          text: word,
          format: {
            fontSize,
            fontFamily,
            fontWeight,
            fontStyle: fontStyle ?? 'normal',
            textDecoration,
            color: run.format?.color,
          },
          font,
          featureSettings,
          variationSettings,
          width: wordWidth,
          height: fontSize * 1.2,
          x: currentLineWidth,
          y: 0,
        });
        currentLineWidth += wordWidth;
        currentLineHeight = Math.max(currentLineHeight, fontSize * 1.2);
      }

      if (overset) break;
    }

    if (currentLine.length > 0 && !overset) {
      lines.push({
        runs: currentLine.map((r) => ({
          ...r,
          width: measureRunWidth(r.text, r.font, r.format.fontSize),
          height: r.format.fontSize * 1.2,
        })),
        width: currentLineWidth,
        height: currentLineHeight || defaultFormat.fontSize * 1.2,
      });
      totalHeight += currentLineHeight;
      totalWidth = Math.max(totalWidth, currentLineWidth);
      lineCount++;
    }

    if (overset) break;
  }

  // Recalculate y per line based on accumulated line heights.
  let y = 0;
  for (const line of lines) {
    const lineHeight = line.runs.reduce((max, r) => Math.max(max, r.height), 0);
    for (const run of line.runs) {
      run.y = y + run.height * 0.8; // approximate baseline from top of line
    }
    y += lineHeight;
  }

  return { lines, width: totalWidth, height: totalHeight, overset };
}
