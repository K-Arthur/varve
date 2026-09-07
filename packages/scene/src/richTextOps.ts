/**
 * Rich text operations — pure functions for splitting, merging, and applying
 * character formatting to rich-text runs. Used by the editor's span editor and
 * any consumer that needs to mutate RichText without UI.
 *
 * Research basis: Figma multi-run text editing, ARIA textbox selection model.
 */

import { createUnicodeIndexMap, normalizeGraphemeRange, snapUtf16Offset } from '@varve/engine';
import type { CharacterFormat, Paragraph, RichText, TextRun } from './typography';
import { richTextToPlainText } from './typography';

// ── Run splitting ───────────────────────────────────────────────────────────

/**
 * Split a run at a UTF-16 offset, returning the two resulting runs. The
 * offset is snapped to an extended grapheme boundary so a run can never
 * split a surrogate pair, combining sequence, or ZWJ sequence. The `format`
 * is preserved on both halves; only `characterStyleId` stays with the left
 * half (the right half carries no explicit style link).
 */
export function splitRunAt(run: TextRun, offset: number): [TextRun, TextRun] {
  const safeOffset = snapUtf16Offset(createUnicodeIndexMap(run.text), offset);
  return [
    {
      text: run.text.slice(0, safeOffset),
      format: run.format,
      characterStyleId: run.characterStyleId,
    },
    { text: run.text.slice(safeOffset), format: run.format },
  ];
}

// ── Adjacent-run merging ────────────────────────────────────────────────────

/** Two runs are mergeable when their formats are structurally identical. */
export function runsMergeable(a: TextRun, b: TextRun): boolean {
  return formatsEqual(a.format, b.format) && a.characterStyleId === b.characterStyleId;
}

function formatsEqual(a: CharacterFormat | undefined, b: CharacterFormat | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    const k = aKeys[i]!;
    if (k !== bKeys[i]) return false;
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[bKeys[i]!]) {
      return false;
    }
  }
  return true;
}

/**
 * Collapse adjacent runs with identical format within a paragraph.
 * Produces a new Paragraph (does not mutate the input).
 */
export function mergeAdjacentRuns(para: Paragraph): Paragraph {
  if (para.runs.length < 2) return para;
  const merged: TextRun[] = [];
  for (const run of para.runs) {
    const prev = merged[merged.length - 1];
    if (prev && runsMergeable(prev, run)) {
      merged[merged.length - 1] = { ...prev, text: prev.text + run.text };
    } else {
      merged.push({ ...run });
    }
  }
  return { ...para, runs: merged };
}

// ── Selection-flattened run addressing ───────────────────────────────────────

/** A run address within a flattened rich-text plane. */
export interface RichSelection {
  /** UTF-16 code-unit offsets within the selected paragraph. */
  start: { paragraphIndex: number; offset: number };
  end: { paragraphIndex: number; offset: number };
}

export interface MixedCharacterValue<T> {
  value: T | undefined;
  mixed: boolean;
}

/** Read one character property across a logical selection. */
export function characterFormatValue<T extends keyof CharacterFormat>(
  rich: RichText,
  selection: RichSelection,
  key: T,
): MixedCharacterValue<CharacterFormat[T]> {
  const { start, end } = normalizeSelection(selection);
  const values: unknown[] = [];
  for (
    let paragraphIndex = start.paragraphIndex;
    paragraphIndex <= end.paragraphIndex;
    paragraphIndex++
  ) {
    const paragraph = rich.paragraphs[paragraphIndex];
    if (!paragraph) continue;
    const length = paragraphLength(paragraph);
    const rangeStart = paragraphIndex === start.paragraphIndex ? start.offset : 0;
    const rangeEnd = paragraphIndex === end.paragraphIndex ? end.offset : length;
    let cursor = 0;
    for (const run of paragraph.runs) {
      const runEnd = cursor + run.text.length;
      if (runEnd > rangeStart && cursor < rangeEnd) values.push(run.format?.[key]);
      cursor = runEnd;
    }
  }
  if (values.length === 0) return { value: undefined, mixed: false };
  const first = values[0];
  return {
    value: first as CharacterFormat[T] | undefined,
    mixed: values.some((value) => !sameFormatValue(value, first)),
  };
}

function sameFormatValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function paragraphLength(para: Paragraph): number {
  return para.runs.reduce((sum, r) => sum + r.text.length, 0);
}

/**
 * Apply a character format to every run covered by `selection`. Splits runs at
 * the selection boundaries so the format applies only to the selected range.
 * Returns a new RichText (does not mutate the input).
 */
export function applyFormatToSelection(
  rich: RichText,
  selection: RichSelection,
  format: CharacterFormat,
): RichText {
  return rewriteCharacterFormat(rich, selection, (base) => mergeFormat(base, format));
}

