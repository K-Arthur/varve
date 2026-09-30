/**
 * Replacement planning and commit.
 *
 * One planner drives Replace, Replace and Find Next, Replace Checked, and
 * Replace All, so preview and commit cannot disagree.
 *
 * Guarantees
 * - Edits are planned against a frozen {@link SearchSpec} and exact original
 *   ranges, then revalidated against the live document before commit. A stale
 *   revision, a changed range, or a deleted target is skipped rather than
 *   applied at the wrong offset.
 * - Within one target, edits are applied in descending offset order, so a
 *   length-changing replacement cannot invalidate pending offsets.
 * - Range edits go through `replaceRichTextRange`, the canonical rich-text
 *   range operation: unaffected runs keep their formats, paragraph separators
 *   create/join real paragraphs, and offsets snap to grapheme boundaries.
 * - Locked and hidden targets are never edited. They stay findable.
 * - Story targets edit authoritative `TextStory.content` once, no matter how
 *   many frames render them.
 */

import type { Document, NodeId, RichText } from '@varve/scene';
import {
  invalidateGlyphAdjustmentsOnTextChange,
  plainTextToRichText,
  replaceRichTextRange,
  richTextToPlainText,
} from '@varve/scene';
import { searchSpec } from './search';
import { collectTextTargets } from './targets';
import type { MatchResult, SearchOptions, SearchScope, SearchSpec } from './types';

export interface ReplacementContext {
  useRegex: boolean;
  original: string;
  groups?: readonly (string | undefined)[];
  namedGroups?: Readonly<Record<string, string | undefined>>;
  prefix: string;
  suffix: string;
}

/**
 * ECMAScript `GetSubstitution` semantics for a regex replacement template.
 * Literal mode never calls this: `$1` is ordinary text there.
 *
 * Supported: `$$` ($), `$&` (whole match), `` $` `` (prefix), `$'` (suffix),
 * `$1`…`$99`, `$<name>`. An unmatched group expands to empty. A group index
 * beyond the match, or `$<name>` for a missing name, stays literal.
 */
export function expandReplacement(template: string, context: ReplacementContext): string {
  if (!context.useRegex) return template;
  const groupCount = context.groups ? context.groups.length - 1 : 0;
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch !== '$') {
      out += ch;
      continue;
    }
    const next = template[i + 1];
    if (next === undefined) {
      out += '$';
      continue;
    }
    if (next === '$') {
      out += '$';
      i++;
      continue;
    }
    if (next === '&') {
      out += context.original;
      i++;
      continue;
    }
    if (next === '`') {
      out += context.prefix;
      i++;
      continue;
    }
    if (next === "'") {
      out += context.suffix;
      i++;
      continue;
    }
    if (next === '<') {
      const close = template.indexOf('>', i + 2);
      if (close >= 0) {
        const name = template.slice(i + 2, close);
        if (context.namedGroups && Object.hasOwn(context.namedGroups, name)) {
          out += context.namedGroups[name] ?? '';
          i = close;
          continue;
        }
      }
      out += '$';
      continue;
    }
    if (next >= '0' && next <= '9') {
      const third = template[i + 2];
      let consumed = 1;
      let index = Number(next);
      if (third !== undefined && third >= '0' && third <= '9') {
        const two = Number(`${next}${third}`);
        if (two <= groupCount) {
          index = two;
          consumed = 2;
        }
      }
      if (index >= 1 && index <= groupCount) {
        out += context.groups?.[index] ?? '';
        i += consumed;
        continue;
      }
      out += '$';
      continue;
    }
    out += '$';
  }
  return out;
}

export interface PlannedEdit {
  matchId: string;
  targetKey: string;
  targetKind: 'node' | 'story';
  targetId: NodeId;
  flatStart: number;
  flatEnd: number;
  /** Original matched text; revalidated before the edit is applied. */
  original: string;
  /** Expanded replacement text. */
  replacement: string;
  zeroWidth: boolean;
}

