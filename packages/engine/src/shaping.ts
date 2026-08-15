/**
 * Text shaping bridge — produces ShapedRun[] from text + style properties.
 *
 * Research basis:
 * - HarfBuzz / rustybuzz shaping API
 * - CSS Inline Layout Module Level 3: glyph run, cluster
 * - UAX #29: grapheme clusters as caret-stop units
 *
 * Two-path architecture:
 *   1. Browser/web path (this module): relies on Canvas2D measureText for
 *      advances. The browser's native text engine (HarfBuzz via CoreText/
 *      DirectWrite/FreeType) performs GSUB/GPOS shaping when text is rendered;
 *      we derive glyph-like segment records (advance + cluster index) from
 *      per-grapheme measurement. Shaped runs are segmented by BiDi direction
 *      and Unicode script so the renderer can re-order runs and hit-test caret
 *      positions against shaped cluster boundaries, not raw UTF-16 offsets.
 *   2. Native/WASM path (future): rustybuzz produces true glyph IDs/positions
 *      for PDF export and native rendering. Same ShapedRun wire format.
 *
 * The result is the canonical layout seam between "edit/measure" and "paint":
 * all downstream consumers (replayIr, hitTest, textarea caret, export) read
 * ShapedRun[] so text direction, script, and cluster boundaries are computed
 * in exactly one place.
 */

import type { ItemizedParagraph } from './text/paragraphs';
import type { ShapedGlyph, ShapedRun, TextShaping } from './types';
import type { BidiParagraph } from './unicode/bidi';
import { analyzeParagraph } from './unicode/bidi';
import { splitGraphemes } from './unicode/grapheme';
import { dominantScript } from './unicode/script';

export interface ShapeRunInput {
  /** The text to shape (single line). */
  text: string;
  /** Font family (resolved). */
  fontFamily: string;
  /** Font size in px. */
  fontSize: number;
  /** Font weight. */
  fontWeight?: number;
  /** Font style. */
  fontStyle?: 'normal' | 'italic';
  /** Letter spacing in px. */
  letterSpacing?: number;
  /** Typographic tracking in 1/1000 em units, added between glyphs. */
  tracking?: number;
  /** Direction override ('ltr' | 'rtl' | 'auto'). */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** ISO language tag. */
  language?: string;
  /** Canvas2D context for measurement (required). */
  ctx: CanvasRenderingContext2D;
}

/** Rich-text multi-paragraph input (paragraph-level direction, per-run fonts). */
export interface ShapeRichTextInput {
  paragraphs: Array<{
    text: string;
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    letterSpacing?: number;
    tracking?: number;
    direction?: 'ltr' | 'rtl' | 'auto';
    language?: string;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
  }>;
  ctx: CanvasRenderingContext2D;
}

/** Pure tracking advance for one grapheme: (fontSize * tracking / 1000)
 *  applied between graphemes (never after the last one). */
export function graphemeTracking(
  tracking: number,
  fontSize: number,
  graphemeIndex: number,
  graphemeCount: number,
): number {
  if (tracking === 0 || graphemeIndex >= graphemeCount - 1) return 0;
  return (fontSize * tracking) / 1000;
}

function buildFontString(
  fontFamily: string,
  fontSize: number,
  fontWeight?: number,
  fontStyle?: string,
): string {
  const style = fontStyle === 'italic' ? 'italic ' : '';
  const weight = fontWeight ? `${fontWeight} ` : '';
  return `${style}${weight}${fontSize}px "${fontFamily}"`;
}

/**
 * Build the 2-letter OpenType script tag from an ISO 15924 code.
 * Simplified mapping for the scripts we detect.
 */
export function scriptCodeToTag(isoCode: string): string {
  const map: Record<string, string> = {
    Latn: 'latn',
    Arab: 'arab',
    Hebr: 'hebr',
    Syrc: 'syrc',
    Deva: 'dev2',
    Beng: 'beng',
    Guru: 'guru',
    Gujr: 'gujr',
    Orya: 'orya',
    Taml: 'taml',
    Telu: 'telu',
    Knda: 'knda',
    Mlym: 'mlym',
    Sinh: 'sinh',
    Thai: 'thai',
    Laoo: 'laoo',
    Tibt: 'tibt',
    Mymr: 'mymr',
    Geor: 'geor',
    Hang: 'hang',
    Ethi: 'ethi',
    Cher: 'cher',
    Cans: 'cans',
    Khmr: 'khmr',
    Mong: 'mong',
    Hira: 'kana',
    Kana: 'kana',
    Hani: 'hani',
    Yiii: 'yi  ',
    Vaii: 'vai ',
    Nkoo: 'nko ',
    Thaa: 'thaa',
  };
  return map[isoCode] ?? 'latn';
}