/** Remove selected character-format properties without disturbing others. */
export function removeCharacterFormat(
  rich: RichText,
  selection: RichSelection,
  keys: readonly (keyof CharacterFormat)[],
): RichText {
  const removed = new Set<string>(keys as readonly string[]);
  return rewriteCharacterFormat(rich, selection, (base) => {
    if (!base) return undefined;
    const next = Object.fromEntries(Object.entries(base).filter(([key]) => !removed.has(key)));
    return Object.keys(next).length > 0 ? (next as CharacterFormat) : undefined;
  });
}

/** Replace text in one paragraph while preserving surrounding run formats. */
export function replaceTextInParagraph(
  rich: RichText,
  paragraphIndex: number,
  start: number,
  end: number,
  replacement: string,
  format?: CharacterFormat,
): RichText {
  const paragraph = rich.paragraphs[paragraphIndex];
  if (!paragraph) return rich;
  const text = paragraph.runs.map((run) => run.text).join('');
  const safe = normalizeGraphemeRange(createUnicodeIndexMap(text), start, end);
  const inherited = format ?? formatAtOffset(paragraph, safe.start);
  const before = text.slice(0, safe.start);
  const after = text.slice(safe.end);
  const runs: TextRun[] = [];
  if (before) runs.push({ text: before, format: formatAtOffset(paragraph, 0) });
  if (replacement) runs.push({ text: replacement, format: inherited });
  if (after) runs.push({ text: after, format: formatAtOffset(paragraph, safe.end) });
  const paragraphs = rich.paragraphs.map((candidate, index) =>
    index === paragraphIndex ? mergeAdjacentRuns({ ...candidate, runs }) : candidate,
  );
  return { paragraphs };
}

/**
 * Replace a flat UTF-16 range in a rich-text story while retaining the
 * formatting on unaffected text. Paragraph separators are part of the flat
 * editing surface but are not stored in runs, so a replacement may have to
 * join or create paragraphs rather than deleting characters from paragraph 0.
 */
export function replaceRichTextRange(
  rich: RichText,
  start: number,
  end: number,
  replacement: string,
): RichText {
  const source = richTextToPlainText(rich);
  const normalized = normalizeGraphemeRange(createUnicodeIndexMap(source), start, end);
  const safeStart = normalized.start;
  const safeEnd = normalized.end;
  const startAddress = flatOffsetToAddress(rich, safeStart);
  const endAddress = flatOffsetToAddress(rich, safeEnd);
  const startParagraph = rich.paragraphs[startAddress.paragraphIndex];
  const endParagraph = rich.paragraphs[endAddress.paragraphIndex];
  if (!startParagraph || !endParagraph) return rich;

  const prefixRuns = sliceRuns(startParagraph.runs, 0, startAddress.offset);
  const suffixRuns = sliceRuns(endParagraph.runs, endAddress.offset, paragraphLength(endParagraph));
  const insertionFormat = formatAtOffset(startParagraph, startAddress.offset);
  const replacementLines = replacement.split('\n');
  const before = rich.paragraphs.slice(0, startAddress.paragraphIndex).map(cloneParagraph);
  const after = rich.paragraphs.slice(endAddress.paragraphIndex + 1).map(cloneParagraph);
  const created: Paragraph[] = [];

  for (let index = 0; index < replacementLines.length; index++) {
    const line = replacementLines[index] ?? '';
    const isFirst = index === 0;
    const isLast = index === replacementLines.length - 1;
    const runs: TextRun[] = [];
    if (isFirst) runs.push(...prefixRuns);
    if (line) runs.push({ text: line, format: insertionFormat });
    if (isLast) runs.push(...suffixRuns);
    created.push({
      ...(isLast && startAddress.paragraphIndex !== endAddress.paragraphIndex
        ? cloneParagraph(endParagraph)
        : cloneParagraph(startParagraph)),
      runs: ensureRuns(mergeAdjacentRuns({ runs }).runs, insertionFormat),
    });
  }

  return { paragraphs: [...before, ...created, ...after] };
}

/** Replace the smallest changed range between the current and next text. */
export function replaceRichTextContent(rich: RichText, nextText: string): RichText {
  const currentText = richTextToPlainText(rich);
  if (currentText === nextText) return rich;

  let prefix = 0;
  while (
    prefix < currentText.length &&
    prefix < nextText.length &&
    currentText.charCodeAt(prefix) === nextText.charCodeAt(prefix)
  ) {
    prefix++;
  }

  let currentEnd = currentText.length;
  let nextEnd = nextText.length;
  while (
    currentEnd > prefix &&
    nextEnd > prefix &&
    currentText.charCodeAt(currentEnd - 1) === nextText.charCodeAt(nextEnd - 1)
  ) {
    currentEnd--;
    nextEnd--;
  }

  const currentRange = normalizeGraphemeRange(
    createUnicodeIndexMap(currentText),
    prefix,
    currentEnd,
  );
  const nextRange = normalizeGraphemeRange(createUnicodeIndexMap(nextText), prefix, nextEnd);
  return replaceRichTextRange(
    rich,
    currentRange.start,
    currentRange.end,
    nextText.slice(nextRange.start, nextRange.end),
  );
}

