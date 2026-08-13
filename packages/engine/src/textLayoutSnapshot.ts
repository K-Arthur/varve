import type { ShapedGlyph, ShapedRun, TextShaping } from './types';
import {
  createUnicodeIndexMap,
  snapUtf16Offset,
  type UnicodeIndexMap,
} from './unicode/unicodeIndices';

export type CaretAffinity = 'leading' | 'trailing';

export interface TextLayoutIdentity {
  sourceRevision: string;
  fontRevision: string;
  maxWidth: number;
  lineHeight: number | null;
  direction: 'ltr' | 'rtl';
  language: string;
  featureKey: string;
  variationKey: string;
}

export interface PositionedGlyph extends ShapedGlyph {
  /** Exclusive source UTF-16 cluster end. */
  sourceEnd: number;
  /** Line-local origin in CSS pixels. */
  x: number;
  /** Baseline-relative y offset in CSS pixels. */
  y: number;
}

export interface TextLayoutRun {
  sourceStart: number;
  sourceEnd: number;
  x: number;
  width: number;
  direction: 'ltr' | 'rtl';
  level: number;
  glyphs: readonly PositionedGlyph[];
  sourceRun: ShapedRun;
}

export interface TextLayoutLine {
  sourceStart: number;
  sourceEnd: number;
  top: number;
  baseline: number;
  height: number;
  width: number;
  runs: readonly TextLayoutRun[];
  /** Source UTF-16 cluster starts in the line's visual traversal order. */
  visualClusters: readonly number[];
}