export interface ReplacementPlan {
  specId: string;
  revision: number;
  edits: PlannedEdit[];
  /** Matches skipped because their target is locked or hidden (find-only). */
  skippedProtected: number;
  /** Total matches considered. */
  considered: number;
}

export interface ApplyResult {
  doc: Document;
  applied: number;
  /** Edits skipped because the document changed after planning. */
  skippedStale: number;
  /** Edits whose replacement text was identical — no history, no dirty state. */
  unchanged: number;
  /** True when the whole plan was rejected as stale. */
  stale: boolean;
}

export interface PlanOptions {
  /** Restrict the plan to these match ids (Replace Checked). */
  onlyMatchIds?: ReadonlySet<string>;
}

/** Plan a replacement from a frozen spec and the current document. */
export function planReplacements(
  doc: Document,
  spec: SearchSpec,
  template: string,
  options: PlanOptions = {},
): ReplacementPlan {
  const outcome = searchSpec(doc, spec);
  const targets = new Map<string, string>();
  for (const target of collectTextTargets(doc, spec).targets) {
    targets.set(target.key, target.plainText);
  }

  const edits: PlannedEdit[] = [];
  let skippedProtected = 0;

  for (const match of outcome.results) {
    if (options.onlyMatchIds && !options.onlyMatchIds.has(match.id)) continue;
    if (match.protected) {
      skippedProtected++;
      continue;
    }
    const text = targets.get(match.targetKey) ?? '';
    const replacement =
      spec.options.useRegex && template.includes('$')
        ? expandReplacement(template, {
            useRegex: true,
            original: match.original,
            groups: match.groups,
            namedGroups: match.namedGroups,
            prefix: text.slice(0, match.flatStart),
            suffix: text.slice(match.flatEnd),
          })
        : template;

    edits.push({
      matchId: match.id,
      targetKey: match.targetKey,
      targetKind: match.targetKind,
      targetId: match.targetId,
      flatStart: match.flatStart,
      flatEnd: match.flatEnd,
      original: match.original,
      replacement,
      zeroWidth: match.zeroWidth,
    });
  }

  return {
    specId: spec.id,
    revision: spec.revision,
    edits,
    skippedProtected,
    considered: outcome.results.length,
  };
}

/**
 * Reuse the target list from search so `$`` and `$'` context is available.
 * Not exported: the search outcome already carries everything else.
 */
/** Resolve a target's current rich text, or null when it no longer exists. */
function currentTargetRichText(
  doc: Document,
  targetKind: 'node' | 'story',
  targetId: NodeId,
): RichText | null {
  if (targetKind === 'story') {
    const story = doc.stories?.[targetId];
    return story ? story.content : null;
  }
  const node = doc.nodes[targetId];
  if (node?.kind !== 'text') return null;
  return node.richText ?? plainTextToRichText(node.text);
}

function writeTargetRichText(
  doc: Document,
  targetKind: 'node' | 'story',
  targetId: NodeId,
  rich: RichText,
): Document {
  if (targetKind === 'story') {
    const story = doc.stories?.[targetId];
    if (!story) return doc;
    return {
      ...doc,
      stories: { ...doc.stories, [targetId]: { ...story, content: rich } },
    };
  }

  const node = doc.nodes[targetId];
  if (node?.kind !== 'text') return doc;
  const plain = richTextToPlainText(rich);
  const nodeWasPlain = node.richText === undefined;
  const richIsPlain = rich.paragraphs.every((paragraph) =>
    paragraph.runs.every((run) => !run.format && !run.characterStyleId),
  );
  const nextNode =
    nodeWasPlain && richIsPlain
      ? ({ ...node, text: plain } as typeof node)
      : ({ ...node, text: plain, richText: rich } as typeof node);
  return {
    ...doc,
    nodes: { ...doc.nodes, [targetId]: invalidateGlyphAdjustmentsOnTextChange(node, nextNode) },
  };
}

