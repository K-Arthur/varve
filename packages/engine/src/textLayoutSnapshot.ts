/**
 * Canonical text layout snapshot.
 *
 * `layoutText()` is the authoritative derived layout for a logical source
 * string: paragraph itemization (UAX #9 + scripts), word-level line breaking
 * (never inside a grapheme), line-local visual run ordering (UAX #9 X8/L2),
 * positioned glyphs, cluster-safe caret stops, and selection geometry.
 *
 * The snapshot is derived and revisioned; it is never serialized as document
 * content. Source text remains logical Unicode order throughout.
 *
 * `buildTextLayoutSnapshot()` is retained as a single-paragraph compatibility
 * entry point for consumers that already hold a `TextShaping` result.
 */

import { type BreakUnit, graphemeBreakUnits, segmentBreakUnits } from './text/lineBreak';
import type { ItemizedParagraph } from './text/paragraphs';
import { itemizeParagraph, splitParagraphs } from './text/paragraphs';
import { lineVisualRuns } from './text/visualOrder';
import type { ShapedGlyph, ShapedRun, TextShaping } from './types';
import {
  createUnicodeIndexMap,
  normalizeGraphemeRange,
  snapUtf16Offset,
  type UnicodeIndexMap,
} from './unicode/unicodeIndices';

export type CaretAffinity = 'leading' | 'trailing';

export interface TextLayoutIdentity {
  sourceRevision: string;
  fontRevision: string;
  maxWidth: number;
  lineHeight: number | null;
  paragraphSpacing: number;
  direction: 'ltr' | 'rtl';
  language: string;
  featureKey: string;
  variationKey: string;
}

export interface PositionedGlyph extends ShapedGlyph {
  /** Exclusive source UTF-16 cluster end (document-local). */
  sourceEnd: number;
  /** Line-local origin in CSS pixels. */
  x: number;
  /** Baseline-relative y offset in CSS pixels. */
  y: number;
}

export interface TextLayoutRun {
  /** Document-local source start. */
  sourceStart: number;
  /** Document-local source end. */
  sourceEnd: number;
  /** Run origin x within the line. */
  x: number;
  width: number;
  direction: 'ltr' | 'rtl';
  level: number;
  /** Positioned glyphs in visual order. */
  glyphs: readonly PositionedGlyph[];
  sourceRun: ShapedRun;
}

export interface TextLayoutLine {
  /** Index of the containing paragraph. */
  paragraphIndex: number;
  /** Document-local logical start. */
  sourceStart: number;
  /** Document-local logical end (exclusive). */
  sourceEnd: number;
  top: number;
  baseline: number;
  height: number;
  width: number;
  /** Runs in visual (left-to-right) order. */
  runs: readonly TextLayoutRun[];
  /** Document-local cluster starts in the line's visual traversal order. */
  visualClusters: readonly number[];
}

export interface CaretStop {
  /** Document-local logical offset. */
  offset: number;
  lineIndex: number;
  x: number;
  affinity: CaretAffinity;
  direction: 'ltr' | 'rtl';
}

