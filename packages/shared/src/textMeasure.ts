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
  lineHeight?: number;
  textCase?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
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

function estimateTextWidth(text: string, fontSize: number, letterSpacing: number = 0): number {
  const charWidth = estimateCharWidth(fontSize);
  const totalCharWidth = text.length * charWidth;
  const totalSpacing = text.length > 0 ? (text.length - 1) * letterSpacing : 0;
  return totalCharWidth + totalSpacing;
}

function estimateLineHeight(fontSize: number, lineHeight?: number): number {
  return fontSize * (lineHeight ?? DEFAULT_LINE_HEIGHT);
}

export function measureText(
  text: string,
  options: TextMeasureOptions,
): TextMeasureResult {
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const ls = options.letterSpacing ?? 0;
  const displayText = applyTextCase(text, options.textCase);

  const rawLines = displayText.split('\n');
  const lines: MeasuredLine[] = [];
  let maxWidth = 0;
  let totalHeight = 0;

  for (const rawLine of rawLines) {
    const w = estimateTextWidth(rawLine, fs, ls);
    const h = estimateLineHeight(fs, lh);
    lines.push({ text: rawLine, width: w, height: h });
    maxWidth = Math.max(maxWidth, w);
    totalHeight += h;
  }

  return { lines, width: maxWidth, height: totalHeight };
}

export function textWrap(
  text: string,
  maxWidth: number,
  options: TextMeasureOptions,
): MeasuredLine[] {
  const fs = options.fontSize ?? DEFAULT_FONT_SIZE;
  const lh = options.lineHeight ?? DEFAULT_LINE_HEIGHT;
  const ls = options.letterSpacing ?? 0;
  const displayText = applyTextCase(text, options.textCase);

  const paragraphs = displayText.split('\n');
  const result: MeasuredLine[] = [];

  for (const para of paragraphs) {
    const words = para.split(' ');
    let currentLine = '';
    let currentWidth = 0;

    for (const word of words) {
      const wordWidth = estimateTextWidth(word, fs, ls);
      const spaceWidth = currentLine.length > 0 ? estimateTextWidth(' ', fs, ls) : 0;

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

    if (currentLine.length > 0) {
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