/**
 * Commit a plan. `currentRevision` revalidates the whole plan against the live
 * document; edits whose original range no longer matches are skipped
 * individually. Nothing is applied when the revision moved.
 */
export function applyReplacementPlan(
  doc: Document,
  plan: ReplacementPlan,
  currentRevision: number,
): ApplyResult {
  if (plan.edits.length === 0) {
    return { doc, applied: 0, skippedStale: 0, unchanged: 0, stale: false };
  }
  if (plan.revision !== currentRevision) {
    return {
      doc,
      applied: 0,
      skippedStale: plan.edits.length,
      unchanged: 0,
      stale: true,
    };
  }

  const grouped = new Map<string, PlannedEdit[]>();
  for (const edit of plan.edits) {
    const list = grouped.get(edit.targetKey);
    if (list) list.push(edit);
    else grouped.set(edit.targetKey, [edit]);
  }

  let next = doc;
  let applied = 0;
  let skippedStale = 0;
  let unchanged = 0;

  for (const edits of grouped.values()) {
    const first = edits[0];
    if (!first) continue;
    // Descending original offsets: a length change cannot invalidate a pending
    // lower offset in the same target.
    const ordered = [...edits].sort((a, b) => b.flatStart - a.flatStart);

    for (const edit of ordered) {
      const rich = currentTargetRichText(next, edit.targetKind, edit.targetId);
      if (!rich) {
        skippedStale++;
        continue;
      }
      const plain = richTextToPlainText(rich);
      if (plain.slice(edit.flatStart, edit.flatEnd) !== edit.original) {
        skippedStale++;
        continue;
      }
      const updated = replaceRichTextRange(rich, edit.flatStart, edit.flatEnd, edit.replacement);
      // An identical replacement (or an empty deletion of nothing) must not
      // create a history entry or mark the document dirty.
      if (updated === rich || richTextToPlainText(updated) === plain) {
        unchanged++;
        continue;
      }
      next = writeTargetRichText(next, edit.targetKind, edit.targetId, updated);
      applied++;
    }
  }

  return { doc: next, applied, skippedStale, unchanged, stale: false };
}

/**
 * Replace one match in place. Regex capture templates expand from the match
 * record captured at search time, exactly as in Replace All.
 */
export function replaceSingle(doc: Document, match: MatchResult, template: string): Document {
  if (match.protected) return doc;
  const rich = currentTargetRichText(doc, match.targetKind, match.targetId);
  if (!rich) return doc;
  const plain = richTextToPlainText(rich);
  if (plain.slice(match.flatStart, match.flatEnd) !== match.original) return doc;

  const replacement =
    match.groups !== undefined
      ? expandReplacement(template, {
          useRegex: true,
          original: match.original,
          groups: match.groups,
          namedGroups: match.namedGroups,
          prefix: plain.slice(0, match.flatStart),
          suffix: plain.slice(match.flatEnd),
        })
      : template;

  const updated = replaceRichTextRange(rich, match.flatStart, match.flatEnd, replacement);
  if (updated === rich || richTextToPlainText(updated) === plain) return doc;
  return writeTargetRichText(doc, match.targetKind, match.targetId, updated);
}

/**
 * Positional compatibility wrapper: plan a fresh replacement and commit it
 * without a revision guard. Prefer {@link planReplacements} +
 * {@link applyReplacementPlan} for anything user-facing.
 */
export function replaceAll(
  doc: Document,
  needle: string,
  replacement: string,
  options: SearchOptions,
  scope: SearchScope,
  selection: readonly NodeId[],
  excludeInstances: boolean,
  excludeLocked: boolean,
  excludeHidden: boolean,
): { doc: Document; count: number; skippedProtected: number } {
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
  const plan = planReplacements(doc, spec, replacement);
  const result = applyReplacementPlan(doc, plan, plan.revision);
  return { doc: result.doc, count: result.applied, skippedProtected: plan.skippedProtected };
}