export interface SelectionRect {
  lineIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayoutParagraphInfo {
  index: number;
  sourceStart: number;
  sourceEnd: number;
  baseDirection: 'ltr' | 'rtl';
  baseLevel: number;
  /** First line index (exclusive end at `lineEnd`). */
  lineStart: number;
  lineEnd: number;
}

export interface TextLayoutSnapshot {
  text: string;
  sourceMap: UnicodeIndexMap;
  identity: TextLayoutIdentity;
  paragraphs: readonly TextLayoutParagraphInfo[];
  lines: readonly TextLayoutLine[];
  caretStops: readonly CaretStop[];
  width: number;
  height: number;
  baseDirection: 'ltr' | 'rtl';
  diagnostics: readonly string[];
}

export interface BuildTextLayoutSnapshotOptions {
  maxWidth: number;
  sourceRevision?: string;
  fontRevision?: string;
  lineHeight?: number;
  paragraphSpacing?: number;
  language?: string;
  featureKey?: string;
  variationKey?: string;
}

/** One paragraph's logical-order shaped runs for `layoutText`. */
export interface LayoutParagraphInput {
  paragraph: ItemizedParagraph;
  /** Logical-order runs; glyph `clusterUtf16` is paragraph-local. */
  runs: readonly ShapedRun[];
}

export interface LayoutTextInput {
  text: string;
  paragraphs: readonly LayoutParagraphInput[];
  maxWidth: number;
  sourceRevision?: string;
  fontRevision?: string;
  lineHeight?: number;
  paragraphSpacing?: number;
  language?: string;
  featureKey?: string;
  variationKey?: string;
  /** Paragraph direction override ('auto' = first-strong). */
  direction?: 'auto' | 'ltr' | 'rtl';
}

/** Logical-order glyph record with paragraph-local cluster bounds. */
interface GlyphRecord {
  run: ShapedRun;
  glyph: ShapedGlyph;
  clusterStart: number;
  clusterEnd: number;
}

interface LayoutUnit {
  unit: BreakUnit;
  records: readonly GlyphRecord[];
  width: number;
}

interface RawLine {
  units: readonly LayoutUnit[];
  width: number;
}

/**
 * Lay out a full logical string through the canonical pipeline. Paragraphs
 * must come from `itemizeText` (or equivalent) and carry logical-order shaped
 * runs with paragraph-local cluster offsets.
 */
export function layoutText(input: LayoutTextInput): TextLayoutSnapshot {
  const sourceMap = createUnicodeIndexMap(input.text);
  const maxWidth = Math.max(0, input.maxWidth);
  const lines: TextLayoutLine[] = [];
  const paragraphInfos: TextLayoutParagraphInfo[] = [];
  const caretStops: CaretStop[] = [];
  const baseDirection = paragraphBaseDirection(input.paragraphs, input.direction);
  const identity: TextLayoutIdentity = {
    sourceRevision: input.sourceRevision ?? 'unknown',
    fontRevision: input.fontRevision ?? 'unknown',
    maxWidth,
    lineHeight: input.lineHeight ?? null,
    paragraphSpacing: Math.max(0, input.paragraphSpacing ?? 0),
    direction: baseDirection,
    language: input.language ?? '',
    featureKey: input.featureKey ?? '',
    variationKey: input.variationKey ?? '',
  };
  const diagnostics: string[] = [];

  for (const { paragraph, runs } of input.paragraphs) {
    const records = buildGlyphRecords(runs, paragraph.text.length);
    if (records.some((record) => record.glyph.glyphId === 0)) {
      diagnostics.push('shaping contains unknown glyph IDs; geometry may be approximate');
    }
    const paragraphLineStart = lines.length;
    // One paragraph-local source map feeds units, wrapping, and caret stops
    // (Intl.Segmenter segmentation is the pipeline's most expensive primitive).
    const paragraphMap = createUnicodeIndexMap(paragraph.text);
    const paragraphLines = layoutParagraphLines(
      paragraph,
      records,
      maxWidth,
      input.lineHeight ?? null,
      paragraphMap,
    );
    const paragraphTop =
      lines.length > 0
        ? lines[lines.length - 1]!.top +
          lines[lines.length - 1]!.height +
          Math.max(0, input.paragraphSpacing ?? 0)
        : 0;
    const positionedParagraphLines = paragraphLines.map((line) => shiftLine(line, paragraphTop));
    for (const line of positionedParagraphLines) lines.push(line);
    paragraphInfos.push({
      index: paragraph.index,
      sourceStart: paragraph.sourceStart,
      sourceEnd: paragraph.sourceEnd,
      baseDirection: paragraph.baseDirection,
      baseLevel: paragraph.baseLevel,
      lineStart: paragraphLineStart,
      lineEnd: lines.length,
    });
    caretStops.push(
      ...buildCaretStops(paragraph, positionedParagraphLines, paragraphLineStart, paragraphMap),
    );
  }

  const width = lines.reduce((largest, line) => Math.max(largest, line.width), 0);
  const height =
    lines.length === 0 ? 0 : lines[lines.length - 1]!.top + lines[lines.length - 1]!.height;

  return {
    text: input.text,
    sourceMap,
    identity,
    paragraphs: paragraphInfos,
    lines,
    caretStops,
    width,
    height,
    baseDirection,
    diagnostics,
  };
}

function shiftLine(line: TextLayoutLine, yOffset: number): TextLayoutLine {
  if (yOffset === 0) return line;
  return {
    ...line,
    top: line.top + yOffset,
    baseline: line.baseline + yOffset,
    runs: line.runs.map((run) => ({
      ...run,
      glyphs: run.glyphs.map((glyph) => ({ ...glyph, y: glyph.y + yOffset })),
    })),
  };
}

function paragraphBaseDirection(
  paragraphs: readonly LayoutParagraphInput[],
  direction?: 'auto' | 'ltr' | 'rtl',
): 'ltr' | 'rtl' {
  if (direction === 'ltr' || direction === 'rtl') return direction;
  return paragraphs[0]?.paragraph.baseDirection ?? 'ltr';
}

/**
 * Build logical-order glyph records with paragraph-local cluster bounds.
 * A cluster end is the next distinct cluster start in the paragraph, or the
 * paragraph length for the final cluster.
 */
function buildGlyphRecords(runs: readonly ShapedRun[], textLength: number): GlyphRecord[] {
  const clusterStarts = [...new Set(runs.flatMap((run) => run.glyphs.map((g) => g.clusterUtf16)))]
    .filter((offset) => offset >= 0 && offset < textLength)
    .sort((a, b) => a - b);
  // O(1) cluster-end lookup instead of a per-glyph scan (10k-char paragraphs
  // must not degrade to quadratic time).
  const endByStart = new Map<number, number>();
  for (let i = 0; i < clusterStarts.length; i++) {
    endByStart.set(clusterStarts[i]!, clusterStarts[i + 1] ?? textLength);
  }
  const records: GlyphRecord[] = [];
  for (const run of runs) {
    for (const glyph of run.glyphs) {
      records.push({
        run,
        glyph,
        clusterStart: glyph.clusterUtf16,
        clusterEnd: endByStart.get(glyph.clusterUtf16) ?? textLength,
      });
    }
  }
  return records;
}

/** Group glyph records by cluster start (logical order per cluster). */
function recordsByCluster(records: readonly GlyphRecord[]): Map<number, GlyphRecord[]> {
  const byCluster = new Map<number, GlyphRecord[]>();
  for (const record of records) {
    const list = byCluster.get(record.clusterStart) ?? [];
    list.push(record);
    byCluster.set(record.clusterStart, list);
  }
  return byCluster;
}

/**
 * Segment the paragraph into width-annotated break units. Over-long words are
 * re-broken at grapheme boundaries so a single unbreakable word still wraps.
 */
function buildLayoutUnits(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  maxWidth: number,
  sourceMap: UnicodeIndexMap,
): LayoutUnit[] {
  const byCluster = recordsByCluster(records);
  const attach = graphemeAttachList(sourceMap, byCluster);
  const units: LayoutUnit[] = [];
  let attachCursor = 0;
  for (const unit of segmentBreakUnits(paragraph.text)) {
    // Units and grapheme attachments are both sorted: advance the cursor
    // instead of rescanning the attach list per unit.
    while (attachCursor < attach.length && attach[attachCursor]!.start < unit.start) {
      attachCursor++;
    }
    units.push(makeLayoutUnit(unit, attach, attachCursor));
  }
  if (maxWidth > 0 && records.length > 0) {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i]!;
      if (unit.width > maxWidth && unit.unit.isWord && unit.records.length > 1) {
        const pieces = graphemeBreakUnits(
          unit.unit.start,
          unit.unit.end,
          paragraph.text,
          sourceMap,
        );
        let pieceCursor = attachCursorOf(attach, pieces[0]!.start);
        units.splice(
          i,
          1,
          ...pieces.map((piece) => {
            pieceCursor = nextAttachCursor(attach, pieceCursor, piece.start);
            return makeLayoutUnit(piece, attach, pieceCursor);
          }),
        );
        i += pieces.length - 1;
      }
    }
  }
  return units;
}

