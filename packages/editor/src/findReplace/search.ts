/**
 * Document-level search. Traverses real page/story ownership (see
 * `targets.ts`), matches with the shared engine (`matching.ts`), and reports
 * original-source UTF-16 ranges.
 *
 * `MatchResult.flatStart/flatEnd` are offsets into the target's authored flat
 * text (`richTextToPlainText`), which is exactly the surface
 * `replaceRichTextRange` edits. They are never comparison-representation
 * offsets.
 */

import type { Document, NodeId } from '@varve/scene';
import { flatToRichSelection } from '@varve/scene';
import type { MatchLimits, MatchOutcome } from './matching';
import { hasCatastrophicBacktracking, matchInText, validatePattern } from './matching';
import { collectTextTargets, protectedReason, targetIsProtected } from './targets';
import type { MatchResult, SearchOptions, SearchScope, SearchSpec, SkippedCounts } from './types';

export interface SearchError {
  code: 'invalid' | 'unsupported' | 'timeout';
  message: string;
}

export interface SearchOutcome {
  results: MatchResult[];
  skipped: SkippedCounts;
  truncated: boolean;
  error: SearchError | null;
  /** True when selection scope was requested with nothing selected. */
  emptySelection: boolean;
}

const SNIPPET_PAD = 24;

function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - SNIPPET_PAD);
  const to = Math.min(text.length, end + SNIPPET_PAD);
  return `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
}

export function searchSpec(
  doc: Document,
  spec: SearchSpec,
  limits: MatchLimits = {},
): SearchOutcome {
  const emptySelection = spec.scope === 'selection' && spec.selection.length === 0;
  const { targets, skipped } = collectTextTargets(doc, spec);

  if (emptySelection) {
    return {
      results: [],
      skipped,
      truncated: false,
      error: null,
      emptySelection: true,
    };
  }

  const results: MatchResult[] = [];
  let truncated = false;

  for (const target of targets) {
    const outcome: MatchOutcome = matchInText(target.plainText, spec.query, spec.options, limits);
    if (outcome.kind === 'error') {
      return { results: [], skipped, truncated: false, error: outcome, emptySelection: false };
    }
    if (outcome.truncated) truncated = true;

    let previousEnd = -1;
    let indexInTarget = 0;
    for (const range of outcome.ranges) {
      // Cluster expansion can widen a match past the next one; keep the first
      // and drop the overlap rather than planning two edits over the same text.
      if (!range.zeroWidth && range.start < previousEnd) continue;
      previousEnd = range.end;

      const isProtected = targetIsProtected(target);
      const match: MatchResult = {
        id: `${target.key}#${range.start}#${indexInTarget++}`,
        targetKey: target.key,
        targetKind: target.kind,
        targetId: target.id,
        frameIds: [...target.frameIds],
        nodeId: target.primaryFrameId,
        nodeName: target.name,
        flatStart: range.start,
        flatEnd: range.end,
        original: target.plainText.slice(range.start, range.end),
        zeroWidth: range.zeroWidth,
        protected: isProtected,
        protectedReason: isProtected ? protectedReason(target) : null,
        shared: target.kind === 'story',
        onPath: target.onPath,
        contextSnippet: snippet(target.plainText, range.start, range.end),
        segments: flatToRichSelection(target.richText, range.start, range.end).paraSegments,
        groups: range.groups,
        namedGroups: range.namedGroups,
      };
      results.push(match);
    }
  }

  return { results, skipped, truncated, error: null, emptySelection: false };
}

/**
 * Positional compatibility wrapper used by the render worker and any caller
 * that has not adopted {@link SearchSpec} yet.
 */
export function searchInDocument(
  doc: Document,
  needle: string,
  options: SearchOptions,
  scope: SearchScope,
  selection: readonly NodeId[],
  excludeInstances: boolean,
  excludeLocked: boolean,
  excludeHidden: boolean,
): {
  results: MatchResult[];
  skippedCount: SkippedCounts;
  truncated: boolean;
  error: SearchError | null;
  emptySelection: boolean;
} {
  const spec: SearchSpec = {
    id: 'compat',
    revision: 0,
    query: needle,
    options,
    scope,
    selection: [...selection],
    excludeInstances,
    excludeLocked,
    excludeHidden,
  };
  const outcome = searchSpec(doc, spec);
  return {
    results: outcome.results,
    skippedCount: outcome.skipped,
    truncated: outcome.truncated,
    error: outcome.error,
    emptySelection: outcome.emptySelection,
  };
}

export type { MatchLimits };
export { hasCatastrophicBacktracking, validatePattern };
