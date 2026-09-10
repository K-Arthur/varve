/**
 * Deterministic story composition (M10, ADR-0161): derive per-frame
 * grapheme ranges for a story flowing through an ordered set of text
 * frames, using real glyph measurement (canvas measureText) and
 * grapheme-cluster segmentation (UAX #29).
 *
 * The same document revision, frame geometry, font manifest and engine
 * version produce the same ranges — composition is derived, never stored
 * authoritatively (ADR-0160). Overset is reported, never discarded.
 *
 * Frame ranges are grapheme offsets into the story text (logical order);
 * BiDi reordering and shaping happen at paint time in the renderer, so
 * RTL/CJK content composes identically in logical order.
 *
 * Research basis: CanvasRenderingContext2D.measureText, Intl.Segmenter
 * (UAX #29 / UAX #14), Adobe InDesign story composition model.
 */

import { buildFontString, measureRunWidth } from './textLayout';

// Structural story types — the engine must not depend on @varve/scene
// (engine is the lower layer); scene's RichText/TextRun are structurally
// compatible with these.
export interface StoryRunFormat {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  tracking?: number;
}

export interface StoryRun {
  text: string;
  format?: StoryRunFormat;
}

export interface StoryParagraph {
  runs: StoryRun[];
}

export interface StoryContent {
  paragraphs: StoryParagraph[];
}

export interface ComposedFrameRange {
  frameId: string;
  /** Grapheme offset into the story text (inclusive). */
  startGrapheme: number;
  /** Grapheme offset (exclusive). */
  endGrapheme: number;
  /** True when the story continues past this frame. */
  overset: boolean;
}

export interface StoryFrameGeometry {
  frameId: string;
  width: number;
  height: number;
  insets?: { top?: number; right?: number; bottom?: number; left?: number };
  columnCount?: number;
  columnGap?: number;
  /** Baseline line-height override; defaults to fontSize * 1.2. */
  lineHeight?: number;
}

export interface ComposeStoryResult {
  frames: ComposedFrameRange[];
  /** Grapheme count of the full story text. */
  totalGraphemes: number;
  /** Grapheme count that did not fit any frame. */
  oversetGraphemes: number;
  /** Composition key: hash of every input that affects layout. */
  compositionKey: string;
}

export interface ComposeStoryOptions {
  storyId: string;
  content: StoryContent;
  frames: StoryFrameGeometry[];
  defaultFont: { fontSize: number; fontFamily: string };
  language?: string;
}

let graphemeSegmenter: Intl.Segmenter | null = null;

function getGraphemeSegmenter(): Intl.Segmenter | null {
  if (typeof Intl === 'undefined' || !Intl.Segmenter) return null;
  if (!graphemeSegmenter) {
    graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  }
  return graphemeSegmenter;
}

/** Split text into grapheme clusters (fallback: code points). */
export function splitGraphemes(text: string): string[] {
  const seg = getGraphemeSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const { segment } of seg.segment(text)) out.push(segment);
    return out;
  }
  return Array.from(text);
}

/** Total grapheme count of a rich text document. */
export function graphemeCount(content: StoryContent): number {
  let count = 0;
  for (const paragraph of content.paragraphs) {
    for (const run of paragraph.runs) {
      count += splitGraphemes(run.text).length;
    }
  }
  return count;
}

/** Breakable units for line breaking: words + whitespace, CJK clusters. */
export function splitBreakUnits(text: string): string[] {
  const seg = getGraphemeSegmenter();
  if (seg && /[\u3000-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text)) {
    const out: string[] = [];
    for (const { segment } of seg.segment(text)) out.push(segment);
    return out;
  }
  return text.split(/(\s+)/).filter((s) => s.length > 0);
}

function runPlan(
  run: StoryRun,
  defaultFont: { fontSize: number; fontFamily: string },
): { fontSize: number; font: string; tracking: number } {
  const fontSize = run.format?.fontSize ?? defaultFont.fontSize;
  const fontFamily = run.format?.fontFamily ?? defaultFont.fontFamily;
  const fontWeight = run.format?.fontWeight;
  const fontStyle = run.format?.fontStyle;
  return {
    fontSize,
    font: buildFontString(fontSize, fontFamily, fontWeight, fontStyle),
    tracking: run.format?.tracking ?? 0,
  };
}

function clusterWidth(
  cluster: string,
  plan: { fontSize: number; font: string; tracking: number },
): number {
  const trackingWidth = (plan.tracking * plan.fontSize * Math.max(cluster.length - 1, 0)) / 1000;
  return measureRunWidth(cluster, plan.font, plan.fontSize) + trackingWidth;
}

/**
 * Compose a story through its frames. The story is first linearized into
 * a single token stream (grapheme clusters with their run plan and
 * paragraph breaks), then frames consume the stream from one shared cursor
 * with greedy line breaking (CJK cluster-aware). This guarantees each
 * grapheme is consumed exactly once across all frames.
 */