function attachCursorOf(
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  start: number,
): number {
  let cursor = 0;
  while (cursor < attach.length && attach[cursor]!.start < start) cursor++;
  return cursor;
}

function nextAttachCursor(
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  cursor: number,
  start: number,
): number {
  while (cursor < attach.length && attach[cursor]!.start < start) cursor++;
  return cursor;
}

/** Records attached per grapheme start, in source order (shared across units). */
function graphemeAttachList(
  sourceMap: UnicodeIndexMap,
  byCluster: Map<number, GlyphRecord[]>,
): Array<{ start: number; records: readonly GlyphRecord[] }> {
  const list: Array<{ start: number; records: readonly GlyphRecord[] }> = [];
  const boundaries = sourceMap.graphemeBoundaries;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const graphemeStart = boundaries[i]!;
    const graphemeEnd = boundaries[i + 1]!;
    const records: GlyphRecord[] = [];
    for (let cluster = graphemeStart; cluster < graphemeEnd; cluster++) {
      const attached = byCluster.get(cluster);
      if (attached) records.push(...attached);
    }
    list.push({ start: graphemeStart, records });
  }
  return list;
}

function makeLayoutUnit(
  unit: BreakUnit,
  attach: Array<{ start: number; records: readonly GlyphRecord[] }>,
  attachCursor: number,
): LayoutUnit {
  const records: GlyphRecord[] = [];
  for (let i = attachCursor; i < attach.length; i++) {
    const entry = attach[i]!;
    if (entry.start >= unit.end) break;
    records.push(...entry.records);
  }
  const width = records.reduce((sum, record) => sum + Math.max(0, record.glyph.xAdvance), 0);
  return { unit, records, width };
}

