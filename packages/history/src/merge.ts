/**
 * Three-way semantic merge (M11, ADR-0034).
 *
 * Merges `ours` and `theirs` against `base` using the semantic diff (M10).
 * Changes are resolved per conflict key `entityId + propertyPath`:
 *
 * - a change on only one side is adopted
 * - identical changes on both sides are adopted once
 * - concurrent edits to the same property with different values conflict
 * - edit-vs-delete, add-vs-add, rename-vs-rename, and overlapping text
 *   edits conflict
 * - concurrent rewrites of the same id-keyed array (rootChildren, pages,
 *   children, ...) are resolved with a deterministic three-way order merge:
 *   additions from both sides land in their base-relative gaps (ours first
 *   within a gap); moves conflict when both sides moved an item differently
 * - concurrent rewrites of id-less arrays (fills, strokes, effects)
 *   conflict unless both sides produced identical arrays
 *
 * The merged document is always produced. Conflicts leave the `ours` value
 * in place and are reported with base/ours/theirs values so the conflict
 * resolver (M12, follow-up) can re-resolve without recomputing the merge.
 * Application order is deterministic: `theirs` changes are applied to a
 * clone of the `ours` document, shallowest paths first.
 */
import type { Document } from '@varve/scene';
import { canonicalHash, graphemeClusters } from '@varve/scene';
import {
  type DiffEntityKind,
  type DocumentDiff,
  deepEqualStable,
  diffDocuments,
  type SemanticChange,
} from './diff';
import { buildRevision } from './revisions';
import { commitRevision, type HistoryStore } from './store';
import type { RevisionRecord } from './types';

export type MergeStatus = 'clean' | 'conflicted';
export type ConflictKind =
  | 'scalar'
  | 'edit-vs-delete'
  | 'add-vs-add'
  | 'reorder'
  | 'text-overlap'
  | 'rename'
  | 'structure';

export interface MergeConflict {
  conflictId: string;
  conflictKind: ConflictKind;
  entityId: string;
  entityType: DiffEntityKind;
  propertyPath?: string;
  baseValue?: unknown;
  oursValue?: unknown;
  theirsValue?: unknown;
  candidateResolutions: Array<'ours' | 'theirs' | 'base'>;
  summary: string;
}

export interface MergeResult {
  baseHash: string;
  oursHash: string;
  theirsHash: string;
  status: MergeStatus;
  /** Always produced; conflicts keep the `ours` value (documented policy). */
  mergedDocument: Document;
  mergedHash: string;
  automaticChangeCount: number;
  conflicts: MergeConflict[];
  warnings: string[];
  /** True when the merged document fails structural validation. */
  invalid: boolean;
}

interface MergeContext {
  oursDiff: DocumentDiff;
  theirsDiff: DocumentDiff;
  oursTextByPath: Map<string, SemanticChange>;
  conflicts: MergeConflict[];
  warnings: string[];
  automaticChangeCount: number;
}

/** Map-backed entity kinds: entity-level add/remove is applied by inserting
 * or deleting the map key. Everything else is array-backed and fully
 * covered by array rewrites. */
const MAP_BACKED = new Set<DiffEntityKind>([
  'node',
  'style',
  'paint',
  'component',
  'master',
  'asset',
  'iconAsset',
  'stateMachine',
  'variable',
  'variableCollection',
  'variableMode',
]);

