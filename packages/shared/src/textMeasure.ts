/**
 * Text measurement & wrapping utilities (Strata plan Phase B).
 *
 * Provides canvas-independent text measurement using a simulated measureText
 * that gives deterministic metrics based on font size. In a full browser
 * environment, this delegates to ctx.measureText() for accurate results.
 *
 * Research basis: CanvasRenderingContext2D.measureText(), CSS word-wrap,
 * Figma text resizing model.
 */

export interface TextMeasureOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  /** Typographic tracking in 1/1000 em, matching the renderer's `tracking`. */
  tracking?: number;
  lineHeight?: number;
  /** Extra leading between paragraphs, in px. Not applied before the first. */
  paragraphSpacing?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  variableAxes?: Record<string, number>;
}

export interface MeasuredLine {
  text: string;
  width: number;
  height: number;
}

export interface TextMeasureResult {
  lines: MeasuredLine[];
  width: number;
  height: number;
}

export interface TextMetricsResult {
  lines: MeasuredLine[];
  width: number;
  height: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontMetrics: {
    ascent: number;
    descent: number;
    lineGap: number;
  };
}

export type MeasureTextFn = (
  text: string,
  options: TextMeasureOptions,
) => { width: number; height: number };

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT = 1.4;
const CHAR_WIDTH_RATIO = 0.6;

function applyTextCase(text: string, textCase?: string): string {
  if (!textCase || textCase === 'none') return text;
  switch (textCase) {
    case 'uppercase':
      return text.toUpperCase();
    case 'lowercase':
      return text.toLowerCase();
    case 'capitalize':
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    default:
      return text;
  }
}

function estimateCharWidth(fontSize: number): number {
  return fontSize * CHAR_WIDTH_RATIO;
}

/**
 * A source of real glyph advances for a font that is actually loaded.
 *
 * The estimate below is character-count-based and therefore identical for
 * every family — which is why scene bounds could never move when a font
 * became ready. A runtime backend (Canvas2D in the browser) registers here so
 * every existing `measureText` / `textWrap` / `measureRun` caller becomes
 * font-accurate without acquiring a rendering dependency of its own.
 *
 * `revision` must change whenever the set of usable faces changes, so caches
 * built on these measurements can be identified as stale.
 */
export interface TextAdvanceMeasurer {
  /** Advance width in px, or `null` when this font cannot be measured yet. */
  measureAdvance(text: string, options: TextMeasureOptions): number | null;
  /** Monotone identity of the currently usable face set. */
  revision(): string;
}

let advanceMeasurer: TextAdvanceMeasurer | null = null;

/** Install (or clear, with `null`) the runtime glyph-advance backend. */
export function setTextAdvanceMeasurer(next: TextAdvanceMeasurer | null): void {
  advanceMeasurer = next;
}

/**
 * Identity of the measurements this module currently produces.
 *
 * Any cache holding font-dependent geometry must include this in its key or
 * compare it before reuse: a box measured against a fallback face must not
 * survive the real face becoming usable.
 */
export function textMeasureRevision(): string {
  return advanceMeasurer?.revision() ?? 'text-measure:estimated';
}

/** Per-character spacing the renderer adds after each glyph (letter + tracking). */
function perCharSpacing(
  options: Pick<TextMeasureOptions, 'letterSpacing' | 'tracking' | 'fontSize'>,
): number {
  const ls = options.letterSpacing ?? 0;
  const tracking = options.tracking ?? 0;
  return ls + (tracking * (options.fontSize ?? DEFAULT_FONT_SIZE)) / 1000;
}

/**
 * Width of one line: real advances when a backend is installed, the
 * deterministic estimate otherwise, plus letter-spacing/tracking gaps.
 *
 * Spacing is counted between glyphs (n - 1), not after the last one — the
 * trailing advance moves the caret but paints no ink, so including it would
 * make every selection box wider than the text it encloses.
 */
export function measureAdvanceWidth(text: string, options: TextMeasureOptions): number {
  if (text.length === 0) return 0;
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const measured = advanceMeasurer?.measureAdvance(text, options) ?? null;
  const base = measured ?? text.length * estimateCharWidth(fs);
  return base + (text.length - 1) * perCharSpacing(options);
}

function estimateLineHeight(fontSize: number, lineHeight?: number): number {
  return fontSize * (lineHeight ?? DEFAULT_LINE_HEIGHT);
}