/**
 * Greedy word-level wrapping. Whitespace never starts a new line and is never
 * dropped: it stays attached to the current line so every source offset
 * remains reachable by a caret (trailing spaces may overflow the line width
 * and are trimmed at paint time). A word that does not fit starts a new line.
 * The paragraph's logical order is preserved: visual reordering happens per
 * line afterwards.
 */
function wrapLines(
  paragraph: ItemizedParagraph,
  units: readonly LayoutUnit[],
  maxWidth: number,
): RawLine[] {
  const lines: RawLine[] = [];
  let current: LayoutUnit[] = [];
  let currentWidth = 0;
  const flush = (): void => {
    if (current.length > 0) {
      lines.push({ units: current, width: currentWidth });
      current = [];
      currentWidth = 0;
    }
  };
  for (const unit of units) {
    if (
      maxWidth > 0 &&
      unit.width > 0 &&
      current.length > 0 &&
      currentWidth + unit.width > maxWidth
    ) {
      if (!unit.unit.isWhitespace) {
        // A word does not fit: wrap before it.
        flush();
      }
    }
    current.push(unit);
    currentWidth += unit.width;
  }
  flush();
  if (lines.length === 0 && paragraph.text.length === 0) {
    return [{ units: [], width: 0 }];
  }
  return lines;
}

/** Lay out one paragraph into positioned lines (left-aligned line boxes). */
function layoutParagraphLines(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  maxWidth: number,
  lineHeightOverride: number | null,
  sourceMap: UnicodeIndexMap,
): TextLayoutLine[] {
  const units = buildLayoutUnits(paragraph, records, maxWidth, sourceMap);
  const rawLines = wrapLines(paragraph, units, maxWidth);
  const lines: TextLayoutLine[] = [];
  let top = 0;
  for (const raw of rawLines) {
    const runLineHeight = raw.units
      .flatMap((unit) => unit.records)
      .reduce((largest, record) => Math.max(largest, record.run.lineHeight ?? 0), 0);
    lines.push(positionLine(paragraph, raw, top, Math.max(lineHeightOverride ?? 0, runLineHeight)));
    top += lines[lines.length - 1]!.height;
  }
  return lines;
}