export function mergeDocuments(base: Document, ours: Document, theirs: Document): MergeResult {
  const oursDiff = diffDocuments(base, ours);
  const theirsDiff = diffDocuments(base, theirs);
  const ctx: MergeContext = {
    oursDiff,
    theirsDiff,
    oursTextByPath: new Map(),
    conflicts: [],
    warnings: [],
    automaticChangeCount: 0,
  };

  const baseHash = oursDiff.baseHash;
  const oursHash = oursDiff.targetHash;
  const theirsHash = theirsDiff.targetHash;

  // Fast paths: one side unchanged.
  if (!oursDiff.changed) return finishMerge(ctx, baseHash, oursHash, theirsHash, theirs);
  if (!theirsDiff.changed) return finishMerge(ctx, baseHash, oursHash, theirsHash, ours);

  for (const change of oursDiff.changes) {
    if (change.changeType === 'text' && change.propertyPath) {
      ctx.oursTextByPath.set(change.propertyPath, change);
    }
  }

  const oursByKey = indexByKey(oursDiff.changes);
  const theirsByKey = indexByKey(theirsDiff.changes);

  // Removals pre-pass: a removal on one side conflicts with ANY other-side
  // change on the same entity (edit-vs-delete).
  const excludedTheirs = new Set<string>();
  const excludedOurs = new Set<string>();
  for (const [, change] of oursByKey) {
    if (change.changeType !== 'removed') continue;
    for (const [theirKey, theirChange] of theirsByKey) {
      if (theirChange.entityId !== change.entityId) continue;
      if (theirChange.changeType === 'removed') continue;
      excludedTheirs.add(theirKey);
      addConflict(ctx, {
        conflictKind: 'edit-vs-delete',
        entityId: change.entityId,
        entityType: change.entityType,
        propertyPath: theirChange.propertyPath,
        oursValue: change.before,
        theirsValue: theirChange.after,
        candidateResolutions: ['ours', 'theirs'],
        summary: `${entityKindLabel(change.entityType)} ${change.entityId} deleted by us but modified by them`,
      });
    }
  }
  for (const [, change] of theirsByKey) {
    if (change.changeType !== 'removed') continue;
    for (const [ourKey, ourChange] of oursByKey) {
      if (ourChange.entityId !== change.entityId) continue;
      if (ourChange.changeType === 'removed') continue;
      excludedOurs.add(ourKey);
      addConflict(ctx, {
        conflictKind: 'edit-vs-delete',
        entityId: change.entityId,
        entityType: change.entityType,
        propertyPath: ourChange.propertyPath,
        oursValue: ourChange.after,
        theirsValue: change.before,
        candidateResolutions: ['ours', 'theirs'],
        summary: `${entityKindLabel(change.entityType)} ${change.entityId} deleted by them but modified by us`,
      });
    }
  }

  // Per-key decisions.
  const adopt: SemanticChange[] = [];
  for (const key of unionKeys(oursByKey, theirsByKey)) {
    if (excludedOurs.has(key) || excludedTheirs.has(key)) continue;
    const oursChange = oursByKey.get(key);
    const theirsChange = theirsByKey.get(key);
    const decision = resolveKey(ctx, oursChange, theirsChange);
    if (decision === 'adopt-ours') {
      // Ours' changes are already in the ours document; nothing to apply.
      ctx.automaticChangeCount += 1;
    } else if (decision === 'adopt-theirs') {
      adopt.push(theirsChange as SemanticChange);
      ctx.automaticChangeCount += 1;
    } else if (decision === 'adopt-both-text') {
      adopt.push(theirsChange as SemanticChange);
      ctx.automaticChangeCount += 2;
    }
  }

  // Concurrent array rewrites: three-way order merge for id-keyed arrays.
  for (const [oursChange, theirsChange] of collectRewritePairs(
    oursByKey,
    theirsByKey,
    excludedOurs,
    excludedTheirs,
  )) {
    const merged = mergeArrayOrder(ctx, oursChange, theirsChange);
    if (merged) {
      adopt.push({ ...theirsChange, changeType: 'reordered', after: merged });
      ctx.automaticChangeCount += 1;
    }
  }

  // Apply adopted theirs changes to a clone of the ours document.
  const mergedDocument = structuredClone(ours) as Document;
  const applyList = [...adopt].sort(byDepth);
  for (const change of applyList) applyChange(ctx, mergedDocument, change);

  return finishMerge(ctx, baseHash, oursHash, theirsHash, mergedDocument);
}

// ── Decision logic ────────────────────────────────────────────────────────────

type Decision = 'adopt-ours' | 'adopt-theirs' | 'adopt-both-text' | 'conflict' | 'skip';