/**
 * Shape one itemized paragraph into logical-order runs for the canonical
 * layout pipeline. Glyph `clusterUtf16` values are paragraph-local and
 * glyphs are in visual order within each run (matching the shaping backend
 * contract), so `layoutText` can break lines and reorder per line without
 * further source mapping.
 *
 * This is the canvas-measurement bridge: advances come from
 * `ctx.measureText` per grapheme, `glyphId` stays 0, and contextual joining
 * (Arabic forms, Indic conjuncts) is not produced — the real shaping
 * backends (harfbuzz-wasm / rustybuzz-native) fill the same contract.
 */
export function shapeParagraphRuns(
  paragraph: ItemizedParagraph,
  ctx: CanvasRenderingContext2D,
  style: {
    fontFamily: string;
    fontSize: number;
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    letterSpacing?: number;
    tracking?: number;
    language?: string;
  },
): ShapedRun[] {
  const runs: ShapedRun[] = [];
  ctx.font = buildFontString(style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle);
  for (const scriptedRun of paragraph.scriptedRuns) {
    const runText = paragraph.text.slice(scriptedRun.start, scriptedRun.end);
    if (runText.length === 0) continue;
    const graphemes = splitGraphemes(runText);
    const glyphs: ShapedGlyph[] = [];
    let runWidth = 0;
    for (let gi = 0; gi < graphemes.length; gi++) {
      const g = graphemes[gi]!;
      const metrics = ctx.measureText(g);
      const spacing =
        (gi < graphemes.length - 1 ? (style.letterSpacing ?? 0) : 0) +
        graphemeTracking(style.tracking ?? 0, style.fontSize, gi, graphemes.length);
      const advance = metrics.width + spacing;
      glyphs.push({
        glyphId: 0,
        xAdvance: advance,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
        clusterUtf16: scriptedRun.start + graphemeStartOffset(graphemes, gi),
      });
      runWidth += advance;
    }
    if (scriptedRun.direction === 'rtl') glyphs.reverse();
    runs.push({
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight ?? 400,
      fontStyle: style.fontStyle ?? 'normal',
      direction: scriptedRun.direction,
      level: scriptedRun.level,
      script: scriptCodeToTag(scriptedRun.script),
      glyphs,
      width: runWidth,
      ascent: style.fontSize * 0.8,
      descent: style.fontSize * 0.2,
    });
  }
  return runs;
}

