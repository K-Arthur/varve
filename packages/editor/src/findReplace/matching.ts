/**
 * Match engine for find/replace.
 *
 * One implementation drives every entry point (Find Next, Replace, Replace and
 * Find Next, Replace Checked, Replace All), so preview and commit always agree.
 *
 * Semantics
 * - Literal mode: the query is ordinary text. `.`, `*`, `$1`, brackets, and
 *   backslashes are literal. Replacement is literal too.
 * - Regex mode: ECMAScript RegExp with flags `gu` (`i` added when the query is
 *   case-insensitive). `u` is always on so `\p{...}` property escapes work and
 *   patterns are validated with exactly the flags used for execution.
 * - Case and diacritic sensitivity are independent. Literal mode folds per
 *   grapheme cluster (see `projection.ts`); regex mode implements
 *   case-insensitivity through the `i` flag and declares diacritic-insensitive
 *   regex matching unsupported rather than silently rewriting the pattern.
 * - Whole word uses `[\p{L}\p{N}\p{M}\p{Pc}]` (letters, numbers, marks, and
 *   connector punctuation such as underscore) on both sides, so `cat` does not
 *   match `cat1`, `cat_cat`, or `concatenate`. Boundaries are *checked*, never
 *   consumed, so consecutive matches such as `cat cat` are all found.
 * - Zero-width matches are reported once per position and advance by one code
 *   point, never looping on the same boundary.
 */

import { escapeRegex } from '@varve/shared';
import {
  advanceScalar,
  buildComparisonProjection,
  comparisonRangeToOriginal,
  foldQuery,
  scalarAt,
  scalarBefore,
} from './projection';
import type { SearchOptions } from './types';

/** Letters, numbers, combining marks, and connector punctuation (UAX #31-ish). */
const WORD_CHAR = /[\p{L}\p{N}\p{M}\p{Pc}]/u;

export interface MatchTextRange {
  /** Original flat UTF-16 offsets. */
  start: number;
  end: number;
  /** Comparison-coordinate offsets the match was found at. */
  comparisonStart: number;
  comparisonEnd: number;
  /** Capture groups (index 0 is the whole match). Regex mode only. */
  groups?: readonly (string | undefined)[];
  namedGroups?: Readonly<Record<string, string | undefined>>;
  zeroWidth: boolean;
}

export interface MatchLimits {
  /** Hard cap on matches returned. */
  maxMatches?: number;
  /** Hard cap on zero-width matches returned. */
  maxZeroWidth?: number;
  /** Wall-clock budget; best-effort between regex steps. */
  deadlineMs?: number;
  /** Hard cap on pattern length. */
  maxPatternLength?: number;
}

export type MatchOutcome =
  | { kind: 'ok'; ranges: MatchTextRange[]; truncated: boolean }
  | { kind: 'error'; code: 'invalid' | 'unsupported' | 'timeout'; message: string };

const DEFAULT_LIMITS: Required<MatchLimits> = {
  maxMatches: 20_000,
  maxZeroWidth: 1_000,
  deadlineMs: 1_500,
  maxPatternLength: 1_000,
};

export function isWordChar(value: string): boolean {
  return value.length > 0 && WORD_CHAR.test(value);
}

/**
 * Cheap advisory screen for nested quantifiers. This is defence in depth, not
 * certification: it is deliberately conservative, and the real bound is the
 * match budget plus the wall-clock deadline. A genuinely interruptible
 * off-thread engine is tracked as follow-up work.
 */
export function hasCatastrophicBacktracking(pattern: string): boolean {
  const dangerousPatterns = [
    /\(\S*\+\)\s*\+/,
    /\(\S*\*\)\s*[+*]/,
    /\([^)]*\*\)\s*[+*]/,
    /\(\S*\?\)\s*[+*]/,
    /\(\S*\+\)\s*\*/,
    /(\+|\*)\s*\{/,
    /\+\s*\+\s*/,
    /\*\s*\+\s*/,
    /\*\s*\*\s*/,
    /\+\s*\*\s*/,
    /\{\d+,\}\s*\+/,
    /\[\s*\]\s*\+/,
  ];
  return dangerousPatterns.some((p) => p.test(pattern));
}

export function regexFlags(options: SearchOptions): string {
  return options.caseSensitive ? 'gu' : 'giu';
}

/**
 * Validate a regex with exactly the flags used for execution.
 * Returns a human-readable error, or null when the pattern is usable.
 */
export function validatePattern(pattern: string, options: SearchOptions): string | null {
  if (!pattern) return 'Pattern is empty';
  if (pattern.length > DEFAULT_LIMITS.maxPatternLength) {
    return `Pattern is too long (limit ${DEFAULT_LIMITS.maxPatternLength} characters)`;
  }
  try {
    new RegExp(pattern, regexFlags(options));
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid regular expression';
  }
  if (hasCatastrophicBacktracking(pattern)) {
    return 'Pattern contains nested quantifiers and may be very slow; simplify it before replacing';
  }
  return null;
}