export function composeStory(options: ComposeStoryOptions): ComposeStoryResult {
  const { content, frames } = options;
  const totalGraphemes = graphemeCount(content);

  // Linear token stream: clusters carry their run plan; paragraph breaks
  // force a line break.
  interface Token {
    cluster: string;
    width: number;
    paragraphBreak: boolean;
  }
  const tokens: Token[] = [];
  for (const paragraph of content.paragraphs) {
    for (const run of paragraph.runs) {
      const plan = runPlan(run, options.defaultFont);
      for (const unit of splitBreakUnits(run.text)) {
        for (const cluster of splitGraphemes(unit)) {
          tokens.push({ cluster, width: clusterWidth(cluster, plan), paragraphBreak: false });
        }
      }
    }
    if (tokens.length > 0) {
      // Paragraph boundary marker on the last token of the paragraph.
      tokens[tokens.length - 1]!.paragraphBreak = true;
    }
  }

  const result: ComposedFrameRange[] = [];
  let cursor = 0;

  for (const frame of frames) {
    const start = cursor;
    const box = contentBox(frame);
    const lineHeight = frame.lineHeight ?? options.defaultFont.fontSize * 1.2;
    const linesPerColumn = Math.max(1, Math.floor(box.height / lineHeight));
    const linesInFrame = linesPerColumn * box.columnCount;
    let linesFilled = 0;
    let lineWidth = 0;
    let overset = false;

    while (cursor < tokens.length) {
      const token = tokens[cursor]!;
      if (lineWidth + token.width > box.columnWidth && lineWidth > 0) {
        linesFilled++;
        if (linesFilled >= linesInFrame) {
          overset = true;
          break;
        }
        lineWidth = 0;
      }
      lineWidth += token.width;
      cursor++;
      if (token.paragraphBreak && cursor < tokens.length) {
        linesFilled++;
        if (linesFilled >= linesInFrame) {
          overset = true;
          break;
        }
        lineWidth = 0;
      }
    }

    result.push({
      frameId: frame.frameId,
      startGrapheme: start,
      endGrapheme: cursor,
      overset,
    });
    if (cursor >= tokens.length) break;
  }

  // Frames after the story ended compose as empty (explicit ranges so UI
  // never has to guess about missing entries).
  const composed = new Set(result.map((r) => r.frameId));
  for (const frame of frames) {
    if (!composed.has(frame.frameId)) {
      result.push({
        frameId: frame.frameId,
        startGrapheme: totalGraphemes,
        endGrapheme: totalGraphemes,
        overset: false,
      });
    }
  }

  const oversetGraphemes = Math.max(0, totalGraphemes - cursor);

  return {
    frames: result,
    totalGraphemes,
    oversetGraphemes,
    compositionKey: buildCompositionKey(options, totalGraphemes),
  };
}

function contentBox(frame: StoryFrameGeometry): {
  columnWidth: number;
  height: number;
  columnCount: number;
} {
  const insetLeft = frame.insets?.left ?? 0;
  const insetRight = frame.insets?.right ?? 0;
  const insetTop = frame.insets?.top ?? 0;
  const insetBottom = frame.insets?.bottom ?? 0;
  const columnCount = Math.max(1, Math.min(64, frame.columnCount ?? 1));
  const columnGap = frame.columnGap ?? 0;
  const width = Math.max(1, frame.width - insetLeft - insetRight);
  const height = Math.max(1, frame.height - insetTop - insetBottom);
  const columnWidth = Math.max(1, (width - (columnCount - 1) * columnGap) / columnCount);
  return { columnWidth, height, columnCount };
}

/**
 * Composition key: deterministic hash of every layout input — story
 * content, frame geometry, fonts, and engine version. Consumers use it to
 * invalidate caches and reject stale worker results (ADR-0161).
 */
export function buildCompositionKey(options: ComposeStoryOptions, totalGraphemes: number): string {
  const parts: string[] = ['compose-story/v1'];
  parts.push(options.storyId);
  parts.push(String(totalGraphemes));
  parts.push(`${options.defaultFont.fontFamily}@${options.defaultFont.fontSize}`);
  if (options.language) parts.push(options.language);
  for (const paragraph of options.content.paragraphs) {
    for (const run of paragraph.runs) {
      parts.push(
        `${run.text.length}:${run.format?.fontSize ?? ''}:${run.format?.fontFamily ?? ''}`,
      );
    }
  }
  for (const frame of options.frames) {
    parts.push(
      `${frame.frameId}:${frame.width}x${frame.height}:${frame.columnCount ?? 1}:${frame.columnGap ?? 0}:${frame.lineHeight ?? ''}`,
    );
  }
  return parts.join('|');
}