function resolveKey(
  ctx: MergeContext,
  oursChange: SemanticChange | undefined,
  theirsChange: SemanticChange | undefined,
): Decision {
  if (!oursChange) return 'adopt-theirs';
  if (!theirsChange) return 'adopt-ours';

  const oursType = oursChange.changeType;
  const theirsType = theirsChange.changeType;
  const key = oursChange.entityId;

  // Identical change on both sides → adopt once.
  if (oursType === theirsType && deepEqualStable(oursChange.after, theirsChange.after)) {
    if (oursType === 'removed') return 'skip'; // already removed on both sides
    return 'adopt-ours';
  }

  switch (oursType) {
    case 'removed': {
      addConflict(ctx, {
        conflictKind: 'edit-vs-delete',
        entityId: key,
        entityType: oursChange.entityType,
        propertyPath: theirsChange.propertyPath,
        oursValue: oursChange.before,
        theirsValue: theirsChange.after,
        candidateResolutions: ['ours', 'theirs'],
        summary: `${entityKindLabel(oursChange.entityType)} ${key} deleted on one side, changed on the other`,
      });
      return 'conflict';
    }
    case 'added': {
      addConflict(ctx, {
        conflictKind: 'add-vs-add',
        entityId: key,
        entityType: oursChange.entityType,
        propertyPath: oursChange.propertyPath,
        oursValue: oursChange.after,
        theirsValue: theirsChange.after,
        candidateResolutions: ['ours', 'theirs'],
        summary: `${entityKindLabel(oursChange.entityType)} ${key} added on both sides with different content`,
      });
      return 'conflict';
    }
    case 'renamed': {
      addConflict(ctx, {
        conflictKind: 'rename',
        entityId: key,
        entityType: oursChange.entityType,
        propertyPath: oursChange.propertyPath,
        baseValue: oursChange.before,
        oursValue: oursChange.after,
        theirsValue: theirsChange.after,
        candidateResolutions: ['ours', 'theirs'],
        summary: `${entityKindLabel(oursChange.entityType)} ${key} renamed differently on both sides`,
      });
      return 'conflict';
    }
    case 'text': {
      if (theirsType === 'text' && textRangesDisjoint(oursChange, theirsChange)) {
        return 'adopt-both-text';
      }
      addConflict(ctx, {
        conflictKind: 'text-overlap',
        entityId: key,
        entityType: oursChange.entityType,
        propertyPath: oursChange.propertyPath,
        baseValue: oursChange.before,
        oursValue: oursChange.after,
        theirsValue: theirsChange.after,
        candidateResolutions: ['ours', 'theirs', 'base'],
        summary: `Overlapping text edits in ${entityKindLabel(oursChange.entityType)} ${key}`,
      });
      return 'conflict';
    }
    case 'reordered': {
      // Deferred: both-side rewrites are resolved by the order merge pass;
      // one-sided rewrites fall through to adopt-ours/adopt-theirs above.
      return 'skip';
    }
    default: {
      addConflict(ctx, {
        conflictKind: 'scalar',
        entityId: key,
        entityType: oursChange.entityType,
        propertyPath: oursChange.propertyPath,
        baseValue: oursChange.before,
        oursValue: oursChange.after,
        theirsValue: theirsChange.after,
        candidateResolutions: ['ours', 'theirs', 'base'],
        summary: `${entityKindLabel(oursChange.entityType)} ${key}: ${pathTailOf(oursChange.propertyPath)} changed differently on both sides`,
      });
      return 'conflict';
    }
  }
}

function collectRewritePairs(
  oursByKey: Map<string, SemanticChange>,
  theirsByKey: Map<string, SemanticChange>,
  excludedOurs: Set<string>,
  excludedTheirs: Set<string>,
): Array<[SemanticChange, SemanticChange]> {
  const pairs: Array<[SemanticChange, SemanticChange]> = [];
  for (const [key, oursChange] of oursByKey) {
    if (oursChange.changeType !== 'reordered') continue;
    if (excludedOurs.has(key)) continue;
    const theirsChange = theirsByKey.get(key);
    if (theirsChange?.changeType !== 'reordered') continue;
    if (excludedTheirs.has(key)) continue;
    if (deepEqualStable(oursChange.after, theirsChange.after)) continue; // identical → adopted in the key pass
    pairs.push([oursChange, theirsChange]);
  }
  return pairs;
}

/**
 * Three-way order merge for arrays rewritten on both sides. Id-keyed
 * arrays (rootChildren, pages, children, guides, ...) are merged
 * deterministically; id-less arrays conflict.
 *
 * Returns the merged array (ids for bare id arrays, full objects for
 * wrapped arrays), or null when a conflict was recorded.
 */