/** Position one raw line into a TextLayoutLine with visual run order. */
function positionLine(
  paragraph: ItemizedParagraph,
  raw: RawLine,
  top: number,
  lineHeightOverride: number | null,
): TextLayoutLine {
  const byCluster = recordsByCluster(raw.units.flatMap((unit) => unit.records));
  const clusters = [...byCluster.keys()].sort((a, b) => a - b);
  const logicalStart = clusters.length > 0 ? clusters[0]! : 0;
  const logicalEnd =
    clusters.length > 0 ? Math.max(...clusters.map((c) => byCluster.get(c)![0]!.clusterEnd)) : 0;
  const visualRuns = lineVisualRuns(paragraph, logicalStart, logicalEnd);

  const groups: Array<{ visualRun: (typeof visualRuns)[number]; records: GlyphRecord[] }> = [];
  for (const visualRun of visualRuns) {
    const runClusters = clusters
      .filter((cluster) => cluster >= visualRun.start && cluster < visualRun.end)
      .sort((a, b) => (visualRun.direction === 'rtl' ? b - a : a - b));
    const runRecords = runClusters.flatMap((cluster) => byCluster.get(cluster) ?? []);
    let current: GlyphRecord[] = [];
    let currentSourceRun: ShapedRun | undefined;
    for (const record of runRecords) {
      if (currentSourceRun !== undefined && record.run !== currentSourceRun) {
        groups.push({ visualRun, records: current });
        current = [];
      }
      currentSourceRun = record.run;
      current.push(record);
    }
    if (current.length > 0) groups.push({ visualRun, records: current });
  }

  const positioned: PositionedGlyph[] = [];
  const lineRuns: TextLayoutRun[] = [];
  let ascent = 0;
  let descent = 0;
  for (const group of groups) {
    const sourceRun = group.records[0]!.run;
    ascent = Math.max(ascent, sourceRun.ascent);
    descent = Math.max(descent, sourceRun.descent);
  }
  const baseline = top + ascent;
  let runLeft = 0;
  for (const group of groups) {
    const sourceRun = group.records[0]!.run;
    const runWidth = group.records.reduce(
      (sum, record) => sum + Math.max(0, record.glyph.xAdvance),
      0,
    );
    const glyphs = positionRunGlyphs(paragraph, group.records, runLeft, runWidth, baseline);
    const minX = Math.min(...glyphs.map((g) => g.x));
    lineRuns.push({
      sourceStart: Math.min(...glyphs.map((glyph) => glyph.clusterUtf16)),
      sourceEnd: Math.max(...glyphs.map((glyph) => glyph.sourceEnd)),
      x: minX,
      width: runWidth,
      direction: sourceRun.direction,
      level: sourceRun.level,
      glyphs,
      sourceRun,
    });
    positioned.push(...glyphs);
    runLeft += runWidth;
  }

  const width = raw.width;
  const height = Math.max(lineHeightOverride ?? 0, ascent + descent);
  const visualClusters = distinctClusterStarts(positioned);
  return {
    paragraphIndex: paragraph.index,
    sourceStart: paragraph.sourceStart + logicalStart,
    sourceEnd: paragraph.sourceStart + logicalEnd,
    top,
    baseline: top + ascent,
    height,
    width,
    runs: lineRuns,
    visualClusters,
  };
}

/**
 * Position one visual run's glyphs. Glyphs arrive in visual order (left-to-
 * right on screen) from the shaping backend, so the pen always advances
 * positively; run direction only affects caret/selection edge semantics.
 */
function positionRunGlyphs(
  paragraph: ItemizedParagraph,
  records: readonly GlyphRecord[],
  runLeft: number,
  _runWidth: number,
  baseline: number,
): PositionedGlyph[] {
  const positioned: PositionedGlyph[] = [];
  let cursor = runLeft;
  for (const record of records) {
    positioned.push({
      ...record.glyph,
      sourceEnd: paragraph.sourceStart + record.clusterEnd,
      x: cursor + record.glyph.xOffset,
      y: baseline + record.glyph.yOffset,
      clusterUtf16: paragraph.sourceStart + record.glyph.clusterUtf16,
    });
    cursor += Math.max(0, record.glyph.xAdvance);
  }
  return positioned;
}

function distinctClusterStarts(glyphs: readonly PositionedGlyph[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const glyph of glyphs) {
    if (!seen.has(glyph.clusterUtf16)) {
      seen.add(glyph.clusterUtf16);
      result.push(glyph.clusterUtf16);
    }
  }
  return result;
}

/**
 * Cluster-safe caret stops per line: leading/trailing stops per distinct
 * shaped cluster plus line-edge stops. Offsets are snapped to extended
 * grapheme boundaries so a shaper that reports per-character clusters can
 * never create an illegal insertion point inside a combining sequence.
 */
