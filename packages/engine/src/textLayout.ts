/**
 * Rich text layout engine.
 * Lays out mixed-format rich text into measured lines for canvas rendering.
 * Handles per-run font sizing, wrapping, and overflow detection.
 */

export interface RichTextRun {
  text: string;
  format?: {
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    openTypeFeatures?: Record<string, boolean>;
    variableFontSettings?: Record<string, number>;
    maxLines?: number;
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
}

export interface LayoutRun {
  text: string;
  format: { fontSize: number; fontFamily?: string; fontWeight?: number; fontStyle?: string };
  font: string;
  featureSettings: string;
  variationSettings: string;
  width: number;
  height: number;
}

export interface RichTextLayout {
  lines: LayoutLine[];
  width: number;
  height: number;
  overset: boolean;
}

function buildFontString(
  fontSize: number,
  fontFamily: string,
  fontWeight?: number,
  fontStyle?: string,
): string {
  const weight = fontWeight ? `${fontWeight} ` : '';
  const style = fontStyle && fontStyle !== 'normal' ? `${fontStyle} ` : '';
  return `${style}${weight}${fontSize}px ${fontFamily}`;
}

function buildFeatureSettings(openTypeFeatures?: Record<string, boolean>): string {
  if (!openTypeFeatures || Object.keys(openTypeFeatures).length === 0) return '';
  const features = Object.entries(openTypeFeatures)
    .map(([k, v]) => `"${k}" ${v ? 1 : 0}`)
    .join(', ');
  return `font-feature-settings: ${features}`;
}

function buildVariationSettings(variableFontSettings?: Record<string, number>): string {
  if (!variableFontSettings || Object.keys(variableFontSettings).length === 0) return '';
  const axes = Object.entries(variableFontSettings)
    .map(([k, v]) => `"${k}" ${v}`)
    .join(', ');
  return `font-variation-settings: ${axes}`;
}

function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

function measureRunFallback(text: string, fontSize: number): { width: number } {
  return { width: estimateTextWidth(text, fontSize) };
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

      const font = buildFontString(fontSize, fontFamily, fontWeight, fontStyle);
      const featureSettings = buildFeatureSettings(run.format?.openTypeFeatures);
      const variationSettings = buildVariationSettings(run.format?.variableFontSettings);

      const words = run.text.split(/(\s+)/);
      for (const word of words) {
        const wordWidth = measureRunFallback(word, fontSize).width;

        if (currentLineWidth + wordWidth > maxWidth && currentLine.length > 0) {
          if (lineCount >= maxLines - 1) {
            overset = true;
            break;
          }
          lines.push({
            runs: currentLine.map((r) => ({
              ...r,
              width: measureRunFallback(r.text, r.format.fontSize).width,
              height: r.format.fontSize * 1.2,
            })),
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
          format: { fontSize, fontFamily, fontWeight, fontStyle: fontStyle ?? 'normal' },
          font,
          featureSettings,
          variationSettings,
          width: wordWidth,
          height: fontSize * 1.2,
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
          width: measureRunFallback(r.text, r.format.fontSize).width,
          height: r.format.fontSize * 1.2,
        })),
      });
      totalHeight += currentLineHeight;
      totalWidth = Math.max(totalWidth, currentLineWidth);
      lineCount++;
    }

    if (overset) break;
  }

  return { lines, width: totalWidth, height: totalHeight, overset };
}