export interface CaretStop {
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

export interface TextLayoutSnapshot {
  text: string;
  sourceMap: UnicodeIndexMap;
  identity: TextLayoutIdentity;
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
  language?: string;
  featureKey?: string;
  variationKey?: string;
}

interface GlyphRecord {
  run: ShapedRun;
  glyph: ShapedGlyph;
  sourceEnd: number;
}

/**
 * Turn one shaped result into the derived geometry consumed by later render,
 * caret, selection, and export layers. The source string remains logical;
 * `TextShaping.visualRuns` is used when available for visual traversal.
 */
export function buildTextLayoutSnapshot(
  text: string,
  shaping: TextShaping,
  options: BuildTextLayoutSnapshotOptions,
): TextLayoutSnapshot {
  const sourceMap = createUnicodeIndexMap(text);
  const maxWidth = Math.max(0, options.maxWidth);
  const lineHeight = options.lineHeight ?? shaping.height;
  const identity: TextLayoutIdentity = {
    sourceRevision: options.sourceRevision ?? 'unknown',
    fontRevision: options.fontRevision ?? 'unknown',
    maxWidth,
    lineHeight: options.lineHeight ?? null,
    direction: shaping.direction,
    language: options.language ?? '',
    featureKey: options.featureKey ?? '',
    variationKey: options.variationKey ?? '',
  };
  const records = buildGlyphRecords(text, sourceMap, shaping.visualRuns ?? shaping.runs);
  const lines = buildLines(text, records, maxWidth, lineHeight);
  const caretStops = buildCaretStops(text, lines);
  const width = lines.reduce((largest, line) => Math.max(largest, line.width), 0);
  const height =
    lines.length === 0 ? 0 : lines[lines.length - 1]!.top + lines[lines.length - 1]!.height;

  return {
    text,
    sourceMap,
    identity,
    lines,
    caretStops,
    width,
    height,
    baseDirection: shaping.baseDirection,
    diagnostics: shaping.runs.some((run) => run.glyphs.some((glyph) => glyph.glyphId === 0))
      ? ['shaping contains unknown glyph IDs; geometry may be approximate']
      : [],
  };
}

function buildGlyphRecords(
  text: string,
  sourceMap: UnicodeIndexMap,
  runs: readonly ShapedRun[],
): GlyphRecord[] {
  const starts = [
    ...new Set(
      runs.flatMap((run) =>
        run.glyphs.map((glyph) => snapUtf16Offset(sourceMap, glyph.clusterUtf16, 'floor')),
      ),
    ),
  ]
    .filter((offset) => offset >= 0 && offset < text.length)
    .sort((a, b) => a - b);
  const endFor = (start: number): number => {
    const next = starts.find((candidate) => candidate > start);
    return next ?? text.length;
  };
  const records: GlyphRecord[] = [];
  for (const run of runs) {
    for (const glyph of run.glyphs) {
      const clusterUtf16 = snapUtf16Offset(sourceMap, glyph.clusterUtf16, 'floor');
      records.push({
        run,
        glyph: clusterUtf16 === glyph.clusterUtf16 ? glyph : { ...glyph, clusterUtf16 },
        sourceEnd: endFor(clusterUtf16),
      });
    }
  }
  return records;
}

function buildLines(
  text: string,
  records: readonly GlyphRecord[],
  maxWidth: number,
  lineHeight: number,
): TextLayoutLine[] {
  const lines: TextLayoutLine[] = [];
  let current: GlyphRecord[] = [];
  let currentWidth = 0;
  const flush = (): void => {
    const lineIndex = lines.length;
    lines.push(buildLine(current, currentWidth, lineIndex, lineHeight));
    current = [];
    currentWidth = 0;
  };

  for (const record of records) {
    const source = text.slice(record.glyph.clusterUtf16, record.sourceEnd);
    if (source.includes('\n')) {
      if (current.length > 0) flush();
      else lines.push(buildLine([], 0, lines.length, lineHeight));
      continue;
    }
    const advance = Math.max(0, record.glyph.xAdvance);
    if (current.length > 0 && maxWidth > 0 && currentWidth + advance > maxWidth) flush();
    current.push(record);
    currentWidth += advance;
  }
  if (current.length > 0 || lines.length === 0) flush();
  return lines;
}

function buildLine(
  records: readonly GlyphRecord[],
  width: number,
  lineIndex: number,
  lineHeight: number,
): TextLayoutLine {
  const ascent = records.reduce((largest, record) => Math.max(largest, record.run.ascent), 0);
  const height = Math.max(
    lineHeight,
    records.reduce(
      (largest, record) => Math.max(largest, record.run.ascent + record.run.descent),
      0,
    ),
  );
  const top = lineIndex * height;
  const baseline = top + ascent;
  let cursorX = 0;
  const positioned = records.map((record) => {
    const positionedGlyph: PositionedGlyph = {
      ...record.glyph,
      sourceEnd: record.sourceEnd,
      x: cursorX,
      y: baseline + record.glyph.yOffset,
    };
    cursorX += Math.max(0, record.glyph.xAdvance);
    return { record, positionedGlyph };
  });
  const runMap = new Map<ShapedRun, PositionedGlyph[]>();
  for (const { record, positionedGlyph } of positioned) {
    const glyphs = runMap.get(record.run) ?? [];
    glyphs.push(positionedGlyph);
    runMap.set(record.run, glyphs);
  }
  const runs: TextLayoutRun[] = [];
  for (const [sourceRun, glyphs] of runMap) {
    const sourceStart = Math.min(...glyphs.map((glyph) => glyph.clusterUtf16));
    const sourceEnd = Math.max(...glyphs.map((glyph) => glyph.sourceEnd));
    const x = Math.min(...glyphs.map((glyph) => glyph.x));
    runs.push({
      sourceStart,
      sourceEnd,
      x,
      width: glyphs.reduce((sum, glyph) => sum + Math.max(0, glyph.xAdvance), 0),
      direction: sourceRun.direction,
      level: sourceRun.level,
      glyphs,
      sourceRun,
    });
  }
  return {
    sourceStart:
      records.length === 0 ? 0 : Math.min(...records.map((record) => record.glyph.clusterUtf16)),
    sourceEnd: records.length === 0 ? 0 : Math.max(...records.map((record) => record.sourceEnd)),
    top,
    baseline,
    height,
    width,
    runs,
    visualClusters: records.map((record) => record.glyph.clusterUtf16),
  };
}

function buildCaretStops(text: string, lines: readonly TextLayoutLine[]): CaretStop[] {
  const stops: CaretStop[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (line.runs.length === 0) {
      stops.push({
        offset: line.sourceStart,
        lineIndex,
        x: 0,
        affinity: 'leading',
        direction: 'ltr',
      });
      continue;
    }
    for (const run of line.runs) {
      for (const glyph of run.glyphs) {
        const before = run.direction === 'rtl' ? glyph.x + glyph.xAdvance : glyph.x;
        const after = run.direction === 'rtl' ? glyph.x : glyph.x + glyph.xAdvance;
        stops.push({
          offset: glyph.clusterUtf16,
          lineIndex,
          x: before,
          affinity: 'leading',
          direction: run.direction,
        });
        stops.push({
          offset: Math.min(text.length, glyph.sourceEnd),
          lineIndex,
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
    const key = `${stop.lineIndex}:${stop.offset}:${stop.affinity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hitTestTextLayout(snapshot: TextLayoutSnapshot, x: number, y: number): CaretStop {
  const lineIndex = snapshot.lines.reduce((best, line, index) => {
    const bestLine = snapshot.lines[best]!;
    const bestDistance = distanceToLine(bestLine, y);
    const distance = distanceToLine(line, y);
    return distance < bestDistance ? index : best;
  }, 0);
  const candidates = snapshot.caretStops.filter((stop) => stop.lineIndex === lineIndex);
  return candidates.reduce(
    (best, candidate) => (Math.abs(candidate.x - x) < Math.abs(best.x - x) ? candidate : best),
    candidates[0] ?? {
      offset: 0,
      lineIndex,
      x: 0,
      affinity: 'leading',
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

export function selectionRects(
  snapshot: TextLayoutSnapshot,
  start: number,
  end: number,
): SelectionRect[] {
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  const rects: SelectionRect[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex++) {
    const line = snapshot.lines[lineIndex]!;
    const selected = line.runs.flatMap((run) =>
      run.glyphs.filter((glyph) => glyph.clusterUtf16 < rangeEnd && glyph.sourceEnd > rangeStart),
    );
    if (selected.length === 0) continue;
    const left = Math.min(...selected.map((glyph) => glyph.x));
    const right = Math.max(...selected.map((glyph) => glyph.x + glyph.xAdvance));
    rects.push({ lineIndex, x: left, y: line.top, width: right - left, height: line.height });
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