function buildCaretStops(
  paragraph: ItemizedParagraph,
  lines: readonly TextLayoutLine[],
  lineIndexOffset = 0,
  sourceMap: UnicodeIndexMap = createUnicodeIndexMap(paragraph.text),
): CaretStop[] {
  const snap = (paragraphLocal: number, bias: 'floor' | 'ceil'): number =>
    paragraph.sourceStart + snapUtf16Offset(sourceMap, paragraphLocal, bias);
  const stops: CaretStop[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    const baseRtl = paragraph.baseLevel % 2 === 1;
    stops.push({
      offset: line.sourceStart,
      lineIndex: lineIndex + lineIndexOffset,
      x: baseRtl ? line.width : 0,
      affinity: 'leading',
      direction: paragraph.baseDirection,
    });
    stops.push({
      offset: line.sourceEnd,
      lineIndex: lineIndex + lineIndexOffset,
      x: baseRtl ? 0 : line.width,
      affinity: 'trailing',
      direction: paragraph.baseDirection,
    });
    for (const run of line.runs) {
      const isRtl = run.direction === 'rtl';
      let previousCluster = -1;
      for (const glyph of run.glyphs) {
        const clusterStart = snap(glyph.clusterUtf16 - paragraph.sourceStart, 'floor');
        if (clusterStart === previousCluster) continue;
        previousCluster = clusterStart;
        const clusterEnd = snap(glyph.sourceEnd - paragraph.sourceStart, 'ceil');
        const before = isRtl ? glyph.x + glyph.xAdvance : glyph.x;
        const after = isRtl ? glyph.x : glyph.x + glyph.xAdvance;
        stops.push({
          offset: clusterStart,
          lineIndex: lineIndex + lineIndexOffset,
          x: before,
          affinity: 'leading',
          direction: run.direction,
        });
        stops.push({
          offset: clusterEnd,
          lineIndex: lineIndex + lineIndexOffset,
          x: after,
          affinity: 'trailing',
          direction: run.direction,
        });
      }
    }
  }
  return dedupeCaretStops(stops);
}