function mergeArrayOrder(
  ctx: MergeContext,
  oursChange: SemanticChange,
  theirsChange: SemanticChange,
): unknown[] | null {
  const oursArr = Array.isArray(oursChange.after) ? oursChange.after : null;
  const theirsArr = Array.isArray(theirsChange.after) ? theirsChange.after : null;
  const baseArr = Array.isArray(oursChange.before) ? oursChange.before : null;
  if (!oursArr || !theirsArr || !baseArr) return null;

  // Id extraction: bare ids, or object ids, or null when id-less.
  const idOf = (item: unknown): string | null => {
    if (typeof item === 'string') return item;
    if (typeof item === 'object' && item !== null) {
      const id = (item as Record<string, unknown>).id;
      if (typeof id === 'string') return id;
    }
    return null;
  };
  const baseIds = baseArr.map(idOf);
  const oursIds = oursArr.map(idOf);
  const theirsIds = theirsArr.map(idOf);
  if (
    baseIds.some((id) => id === null) ||
    oursIds.some((id) => id === null) ||
    theirsIds.some((id) => id === null)
  ) {
    // Id-less array (fills, strokes, effects) — concurrent rewrite conflict.
    addConflict(ctx, {
      conflictKind: 'reorder',
      entityId: oursChange.entityId,
      entityType: oursChange.entityType,
      propertyPath: oursChange.propertyPath,
      baseValue: oursChange.before,
      oursValue: oursChange.after,
      theirsValue: theirsChange.after,
      candidateResolutions: ['ours', 'theirs'],
      summary: `Concurrent changes to ${oursChange.propertyPath ?? 'array'} in ${entityKindLabel(oursChange.entityType)} ${oursChange.entityId}`,
    });
    return null;
  }

  const mergedIds = orderMergeIds(
    baseIds as string[],
    oursIds as string[],
    theirsIds as string[],
    ctx,
    oursChange,
  );
  if (!mergedIds) return null;

  // Reconstruct: bare id arrays stay id arrays; wrapped arrays get the
  // ours-side object (falling back to theirs/base).
  if (oursArr.every((item) => typeof item === 'string')) return mergedIds;
  const byId = new Map<string, unknown>();
  for (const item of [...theirsArr, ...baseArr]) {
    const id = idOf(item);
    if (id !== null && !byId.has(id)) byId.set(id, item);
  }
  for (const item of oursArr) {
    const id = idOf(item);
    if (id !== null) byId.set(id, item); // ours wins
  }
  const merged = mergedIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
  return merged as unknown[];
}

/** Pure order merge over id arrays; null when a move conflict is recorded. */
function orderMergeIds(
  base: string[],
  ours: string[],
  theirs: string[],
  ctx: MergeContext,
  change: SemanticChange,
): string[] | null {
  const baseSet = new Set(base);
  const oursSet = new Set(ours);
  const theirsSet = new Set(theirs);

  // Items removed on either side are dropped.
  const removed = new Set<string>();
  for (const id of base) {
    if (!oursSet.has(id) || !theirsSet.has(id)) removed.add(id);
  }

  // Moves: base-relative order changes of surviving items.
  const oursRelative = relativeOrder(ours.filter((id) => baseSet.has(id) && !removed.has(id)));
  const theirsRelative = relativeOrder(theirs.filter((id) => baseSet.has(id) && !removed.has(id)));
  const movedIds = new Set<string>();
  for (const id of base) {
    if (removed.has(id)) continue;
    const oPos = oursRelative.get(id);
    const tPos = theirsRelative.get(id);
    if (oPos !== undefined && tPos !== undefined && oPos !== tPos) movedIds.add(id);
  }
  if (movedIds.size > 0) {
    addConflict(ctx, {
      conflictKind: 'reorder',
      entityId: change.entityId,
      entityType: change.entityType,
      propertyPath: change.propertyPath,
      baseValue: change.before,
      oursValue: change.after,
      theirsValue: change.after,
      candidateResolutions: ['ours', 'theirs'],
      summary: `Items moved differently on both sides (${[...movedIds].join(', ')})`,
    });
    return null;
  }

  // Walk base items; before each surviving base item, append additions
  // both sides inserted into the same gap (ours first, deduped). Gap i is
  // the insertion point after the i-th base item (0 = before the first,
  // base.length = after the last).
  const oursGaps = gapInsertions(base, ours, removed);
  const theirsGaps = gapInsertions(base, theirs, removed);
  const result: string[] = [];
  for (let i = 0; i <= base.length; i++) {
    for (const id of mergeGaps(oursGaps.get(i) ?? [], theirsGaps.get(i) ?? [])) {
      if (!removed.has(id) && !result.includes(id)) result.push(id);
    }
    const item = base[i];
    if (item !== undefined && !removed.has(item)) result.push(item);
  }
  return result;
}