function buildFontString(options: TextMeasureOptions): string {
  const style = options.fontStyle === 'italic' ? 'italic ' : '';
  const weight = options.fontWeight ? `${options.fontWeight} ` : '';
  return `${style}${weight}${options.fontSize ?? DEFAULT_FONT_SIZE}px ${options.fontFamily}`;
}

export function measureTextWithCanvas(
  ctx: CanvasRenderingContext2D,
  text: string,
  options: TextMeasureOptions,
): TextMetricsResult {
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const displayText = applyTextCase(text, options.textCase);

  ctx.font = buildFontString(options);

  const rawLines = displayText.split('\n');
  const lines: MeasuredLine[] = [];
  let maxWidth = 0;
  let totalHeight = 0;
  let maxAscent = 0;
  let maxDescent = 0;

  for (const rawLine of rawLines) {
    const metrics = ctx.measureText(rawLine);
    const canvasWidth = metrics.width;
    const spacingWidth = rawLine.length > 0 ? (rawLine.length - 1) * perCharSpacing(options) : 0;
    const lineWidth = canvasWidth + spacingWidth;
    const lineHeight = estimateLineHeight(fs, lh);

    lines.push({ text: rawLine, width: lineWidth, height: lineHeight });
    maxWidth = Math.max(maxWidth, lineWidth);
    totalHeight += lineHeight;
    maxAscent = Math.max(maxAscent, metrics.actualBoundingBoxAscent);
    maxDescent = Math.max(maxDescent, metrics.actualBoundingBoxDescent);
  }

  const fontMetrics = {
    ascent: maxAscent || estimateCharWidth(fs),
    descent: maxDescent || estimateCharWidth(fs) * 0.25,
    lineGap: 0,
  };

  return {
    lines,
    width: maxWidth,
    height: totalHeight,
    actualBoundingBoxAscent: maxAscent,
    actualBoundingBoxDescent: maxDescent,
    fontMetrics,
  };
}

export function measureText(text: string, options: TextMeasureOptions): TextMeasureResult {
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const displayText = applyTextCase(text, options.textCase);

  const rawLines = displayText.split('\n');
  const lines: MeasuredLine[] = [];
  let maxWidth = 0;
  let totalHeight = 0;

  const paragraphSpacing = options.paragraphSpacing ?? 0;
  for (const rawLine of rawLines) {
    const w = measureAdvanceWidth(rawLine, options);
    const h = estimateLineHeight(fs, lh);
    lines.push({ text: rawLine, width: w, height: h });
    maxWidth = Math.max(maxWidth, w);
    totalHeight += h;
  }
  // Explicit breaks start new paragraphs, and the renderer leads each one
  // after the first by `paragraphSpacing`. Bounds that omit it stop short of
  // the last line.
  totalHeight += Math.max(0, rawLines.length - 1) * paragraphSpacing;

  return { lines, width: maxWidth, height: totalHeight };
}

function measureTextWidth(
  text: string,
  options: TextMeasureOptions,
  ctx?: CanvasRenderingContext2D,
): number {
  if (ctx) {
    const metrics = ctx.measureText(text);
    const spacingWidth = text.length > 0 ? (text.length - 1) * perCharSpacing(options) : 0;
    return metrics.width + spacingWidth;
  }
  return measureAdvanceWidth(text, options);
}

export function textWrap(
  text: string,
  maxWidth: number,
  options: TextMeasureOptions,
  ctx?: CanvasRenderingContext2D,
): MeasuredLine[] {
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const displayText = applyTextCase(text, options.textCase);

  if (ctx) {
    ctx.font = buildFontString(options);
  }

  const paragraphs = displayText.split('\n');
  const result: MeasuredLine[] = [];

  for (const para of paragraphs) {
    const words = para.split(' ');
    let currentLine = '';
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = measureTextWidth(word, options, ctx);
      const spaceWidth = currentLine.length > 0 ? measureTextWidth(' ', options, ctx) : 0;

      if (currentLine.length > 0 && currentWidth + spaceWidth + wordWidth > maxWidth) {
        result.push({
          text: currentLine,
          width: currentWidth,
          height: estimateLineHeight(fs, lh),
        });
        currentLine = word;
        currentWidth = wordWidth;
      } else {
        if (currentLine.length > 0) {
          currentLine += ' ';
          currentWidth += spaceWidth;
        }
        currentLine += word;
        currentWidth += wordWidth;
      }
    }

    // Empty paragraphs and trailing newlines still occupy a line box. Dropping
    // them makes scene bounds disagree with the renderer and the textarea.
    if (currentLine.length > 0 || (para.length === 0 && paragraphs.length > 1)) {
      result.push({
        text: currentLine,
        width: currentWidth,
        height: estimateLineHeight(fs, lh),
      });
    }
  }

  return result;
}