function dedupeCaretStops(stops: readonly CaretStop[]): CaretStop[] {
  const seen = new Set<string>();
  return stops.filter((stop) => {
    // Same line, offset, affinity, AND x: a line-edge stop and a cluster
    // boundary can share an offset with different x (RTL line ends); both
    // positions are legal caret locations and must be kept.
    const key = `${stop.lineIndex}:${stop.offset}:${stop.affinity}:${Math.round(stop.x * 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Single-paragraph compatibility entry point. `shaping.runs` must be in
 * logical order with document-local cluster offsets (single paragraph).
 */
export function buildTextLayoutSnapshot(
  text: string,
  shaping: TextShaping,
  options: BuildTextLayoutSnapshotOptions,
): TextLayoutSnapshot {
  const direction = shaping.baseDirection === 'rtl' ? 'rtl' : 'ltr';
  // Plain text arrives shaped as one continuous run set, but an explicit
  // U+000A still has to start a new line. Splitting here (rather than teaching
  // wrapLines about newlines, which only ever breaks on maxWidth) reuses the
  // multi-paragraph path that rich text already takes, so caret stops, BiDi
  // run ordering, and blank-line height all keep working.
  const paragraphs =
    text.length === 0
      ? [{ paragraph: emptyItemizedParagraph(shaping.baseDirection), runs: shaping.runs }]
      : splitParagraphs(text).map((range) => ({
          paragraph: itemizeParagraph(range, direction),
          runs: sliceRunsForParagraph(shaping.runs, range.start, range.end),
        }));
  return layoutText({
    text,
    paragraphs,
    maxWidth: options.maxWidth,
    sourceRevision: options.sourceRevision,
    fontRevision: options.fontRevision,
    lineHeight: options.lineHeight ?? shaping.height,
    paragraphSpacing: options.paragraphSpacing,
    language: options.language,
    featureKey: options.featureKey,
    variationKey: options.variationKey,
  });
}

/**
 * Narrow whole-string shaped runs to one paragraph, rebasing glyph clusters to
 * paragraph-local offsets (what `layoutText` expects).
 *
 * The newline itself sits at `end`, so it falls outside every slice and never
 * reaches a painter — the break is carried by the paragraph split instead of by
 * a glyph.
 */
function sliceRunsForParagraph(
  runs: readonly ShapedRun[],
  start: number,
  end: number,
): ShapedRun[] {
  const sliced: ShapedRun[] = [];
  for (const run of runs) {
    const glyphs: ShapedGlyph[] = [];
    let width = 0;
    for (const glyph of run.glyphs) {
      if (glyph.clusterUtf16 < start || glyph.clusterUtf16 >= end) continue;
      glyphs.push({ ...glyph, clusterUtf16: glyph.clusterUtf16 - start });
      width += glyph.xAdvance;
    }
    if (glyphs.length > 0) sliced.push({ ...run, glyphs, width });
  }
  return sliced;
}

function emptyItemizedParagraph(direction: 'ltr' | 'rtl'): ItemizedParagraph {
  return {
    index: 0,
    sourceStart: 0,
    sourceEnd: 0,
    text: '',
    baseDirection: direction,
    baseLevel: direction === 'rtl' ? 1 : 0,
    runs: [],
    levels: [],
    mirroredCharacters: new Map(),
    scriptedRuns: [],
  };
}

/** Map a snapshot's line/width coordinates onto the object layout (kept). */
export function hitTestTextLayout(snapshot: TextLayoutSnapshot, x: number, y: number): CaretStop {
  const lineIndex = snapshot.lines.reduce((best, line, index) => {
    const bestLine = snapshot.lines[best]!;
    const bestDistance = distanceToLine(bestLine, y);
    const distance = distanceToLine(line, y);
    return distance < bestDistance ? index : best;
  }, 0);
  const line = snapshot.lines[lineIndex];
  if (!line) {
    return {
      offset: 0,
      lineIndex: 0,
      x: 0,
      affinity: 'leading',
      direction: snapshot.baseDirection,
    };
  }
  const candidates = snapshot.caretStops.filter((stop) => stop.lineIndex === lineIndex);
  return candidates.reduce(
    (best, candidate) => (Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best),
    candidates[0] ?? {
      offset: line.sourceStart,
      lineIndex,
      x: snapshot.baseDirection === 'rtl' ? line.width : 0,
      affinity: 'leading' as const,
      direction: snapshot.baseDirection,
    },
  );
}

function distanceToLine(line: TextLayoutLine, y: number): number {
  if (y < line.top) return line.top - y;
  if (y > line.top + line.height) return y - (line.top + line.height);
  return 0;
}

export function textLayoutSnapshotCacheKey(text: string, identity: TextLayoutIdentity): string {
  return JSON.stringify([
    text,
    identity.sourceRevision,
    identity.fontRevision,
    identity.maxWidth,
    identity.lineHeight,
    identity.direction,
    identity.language,
    identity.featureKey,
    identity.variationKey,
  ]);
}

/**
 * Selection geometry for a logical range: one or more visually discontiguous
 * rectangles per line. Endpoints are snapped to grapheme boundaries; whole
 * lines selected produce a full-line rectangle.
 */
export function selectionRects(
  snapshot: TextLayoutSnapshot,
  start: number,
  end: number,
): SelectionRect[] {
  const range = normalizeGraphemeRange(snapshot.sourceMap, start, end);
  const rects: SelectionRect[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex++) {
    const line = snapshot.lines[lineIndex]!;
    if (range.start <= line.sourceStart && range.end >= line.sourceEnd) {
      rects.push({ lineIndex, x: 0, y: line.top, width: line.width, height: line.height });
      continue;
    }
    const selected = line.runs.flatMap((run) =>
      run.glyphs.filter((glyph) => glyph.clusterUtf16 < range.end && glyph.sourceEnd > range.start),
    );
    if (selected.length === 0) continue;
    const ordered = [...selected].sort((a, b) => a.x - b.x);
    let fragment: PositionedGlyph[] = [];
    const flush = (): void => {
      if (fragment.length === 0) return;
      const left = Math.min(...fragment.map((glyph) => glyph.x));
      const right = Math.max(...fragment.map((glyph) => glyph.x + glyph.xAdvance));
      rects.push({ lineIndex, x: left, y: line.top, width: right - left, height: line.height });
      fragment = [];
    };
    for (const glyph of ordered) {
      const previous = fragment[fragment.length - 1];
      if (previous && glyph.x > previous.x + previous.xAdvance + 0.01) flush();
      fragment.push(glyph);
    }
    flush();
  }
  return rects;
}

export class TextLayoutSnapshotCache {
  private readonly entries = new Map<string, TextLayoutSnapshot>();

  constructor(private readonly maxEntries = 128) {}

  get(key: string): TextLayoutSnapshot | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, snapshot: TextLayoutSnapshot): void {
    this.entries.delete(key);
    this.entries.set(key, snapshot);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