function rewriteCharacterFormat(
  rich: RichText,
  selection: RichSelection,
  rewrite: (base: CharacterFormat | undefined) => CharacterFormat | undefined,
): RichText {
  const paras = rich.paragraphs.map((p) => ({ ...p, runs: [...p.runs.map((r) => ({ ...r }))] }));
  const { start, end } = normalizeSelection(selection);

  for (let pi = start.paragraphIndex; pi <= end.paragraphIndex; pi++) {
    const para = paras[pi];
    if (!para) continue;
    const paraLen = paragraphLength(para);
    const paragraphMap = createUnicodeIndexMap(para.runs.map((run) => run.text).join(''));
    const selectedRange = normalizeGraphemeRange(
      paragraphMap,
      pi === start.paragraphIndex ? start.offset : 0,
      pi === end.paragraphIndex ? end.offset : paraLen,
    );
    const rangeStart = selectedRange.start;
    const rangeEnd = selectedRange.end;
    if (rangeStart >= rangeEnd) continue;

    const newRuns: TextRun[] = [];
    let cursor = 0;
    for (const run of para.runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;

      if (runEnd <= rangeStart || runStart >= rangeEnd) {
        newRuns.push(run);
        continue;
      }

      const selStart = Math.max(0, rangeStart - runStart);
      const selEnd = Math.max(0, rangeEnd - runStart);

      if (selStart > 0) {
        const [left] = splitRunAt(run, selStart);
        newRuns.push(left);
      }
      newRuns.push({
        text: run.text.slice(selStart, selEnd),
        format: rewrite(run.format),
        characterStyleId: run.characterStyleId,
      });
      if (selEnd < run.text.length) {
        const [, right] = splitRunAt(run, selEnd);
        newRuns.push(right);
      }
    }
    para.runs = newRuns;
  }

  return { paragraphs: paras.map(mergeAdjacentRuns) };
}

function formatAtOffset(para: Paragraph, offset: number): CharacterFormat | undefined {
  let cursor = 0;
  for (const run of para.runs) {
    if (offset <= cursor + run.text.length) return run.format;
    cursor += run.text.length;
  }
  return para.runs[para.runs.length - 1]?.format;
}

function cloneParagraph(para: Paragraph): Paragraph {
  return { ...para, runs: para.runs.map((run) => ({ ...run })) };
}

function ensureRuns(runs: TextRun[], format: CharacterFormat | undefined): TextRun[] {
  return runs.length > 0 ? runs : [{ text: '', format }];
}

function sliceRuns(runs: readonly TextRun[], start: number, end: number): TextRun[] {
  const result: TextRun[] = [];
  let cursor = 0;
  for (const run of runs) {
    const runStart = cursor;
    const runEnd = cursor + run.text.length;
    cursor = runEnd;
    const sliceStart = Math.max(start, runStart);
    const sliceEnd = Math.min(end, runEnd);
    if (sliceStart >= sliceEnd) continue;
    result.push({
      ...run,
      text: run.text.slice(sliceStart - runStart, sliceEnd - runStart),
    });
  }
  return result;
}

function flatOffsetToAddress(
  rich: RichText,
  offset: number,
): { paragraphIndex: number; offset: number } {
  let cursor = 0;
  for (let paragraphIndex = 0; paragraphIndex < rich.paragraphs.length; paragraphIndex++) {
    const paragraph = rich.paragraphs[paragraphIndex]!;
    const length = paragraphLength(paragraph);
    if (offset <= cursor + length) return { paragraphIndex, offset: offset - cursor };
    cursor += length;
    if (paragraphIndex < rich.paragraphs.length - 1) cursor += 1;
  }
  const lastIndex = Math.max(0, rich.paragraphs.length - 1);
  const last = rich.paragraphs[lastIndex];
  return { paragraphIndex: lastIndex, offset: last ? paragraphLength(last) : 0 };
}

function normalizeSelection(sel: RichSelection): RichSelection {
  const startLess =
    sel.start.paragraphIndex < sel.end.paragraphIndex ||
    (sel.start.paragraphIndex === sel.end.paragraphIndex && sel.start.offset <= sel.end.offset);
  return startLess ? sel : { start: sel.end, end: sel.start };
}

function mergeFormat(
  base: CharacterFormat | undefined,
  override: CharacterFormat,
): CharacterFormat {
  return { ...(base ?? {}), ...override };
}

/** Convert a single text node with plain `text` into a RichText node. */
export function promoteToRichText(rich: RichText | undefined, plain: string): RichText {
  if (rich) return rich;
  const lines = plain.split('\n');
  return {
    paragraphs: lines.map((line) => ({ runs: [{ text: line }] })),
  };
}