export function measureWrappedText(
  text: string,
  maxWidth: number,
  options: TextMeasureOptions,
): TextMeasureResult {
  const lines = textWrap(text, maxWidth, options);
  let maxW = 0;
  let totalH = 0;
  for (const line of lines) {
    maxW = Math.max(maxW, line.width);
    totalH += line.height;
  }
  return { lines, width: maxW, height: totalH };
}

// ── Rich Text Run Measurement ───────────────────────────────────────────────

export interface RunMeasureOptions {
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  letterSpacing?: number;
  lineHeight?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  variableFontSettings?: Record<string, number>;
}

export interface MeasuredRun {
  text: string;
  width: number;
  height: number;
  format: RunMeasureOptions;
}

export interface MeasuredParagraph {
  runs: MeasuredRun[];
  width: number;
  height: number;
}

export interface RichTextMeasureResult {
  paragraphs: MeasuredParagraph[];
  width: number;
  height: number;
}

function buildFontStringFromRun(opts: RunMeasureOptions): string {
  const style = opts.fontStyle === 'italic' ? 'italic ' : '';
  const weight = opts.fontWeight ? `${opts.fontWeight} ` : '';
  return `${style}${weight}${opts.fontSize}px ${opts.fontFamily}`;
}

export function measureRun(
  text: string,
  format: RunMeasureOptions,
  ctx?: CanvasRenderingContext2D,
): MeasuredRun {
  const fs = format.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = format.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const displayText = applyTextCase(text, format.textCase);

  let width: number;
  if (ctx) {
    ctx.font = buildFontStringFromRun(format);
    const metrics = ctx.measureText(displayText);
    const spacingWidth =
      displayText.length > 0 ? (displayText.length - 1) * perCharSpacing(format) : 0;
    width = metrics.width + spacingWidth;
  } else {
    width = measureAdvanceWidth(displayText, format);
  }

  const height = estimateLineHeight(fs, lh);
  return { text: displayText, width, height, format };
}

export function measureRichText(
  paragraphs: Array<{ runs: Array<{ text: string; format?: RunMeasureOptions }> }>,
  defaultFormat: RunMeasureOptions,
  ctx?: CanvasRenderingContext2D,
): RichTextMeasureResult {
  const measuredParas: MeasuredParagraph[] = [];
  let maxWidth = 0;
  let totalHeight = 0;

  for (const para of paragraphs) {
    const runs: MeasuredRun[] = [];
    let paraWidth = 0;
    let paraHeight = 0;

    for (const run of para.runs) {
      const format = run.format ?? defaultFormat;
      const measured = measureRun(run.text, format, ctx);
      runs.push(measured);
      paraWidth += measured.width;
      paraHeight = Math.max(paraHeight, measured.height);
    }

    measuredParas.push({ runs, width: paraWidth, height: paraHeight });
    maxWidth = Math.max(maxWidth, paraWidth);
    totalHeight += paraHeight;
  }

  return { paragraphs: measuredParas, width: maxWidth, height: totalHeight };
}

// ── Variable Font CSS Builder ───────────────────────────────────────────────

export function buildVariationSettingsCSS(settings?: Record<string, number>): string | undefined {
  if (!settings || Object.keys(settings).length === 0) return undefined;
  const parts = Object.entries(settings)
    .map(([tag, value]) => `"${tag}" ${value}`)
    .join(', ');
  return `font-variation-settings: ${parts};`;
}

export function buildFeatureSettingsCSS(features?: Record<string, boolean>): string | undefined {
  if (!features || Object.keys(features).length === 0) return undefined;
  const parts = Object.entries(features)
    .map(([tag, on]) => `"${tag}" ${on ? '1' : '0'}`)
    .join(', ');
  return `font-feature-settings: ${parts};`;
}