function foldForLiteral(query: string, options: SearchOptions): string {
  return foldQuery(query, options);
}

function wholeWordOk(text: string, start: number, end: number): boolean {
  return !isWordChar(scalarBefore(text, start)) && !isWordChar(scalarAt(text, end));
}

export function matchInText(
  text: string,
  query: string,
  options: SearchOptions,
  limits: MatchLimits = {},
): MatchOutcome {
  const bounds = { ...DEFAULT_LIMITS, ...limits };
  const startedAt = Date.now();
  const isOverBudget = () => Date.now() - startedAt > bounds.deadlineMs;

  if (!query) {
    // An empty query matches nothing — it is not permission to edit every
    // boundary, and it is not permission to insert at every offset.
    return { kind: 'ok', ranges: [], truncated: false };
  }

  if (options.useRegex) {
    const error = validatePattern(query, options);
    if (error) {
      const code = /nested quantifiers|too long/.test(error) ? 'unsupported' : 'invalid';
      return { kind: 'error', code, message: error };
    }
  }

  const projection = buildComparisonProjection(text, options);
  const comparison = projection.comparison;

  if (!options.useRegex) {
    return matchLiteral(projection, comparison, query, options, bounds, isOverBudget);
  }
  return matchRegex(projection, comparison, query, options, bounds, isOverBudget);
}

function matchLiteral(
  projection: ReturnType<typeof buildComparisonProjection>,
  comparison: string,
  query: string,
  options: SearchOptions,
  bounds: Required<MatchLimits>,
  isOverBudget: () => boolean,
): MatchOutcome {
  const needle = foldForLiteral(query, options);
  if (!needle) return { kind: 'ok', ranges: [], truncated: false };

  const ranges: MatchTextRange[] = [];
  let truncated = false;
  let pos = 0;
  let steps = 0;

  while (pos <= comparison.length - needle.length) {
    if ((steps++ & 0xff) === 0 && isOverBudget()) {
      return { kind: 'error', code: 'timeout', message: 'Search exceeded its time budget' };
    }
    const found = comparison.indexOf(needle, pos);
    if (found < 0) break;

    if (!options.wholeWord || wholeWordOk(comparison, found, found + needle.length)) {
      const original = comparisonRangeToOriginal(projection, found, found + needle.length);
      ranges.push({
        start: original.start,
        end: original.end,
        comparisonStart: found,
        comparisonEnd: found + needle.length,
        zeroWidth: original.start === original.end,
      });
      if (ranges.length >= bounds.maxMatches) {
        truncated = true;
        break;
      }
      pos = found + needle.length;
    } else {
      pos = found + 1;
    }
  }

  return { kind: 'ok', ranges, truncated };
}

function matchRegex(
  projection: ReturnType<typeof buildComparisonProjection>,
  comparison: string,
  query: string,
  options: SearchOptions,
  bounds: Required<MatchLimits>,
  isOverBudget: () => boolean,
): MatchOutcome {
  let regex: RegExp;
  try {
    regex = new RegExp(query, regexFlags(options));
  } catch (err) {
    return {
      kind: 'error',
      code: 'invalid',
      message: err instanceof Error ? err.message : 'Invalid regular expression',
    };
  }

  const ranges: MatchTextRange[] = [];
  let truncated = false;
  let zeroWidthCount = 0;
  let steps = 0;

  let match = regex.exec(comparison);
  while (match !== null) {
    if ((steps++ & 0xff) === 0 && isOverBudget()) {
      return { kind: 'error', code: 'timeout', message: 'Search exceeded its time budget' };
    }

    const comparisonStart = match.index;
    const comparisonEnd = comparisonStart + match[0].length;
    const zeroWidth = match[0].length === 0;

    if (!options.wholeWord || wholeWordOk(comparison, comparisonStart, comparisonEnd)) {
      const original = comparisonRangeToOriginal(projection, comparisonStart, comparisonEnd);
      if (zeroWidth) zeroWidthCount++;
      ranges.push({
        start: original.start,
        end: original.end,
        comparisonStart,
        comparisonEnd,
        groups: match.slice(0),
        namedGroups: match.groups ? { ...match.groups } : undefined,
        zeroWidth,
      });

      if (ranges.length >= bounds.maxMatches || zeroWidthCount >= bounds.maxZeroWidth) {
        truncated = true;
        break;
      }
    }

    if (zeroWidth) {
      regex.lastIndex = advanceScalar(comparison, regex.lastIndex);
    } else if (regex.lastIndex === comparisonStart) {
      // Non-advancing non-zero-width match (possible with lookarounds).
      regex.lastIndex = advanceScalar(comparison, comparisonStart);
    }
    match = regex.exec(comparison);
  }

  return { kind: 'ok', ranges, truncated };
}

export { escapeRegex };