function graphemeStartOffset(graphemes: readonly string[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += graphemes[i]!.length;
  return offset;
}

/**
 * Shape a single text run: segment by BiDi direction, then walk grapheme
 * clusters to build shaped glyphs with advances from ctx.measureText.
 */
export function shapeRun(input: ShapeRunInput): ShapedRun[] {
  const {
    text,
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    letterSpacing = 0,
    tracking = 0,
    direction = 'auto',
    ctx,
  } = input;

  if (text.length === 0) return [];

  // Step 1: BiDi analysis of the line.
  const explicitDir = direction === 'auto' ? undefined : direction;
  const para: BidiParagraph = analyzeParagraph(text, explicitDir);

  // Set the font on the context for measurement.
  ctx.font = buildFontString(fontFamily, fontSize, fontWeight, fontStyle);

  // Step 2: For each BiDi run, segment further by script and walk graphemes.
  const allRuns: ShapedRun[] = [];

  const visualBidiRuns = para.visualRuns.length > 0 ? para.visualRuns : para.runs;
  for (const bidiRun of visualBidiRuns) {
    const runText = text.substring(bidiRun.start, bidiRun.end);

    // Walk grapheme clusters in this run.
    const graphemes = splitGraphemes(runText);
    const glyphs: ShapedGlyph[] = [];
    let cursorX = 0;

    const dominant = dominantScript(runText);
    const scriptTag = scriptCodeToTag(dominant);

    // Measure each grapheme individually for an accurate advance.
    // For complex scripts (Arabic, Devanagari, Thai) the browser's native
    // shaping engine applies GSUB/GPOS when measuring substrings that
    // include joining characters; measuring per-grapheme is the pragmatic
    // approximation that avoids double-advance from pairwise kerning.
    for (let gi = 0; gi < graphemes.length; gi++) {
      const g = graphemes[gi]!;
      const clusterUtf16 =
        bidiRun.start +
        (() => {
          // Find the UTF-16 offset of this grapheme within the run text.
          let offset = 0;
          for (let j = 0; j < gi; j++) offset += graphemes[j]!.length;
          return offset;
        })();

      // Measure the grapheme width.
      const metrics = ctx.measureText(g);
      const spacing =
        (gi < graphemes.length - 1 ? letterSpacing : 0) +
        graphemeTracking(tracking, fontSize, gi, graphemes.length);

      glyphs.push({
        glyphId: 0, // 0 = unknown (browser path); native path fills real IDs
        xAdvance: metrics.width + spacing,
        yAdvance: 0,
        xOffset: 0,
        yOffset: 0,
        clusterUtf16,
      });
      cursorX += metrics.width + spacing;
    }

    const fontSizeNum = fontSize;
    allRuns.push({
      fontFamily,
      fontSize: fontSizeNum,
      fontWeight: fontWeight ?? 400,
      fontStyle: fontStyle ?? 'normal',
      direction: bidiRun.direction,
      level: bidiRun.level,
      script: scriptTag,
      glyphs,
      width: cursorX,
      ascent: fontSizeNum * 0.8,
      descent: fontSizeNum * 0.2,
    });
  }

  return allRuns;
}

/**
 * Shape a full text primitive into a TextSharding result.
 * This is the canonical entry point used by the renderer.
 */
export function shapeText(
  text: string,
  fontFamily: string,
  fontSize: number,
  ctx: CanvasRenderingContext2D,
  opts?: {
    fontWeight?: number;
    fontStyle?: 'normal' | 'italic';
    letterSpacing?: number;
    tracking?: number;
    direction?: 'ltr' | 'rtl' | 'auto';
    language?: string;
  },
): TextShaping {
  const runs = shapeRun({
    text,
    fontFamily,
    fontSize,
    fontWeight: opts?.fontWeight,
    fontStyle: opts?.fontStyle,
    letterSpacing: opts?.letterSpacing,
    tracking: opts?.tracking,
    direction: opts?.direction ?? 'auto',
    ctx,
  });

  const isRTL = runs.length > 0 && runs[0]?.direction === 'rtl';
  const explicitDir = opts?.direction;
  const direction =
    explicitDir === 'rtl' ? 'rtl' : explicitDir === 'ltr' ? 'ltr' : isRTL ? 'rtl' : 'ltr';

  let width = 0;
  let maxAscent = 0;
  let maxDescent = 0;
  for (const r of runs) {
    width += r.width;
    maxAscent = Math.max(maxAscent, r.ascent);
    maxDescent = Math.max(maxDescent, r.descent);
  }

  return {
    runs,
    visualRuns: runs,
    width,
    height: maxAscent + maxDescent,
    baseDirection: direction,
    direction,
  };
}

/**
 * Given a shaped result and an x-offset, find the grapheme caret position.
 * Used for mouse hit-testing → cursor placement.
 */
export function hitTestCaret(shaping: TextShaping, x: number): number {
  let offset = 0;
  for (const run of shaping.runs) {
    if (x < offset + run.width) {
      // Within this run — bisect the grapheme positions.
      let cursorX = offset;
      let bestGi = 0;
      let bestDist = Math.abs(x - cursorX);
      for (let gi = 0; gi < run.glyphs.length; gi++) {
        const g = run.glyphs[gi]!;
        cursorX += g.xAdvance;
        const dist = Math.abs(x - cursorX);
        if (dist < bestDist) {
          bestDist = dist;
          bestGi = gi + 1;
        }
      }
      // Map back to UTF-16 offset.
      if (run.direction === 'rtl') {
        // RTL run: first grapheme is rightmost.
        const totalGi = run.glyphs.length;
        const logicalGi = totalGi - bestGi;
        return run.glyphs[logicalGi]?.clusterUtf16 ?? 0;
      } else if (bestGi === 0) {
        // Caret is before the first glyph — return the start of the run.
        return run.glyphs[0]?.clusterUtf16 ?? 0;
      } else {
        return (
          run.glyphs[bestGi - 1]?.clusterUtf16 ??
          run.glyphs[run.glyphs.length - 1]?.clusterUtf16 ??
          0
        );
      }
    }
    offset += run.width;
  }
  // Past the end — return last cluster of last run.
  const lastRun = shaping.runs[shaping.runs.length - 1];
  if (!lastRun) return 0;
  return lastRun.glyphs[lastRun.glyphs.length - 1]?.clusterUtf16 ?? 0;
}
