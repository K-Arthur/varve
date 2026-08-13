/**
 * Rich text operations — pure functions for splitting, merging, and applying
 * character formatting to rich-text runs. Used by the editor's span editor and
 * any consumer that needs to mutate RichText without UI.
 *
 * Research basis: Figma multi-run text editing, ARIA textbox selection model.
 */

import { createUnicodeIndexMap, normalizeGraphemeRange, snapUtf16Offset } from '@varve/engine';
import type { CharacterFormat, Paragraph, RichText, TextRun } from './typography';

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
        format: mergeFormat(run.format, format),
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