/** Map of id → position within a base-relative sequence. */
function relativeOrder(ids: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const [index, id] of ids.entries()) map.set(id, index);
  return map;
}

/**
 * For each insertion gap i (0..base.length — the number of base items the
 * inserted ids come after), the ids this side inserted there, in insertion
 * order.
 */
function gapInsertions(
  base: string[],
  side: string[],
  removed: Set<string>,
): Map<number, string[]> {
  const baseIndex = new Map<string, number>();
  for (const [index, id] of base.entries()) baseIndex.set(id, index);
  const gaps = new Map<number, string[]>();
  let current = -1;
  for (const id of side) {
    const pos = baseIndex.get(id);
    if (pos !== undefined) {
      current = pos;
      continue;
    }
    if (removed.has(id)) continue;
    const list = gaps.get(current + 1) ?? [];
    list.push(id);
    gaps.set(current + 1, list);
  }
  return gaps;
}

function mergeGaps(ours: string[], theirs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...ours, ...theirs]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function textRangesDisjoint(ours: SemanticChange, theirs: SemanticChange): boolean {
  const a = ours.textRanges;
  const b = theirs.textRanges;
  if (!a || !b) return false;
  // Strict inequality: two edits meeting at the same point (e.g. two
  // insertions at the same position) are treated as overlapping.
  return a.baseEnd < b.baseStart || b.baseEnd < a.baseStart;
}

// ── Application ───────────────────────────────────────────────────────────────

function applyChange(ctx: MergeContext, doc: Document, change: SemanticChange): void {
  try {
    switch (change.changeType) {
      case 'added': {
        if (!MAP_BACKED.has(change.entityType)) return; // array rewrites carry placement
        const containerPath = change.propertyPath;
        if (!containerPath) return;
        const container = resolveObject(doc, containerPath);
        if (container === undefined) {
          ctx.warnings.push(
            `merge: container ${containerPath} not found; skipping add of ${change.entityId}`,
          );
          return;
        }
        container[change.entityId] = structuredClone(change.after);
        return;
      }
      case 'removed': {
        if (!MAP_BACKED.has(change.entityType)) return;
        const containerPath = change.propertyPath;
        if (!containerPath) return;
        const container = resolveObject(doc, containerPath);
        if (container === undefined) {
          ctx.warnings.push(
            `merge: container ${containerPath} not found; skipping removal of ${change.entityId}`,
          );
          return;
        }
        delete container[change.entityId];
        return;
      }
      case 'reordered': {
        setAtPath(doc, change.propertyPath ?? '', structuredClone(change.after));
        return;
      }
      case 'renamed':
      case 'modified': {
        setAtPath(doc, change.propertyPath ?? '', structuredClone(change.after));
        return;
      }
      case 'text': {
        applyTextChange(ctx, doc, change);
        return;
      }
    }
  } catch (err) {
    ctx.warnings.push(
      `merge: failed to apply ${change.changeId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function resolveObject(doc: Document, path: string): Record<string, unknown> | undefined {
  const segments = path.split('.');
  let current: unknown = doc;
  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;
    if (Array.isArray(current)) {
      const found = (current as Array<Record<string, unknown>>).find(
        (item) => item?.id === segment,
      );
      if (!found) return undefined;
      current = found;
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return typeof current === 'object' && current !== null && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : undefined;
}

function setAtPath(doc: Document, path: string, value: unknown): void {
  const segments = path.split('.');
  if (segments.length === 0) return;
  let current: unknown = doc;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    if (Array.isArray(current)) {
      const found = (current as Array<Record<string, unknown>>).find(
        (item) => item?.id === segment,
      );
      if (!found) throw new Error(`array element ${segment} not found at ${path}`);
      current = found;
    } else {
      current = (current as Record<string, unknown>)[segment];
    }
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = (current as Array<Record<string, unknown>>).findIndex(
      (item) => item?.id === last,
    );
    if (index < 0) throw new Error(`array element ${last} not found at ${path}`);
    (current as unknown[])[index] = value;
  } else {
    (current as Record<string, unknown>)[last as string] = value;
  }
}

/**
 * Apply a text change with coordinate adjustment: the change's cluster
 * ranges are in base-document coordinates; when both sides edited disjoint
 * ranges, the ours-side edit already changed the string length, so the
 * theirs-side range is shifted accordingly.
 */
function applyTextChange(ctx: MergeContext, doc: Document, change: SemanticChange): void {
  const path = change.propertyPath;
  if (!path || !change.textRanges) return;
  const containerPath = path.slice(0, path.lastIndexOf('.'));
  const node = resolveObject(doc, containerPath);
  if (!node) {
    ctx.warnings.push(`merge: text node not found at ${path}`);
    return;
  }
  const currentText = node.text as string | undefined;
  if (typeof currentText !== 'string') return;
  const { baseStart, baseEnd, targetStart, targetEnd } = change.textRanges;
  const replacement = (typeof change.after === 'string' ? change.after : '').slice(
    targetStart,
    targetEnd,
  );

  let shift = 0;
  const oursText = ctx.oursTextByPath.get(path);
  if (oursText?.textRanges) {
    const o = oursText.textRanges;
    shift = o.targetEnd - o.targetStart - (o.baseEnd - o.baseStart);
  }
  // Only the portion of theirs' range after the ours edit shifts.
  const start = baseStart >= (oursText?.textRanges?.baseEnd ?? 0) ? baseStart + shift : baseStart;
  const end = baseEnd >= (oursText?.textRanges?.baseEnd ?? 0) ? baseEnd + shift : baseEnd;
  node.text = spliceClusterRange(currentText, start, end, replacement);
}

/** Splice a grapheme-cluster range [start, end) with a replacement string. */
export function spliceClusterRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  const clusters = graphemeClusters(text);
  if (start < 0) start = 0;
  if (end > clusters.length) end = clusters.length;
  if (start > end) start = end;
  return clusters.slice(0, start).join('') + replacement + clusters.slice(end).join('');
}

// ── Merge graph commit ────────────────────────────────────────────────────────

export interface MergeCommitOptions {
  documentId: string;
  branchId: string;
  baseRevisionId: string;
  oursRevisionId: string;
  theirsRevisionId: string;
  mergedDocument: Document;
  /** Number of unresolved conflicts (0 for a clean merge). */
  conflictCount: number;
  author: {
    actorId: string;
    kind: 'local-user' | 'remote-user' | 'system' | 'migration' | 'import';
  };
  /** Optional note recorded in the semantic summary detail. */
  note?: string;
}

/** Create a two-parent merge revision and move the branch head (ADR-0022). */
export async function commitMergeRevision(
  store: HistoryStore,
  opts: MergeCommitOptions,
): Promise<RevisionRecord> {
  const revision = buildRevision({
    documentId: opts.documentId,
    parentRevisionIds: [opts.oursRevisionId, opts.theirsRevisionId],
    document: opts.mergedDocument,
    author: opts.author,
    origin: 'merge',
    semanticSummary: {
      label: opts.conflictCount > 0 ? `Merge with ${opts.conflictCount} conflict(s)` : 'Merge',
      affectedEntityIds: [],
      kind: 'merge',
      detail: opts.note,
    },
  });
  await commitRevision(store, {
    revision,
    moveBranchHead: { branchId: opts.branchId, headRevisionId: revision.revisionId },
  });
  return revision;
}

// ── Finish / validation ───────────────────────────────────────────────────────

function finishMerge(
  ctx: MergeContext,
  baseHash: string,
  oursHash: string,
  theirsHash: string,
  mergedDocument: Document,
): MergeResult {
  let mergedHash = '';
  let invalid = false;
  try {
    mergedHash = canonicalHash(mergedDocument);
    const issues = validateMergedDocument(mergedDocument);
    if (issues.length > 0) {
      invalid = true;
      ctx.warnings.push(...issues.map((issue) => `merge: ${issue}`));
    }
  } catch (err) {
    invalid = true;
    ctx.warnings.push(
      `merge: merged document failed canonicalization: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return {
    baseHash,
    oursHash,
    theirsHash,
    status: ctx.conflicts.length > 0 ? 'conflicted' : 'clean',
    mergedDocument,
    mergedHash,
    automaticChangeCount: ctx.automaticChangeCount,
    conflicts: ctx.conflicts,
    warnings: ctx.warnings,
    invalid,
  };
}

/** Structural validation: all referenced node ids (roots, pages, nested
 * children arrays, page backgrounds/contentRoots) must exist. */
function validateMergedDocument(doc: Document): string[] {
  const issues: string[] = [];
  const nodeIds = new Set(Object.keys(doc.nodes ?? {}));
  const check = (list: unknown, where: string): void => {
    if (!Array.isArray(list)) return;
    for (const id of list) {
      if (typeof id === 'string' && !nodeIds.has(id)) {
        issues.push(`dangling id ${id} in ${where}`);
      }
    }
  };
  check(doc.rootChildren, 'rootChildren');
  check(doc.globalChildren, 'globalChildren');
  for (const node of Object.values(doc.nodes ?? {})) {
    const children = (node as { children?: unknown })?.children;
    if (children !== undefined) {
      check(children, `nodes.${(node as { id?: string })?.id}.children`);
    }
  }
  const pages = doc.pages ?? [];
  for (const page of pages) {
    check(page?.backgrounds, `pages.${page?.id}.backgrounds`);
    if (page?.contentRoot && !nodeIds.has(page.contentRoot)) {
      issues.push(`dangling contentRoot ${page.contentRoot} in page ${page.id}`);
    }
  }
  return issues;
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function indexByKey(changes: SemanticChange[]): Map<string, SemanticChange> {
  const map = new Map<string, SemanticChange>();
  for (const change of changes) {
    const key = changeKey(change);
    if (!map.has(key)) map.set(key, change);
  }
  return map;
}

/** Conflict key: entityId + full property path. */
export function changeKey(change: SemanticChange): string {
  return `${change.entityId}\u0001${change.propertyPath ?? '~'}`;
}

function unionKeys<T>(a: Map<string, T>, b: Map<string, T>): string[] {
  return [...new Set([...a.keys(), ...b.keys()])];
}

function addConflict(ctx: MergeContext, conflict: Omit<MergeConflict, 'conflictId'>): void {
  ctx.conflicts.push({
    ...conflict,
    // Deterministic id: re-running the same three-way merge must produce
    // the same conflict set (ADR-0034/0035 — resolution choices survive
    // across a recomputed merge). The key is unique per change pair.
    conflictId: conflictIdOf(conflict),
  });
}

/** Deterministic conflict id: kind + entity + property path. */
function conflictIdOf(conflict: Omit<MergeConflict, 'conflictId'>): string {
  const key = [
    conflict.conflictKind,
    conflict.entityId,
    conflict.entityType,
    conflict.propertyPath ?? '',
  ]
    .map((part) => part.replace(/[^A-Za-z0-9_-]/g, '_'))
    .join('|');
  return `cf-${key}`;
}

function byDepth(a: SemanticChange, b: SemanticChange): number {
  const aDepth = a.propertyPath ? a.propertyPath.split('.').length : 0;
  const bDepth = b.propertyPath ? b.propertyPath.split('.').length : 0;
  return aDepth - bDepth;
}

function pathTailOf(path: string | undefined): string {
  if (!path) return 'value';
  return path.split('.').pop() ?? path;
}

function entityKindLabel(entityType: DiffEntityKind): string {
  switch (entityType) {
    case 'node':
      return 'Node';
    case 'page':
      return 'Page';
    case 'master':
      return 'Master';
    case 'component':
      return 'Component';
    case 'style':
      return 'Style';
    case 'paint':
      return 'Paint';
    case 'variable':
      return 'Variable';
    case 'variableCollection':
      return 'Variable collection';
    case 'variableMode':
      return 'Variable mode';
    case 'asset':
      return 'Asset';
    case 'iconAsset':
      return 'Icon asset';
    case 'stateMachine':
      return 'State machine';
    case 'library':
      return 'Library';
    case 'guide':
      return 'Guide';
    case 'swatch':
      return 'Swatch';
    case 'spotColor':
      return 'Spot color';
    case 'spotLibrary':
      return 'Spot library';
    case 'font':
      return 'Font';
    case 'document':
      return 'Document';
  }
}
