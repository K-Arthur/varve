/**
 * Semantic document diff (M10, ADR-0028).
 *
 * Compares two documents at the entity/property level, keyed by persistent
 * ids, producing a deterministic change list that is safe to feed into
 * three-way merge (`merge.ts`) and the review bundle generator (M14).
 *
 * Path conventions (important for merge application):
 * - `propertyPath` is ALWAYS the full document-relative dot path, so merge
 *   application is a pure deep-set with no index bookkeeping.
 * - Ordered collections of id-carrying entities use the entity id as the
 *   path segment (`pages.p1.children`), which stays stable across reorders.
 * - Map collections use the collection path (`nodes`, `pages`,
 *   `variableStore.collections.<id>.variables`).
 * - Id-less arrays (fills, strokes, effects) emit a single "rewrite"
 *   change with the full before/after arrays — element-level changes inside
 *   them are not diffed (no stable identity to key them on).
 *
 * Policies:
 * - Numeric comparison uses property-specific epsilon policies (exact by
 *   default; geometry/transform/typography fields use per-family
 *   tolerances). NaN/Infinity are rejected by canonical serialization.
 * - Text changes are diffed at grapheme-cluster granularity and carry
 *   cluster ranges for merge-time overlap detection (ADR-0034).
 * - Volatile/payload state is excluded: asset `dataUrl` bytes and the
 *   `nextId` counter are not semantic content.
 */
import type { Document } from '@varve/scene';
import { canonicalHistoryHash, graphemeClusters } from '@varve/scene';

export type DiffEntityKind =
  | 'document'
  | 'node'
  | 'style'
  | 'paint'
  | 'component'
  | 'page'
  | 'master'
  | 'variable'
  | 'variableCollection'
  | 'variableMode'
  | 'asset'
  | 'stateMachine'
  | 'library'
  | 'guide'
  | 'swatch'
  | 'iconAsset'
  | 'font'
  | 'spotColor'
  | 'spotLibrary';

export type SemanticChangeType =
  | 'added'
  | 'removed'
  | 'modified'
  | 'renamed'
  | 'reordered'
  | 'text';

export interface TextChangeRanges {
  /** Grapheme-cluster range in the base document text. */
  baseStart: number;
  baseEnd: number;
  /** Grapheme-cluster range in the target document text. */
  targetStart: number;
  targetEnd: number;
}

export interface SemanticChange {
  /** Deterministic id for cross-referencing (e.g. from merge conflicts). */
  changeId: string;
  changeType: SemanticChangeType;
  entityId: string;
  entityType: DiffEntityKind;
  /** Full document-relative dot path (absent for entity-level changes). */
  propertyPath?: string;
  before?: unknown;
  after?: unknown;
  /** Present for text changes. */
  textRanges?: TextChangeRanges;
  /** Present for added/removed items inside ordered sequences. */
  orderIndex?: number;
  summary: string;
  machineApplicable: boolean;
}

export interface DiffSummary {
  total: number;
  added: number;
  removed: number;
  modified: number;
  renamed: number;
  reordered: number;
  text: number;
  /** Per entity kind counts. */
  byEntity: Partial<Record<DiffEntityKind, number>>;
}

export interface DocumentDiff {
  baseHash: string;
  targetHash: string;
  changed: boolean;
  changes: SemanticChange[];
  summary: DiffSummary;
}

export interface DiffOptions {
  /** 'default' applies the property-specific epsilon table; 'exact' disables it. */
  epsilonPolicy?: 'default' | 'exact';
}

// ── Collection registry ───────────────────────────────────────────────────────
// Top-level and nested maps/arrays whose entries are entities with their own
// identity. `ordered: true` marks arrays whose element order is semantic
// (paint order, page order). `bareIds: true` marks arrays of plain ids whose
// entities live in a map (rootChildren/globalChildren) — membership changes
// are covered by the map diff.

interface CollectionSpec {
  entityType: DiffEntityKind;
  ordered?: boolean;
  bareIds?: boolean;
}

const TOP_LEVEL_COLLECTIONS: Record<string, CollectionSpec> = {
  nodes: { entityType: 'node' },
  components: { entityType: 'component' },
  paints: { entityType: 'paint' },
  styles: { entityType: 'style' },
  masters: { entityType: 'master' },
  iconAssets: { entityType: 'iconAsset' },
  assets: { entityType: 'asset' },
  stateMachines: { entityType: 'stateMachine' },
  pages: { entityType: 'page', ordered: true },
  guides: { entityType: 'guide', ordered: true },
  swatches: { entityType: 'swatch', ordered: true },
  spotColors: { entityType: 'spotColor', ordered: true },
  spotLibraries: { entityType: 'spotLibrary', ordered: true },
  installedLibraries: { entityType: 'library', ordered: true },
  rootChildren: { entityType: 'node', ordered: true, bareIds: true },
  globalChildren: { entityType: 'node', ordered: true, bareIds: true },
};

/** Nested collection specs keyed by parent path template. */
const NESTED_COLLECTIONS: Record<string, Record<string, CollectionSpec>> = {
  variableStore: {
    collections: { entityType: 'variableCollection' },
  },
  'variableStore.collections.*': {
    variables: { entityType: 'variable' },
    modes: { entityType: 'variableMode' },
  },
};

// ── Property-specific numeric tolerance table ─────────────────────────────────
const EPSILON_BY_SEGMENT: Record<string, number> = {
  x: 1e-6,
  y: 1e-6,
  w: 1e-6,
  h: 1e-6,
  width: 1e-6,
  height: 1e-6,
  rotation: 1e-6,
  opacity: 1e-6,
  fontSize: 1e-6,
  letterSpacing: 1e-6,
  lineHeight: 1e-6,
  tracking: 1e-6,
  paragraphSpacing: 1e-6,
  cornerRadius: 1e-6,
  cornerSmoothing: 1e-6,
};

const TRANSFORM_ELEMENT_RE = /^transform\.\d+$/;
const CAPTURE_PATH_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const FORBIDDEN_CAPTURE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// ── Implementation ────────────────────────────────────────────────────────────

interface DiffContext {
  changes: SemanticChange[];
  options: Required<DiffOptions>;
}

export function diffDocuments(
  base: Document,
  target: Document,
  options: DiffOptions = {},
): DocumentDiff {
  const ctx: DiffContext = {
    changes: [],
    options: { epsilonPolicy: options.epsilonPolicy ?? 'default' },
  };
  const baseHash = canonicalHistoryHash(base);
  const targetHash = canonicalHistoryHash(target);
  if (baseHash === targetHash) {
    return { baseHash, targetHash, changed: false, changes: [], summary: emptySummary() };
  }

  compareDocument(ctx, base, target);
  return {
    baseHash,
    targetHash,
    // Review diffs may intentionally suppress sub-epsilon numeric changes.
    // Exact replay capture may not: a canonical hash difference is itself
    // authoritative evidence that a history step is required (notably for
    // binary-backed collections such as raster tile Maps).
    changed:
      ctx.changes.length > 0 || (ctx.options.epsilonPolicy === 'exact' && baseHash !== targetHash),
    changes: ctx.changes,
    summary: summarize(ctx.changes),
  };
}

function compareDocument(ctx: DiffContext, base: Document, target: Document): void {
  for (const [key, spec] of Object.entries(TOP_LEVEL_COLLECTIONS)) {
    const baseVal = base[key as keyof Document];
    const targetVal = target[key as keyof Document];
    if (spec.ordered) {
      compareOrdered(ctx, key, spec, baseVal, targetVal);
    } else {
      compareMap(ctx, key, spec, baseVal, targetVal);
    }
  }
  // Everything else falls into generic recursion, with nested registry
  // lookups consulted at each object level.
  for (const key of unionKeys(base, target)) {
    if (TOP_LEVEL_COLLECTIONS[key]) continue;
    if (key === 'id' || key === 'nextId') continue;
    compareValue(
      ctx,
      'document',
      'document',
      key,
      base[key as keyof Document],
      target[key as keyof Document],
    );
  }
}

function compareMap(
  ctx: DiffContext,
  containerPath: string,
  spec: CollectionSpec,
  baseVal: unknown,
  targetVal: unknown,
): void {
  if (baseVal === undefined && targetVal === undefined) return;
  // Immutable documents share unchanged structure: an identical reference
  // cannot contain a difference, so skip it instead of walking it.
  if (baseVal === targetVal) return;
  const baseMap = (baseVal ?? {}) as Record<string, unknown>;
  const targetMap = (targetVal ?? {}) as Record<string, unknown>;
  for (const id of unionKeys(baseMap, targetMap)) {
    const baseEntry = baseMap[id];
    const targetEntry = targetMap[id];
    if (baseEntry === targetEntry) continue;
    if (baseEntry === undefined) {
      emit(ctx, {
        changeType: 'added',
        entityId: id,
        entityType: spec.entityType,
        propertyPath: containerPath,
        after: targetEntry,
        summary: entitySummary(spec.entityType, 'added', id, targetEntry),
      });
      continue;
    }
    if (targetEntry === undefined) {
      emit(ctx, {
        changeType: 'removed',
        entityId: id,
        entityType: spec.entityType,
        propertyPath: containerPath,
        before: baseEntry,
        summary: entitySummary(spec.entityType, 'removed', id, baseEntry),
      });
      continue;
    }
    compareEntityAt(ctx, spec.entityType, id, `${containerPath}.${id}`, baseEntry, targetEntry);
  }
}

function compareOrdered(
  ctx: DiffContext,
  containerPath: string,
  spec: CollectionSpec,
  baseVal: unknown,
  targetVal: unknown,
): void {
  if (baseVal === undefined && targetVal === undefined) return;
  if (baseVal === targetVal) return;
  const baseArr = (baseVal ?? []) as unknown[];
  const targetArr = (targetVal ?? []) as unknown[];
  if (baseArr.length === 0 && targetArr.length === 0) return;

  const baseIds = baseArr.map((item) => elementId(item));
  const targetIds = targetArr.map((item) => elementId(item));
  const lcs = lcsIndices(baseIds, targetIds);
  const baseMatched = new Set(lcs.map((pair) => pair[0]));
  const targetMatched = new Set(lcs.map((pair) => pair[1]));

  // Per-item membership changes. Bare-id arrays (rootChildren etc.) are
  // covered by their map diff, so only wrapped entities emit item changes.
  // These changes are informational for merge (the array rewrite carries
  // placement); application uses the rewrite only.
  if (!spec.bareIds) {
    for (let i = 0; i < baseArr.length; i++) {
      if (baseMatched.has(i)) continue;
      const baseId = baseIds[i]!;
      const baseItem = baseArr[i]!;
      emit(ctx, {
        changeType: 'removed',
        entityId: baseId,
        entityType: spec.entityType,
        propertyPath: containerPath,
        before: baseItem,
        orderIndex: i,
        summary: entitySummary(spec.entityType, 'removed', baseId, baseItem),
      });
    }
    for (let j = 0; j < targetArr.length; j++) {
      if (targetMatched.has(j)) continue;
      const targetId = targetIds[j]!;
      const targetItem = targetArr[j]!;
      emit(ctx, {
        changeType: 'added',
        entityId: targetId,
        entityType: spec.entityType,
        propertyPath: containerPath,
        after: targetItem,
        orderIndex: j,
        summary: entitySummary(spec.entityType, 'added', targetId, targetItem),
      });
    }
  }

  // Array rewrite when membership or order changed.
  if (!sameArray(baseIds, targetIds)) {
    emit(ctx, {
      changeType: 'reordered',
      entityId: 'document',
      entityType: 'document',
      propertyPath: containerPath,
      before: baseArr,
      after: targetArr,
      summary: `Document: ${containerPath} array changed (${baseArr.length} → ${targetArr.length} entries)`,
    });
  }

  // Recurse into matched pairs (paths are id-stable, immune to reorder).
  // Each LCS pair already names its base index; looking it up again per
  // pair was a linear scan, O(n^2) across a large root order.
  for (const [bi, tj] of lcs) {
    const baseItem = baseArr[bi]!;
    const targetItem = targetArr[tj]!;
    if (baseItem === targetItem) continue;
    const id = targetIds[tj]!;
    compareEntityAt(ctx, spec.entityType, id, `${containerPath}.${id}`, baseItem, targetItem);
  }
}

function compareEntityAt(
  ctx: DiffContext,
  entityType: DiffEntityKind,
  entityId: string,
  rootPath: string,
  baseEntry: unknown,
  targetEntry: unknown,
): void {
  if (!isRecord(baseEntry) || !isRecord(targetEntry)) {
    compareValue(ctx, entityType, entityId, rootPath, baseEntry, targetEntry);
    return;
  }

  // Rename detection for named entities.
  if (entityType === 'node' || entityType === 'page' || entityType === 'master') {
    const baseName = baseEntry.name;
    const targetName = targetEntry.name;
    if (typeof baseName === 'string' && typeof targetName === 'string' && baseName !== targetName) {
      emit(ctx, {
        changeType: 'renamed',
        entityId,
        entityType,
        propertyPath: `${rootPath}.name`,
        before: baseName,
        after: targetName,
        summary: `${entityLabel(entityType)} "${baseName}" renamed to "${targetName}"`,
      });
    }
  }

  // Node kind replacement.
  if (entityType === 'node' && baseEntry.kind !== targetEntry.kind) {
    emit(ctx, {
      changeType: 'modified',
      entityId,
      entityType,
      propertyPath: `${rootPath}.kind`,
      before: baseEntry.kind,
      after: targetEntry.kind,
      summary: `${entityLabel(entityType)} "${String(baseEntry.name ?? entityId)}" kind changed from ${String(baseEntry.kind)} to ${String(targetEntry.kind)}`,
    });
    return; // fields differ structurally beyond this point
  }

  for (const key of unionKeys(baseEntry, targetEntry)) {
    if (key === 'id') continue;
    if (key === 'nextId') continue;
    const baseChild = baseEntry[key];
    const targetChild = targetEntry[key];
    if (baseChild === undefined) {
      compareValue(ctx, entityType, entityId, `${rootPath}.${key}`, undefined, targetChild);
      continue;
    }
    if (targetChild === undefined) {
      compareValue(ctx, entityType, entityId, `${rootPath}.${key}`, baseChild, undefined);
      continue;
    }
    compareValue(ctx, entityType, entityId, `${rootPath}.${key}`, baseChild, targetChild);
  }
}

function compareValue(
  ctx: DiffContext,
  entityType: DiffEntityKind,
  entityId: string,
  path: string,
  baseVal: unknown,
  targetVal: unknown,
): void {
  // Text changes (grapheme granularity).
  if (
    path.endsWith('.text') &&
    entityType === 'node' &&
    typeof baseVal === 'string' &&
    typeof targetVal === 'string'
  ) {
    compareText(ctx, entityId, path, baseVal, targetVal);
    return;
  }

  // A missing object cannot be replayed safely as a set of leaf changes: the
  // persisted base may be an older document that does not contain the parent
  // path at all (for example, the first variable added to a legacy document).
  // Record the boundary replacement so capture replay can create or remove
  // the optional object atomically.
  if (baseVal === undefined || targetVal === undefined) {
    if (baseVal === targetVal) return;
    emit(ctx, {
      changeType: 'modified',
      entityId,
      entityType,
      propertyPath: path,
      before: baseVal,
      after: targetVal,
      summary: `${entityLabel(entityType)} ${entityNameOf(entityId)}: ${pathTail(path)} changed`,
    });
    return;
  }

  if (isRecord(baseVal) || isRecord(targetVal)) {
    const baseRec = (baseVal ?? {}) as Record<string, unknown>;
    const targetRec = (targetVal ?? {}) as Record<string, unknown>;
    const keys = unionKeys(baseRec, targetRec);
    if (keys.some((key) => !isCapturePathSegment(key))) {
      // Capture paths are deliberately restricted to safe dotted segments.
      // An arbitrary JSON key (for example `color.brand` in group metadata
      // or `org.varve.id` in an extension) cannot be addressed as a child
      // path without changing its meaning. Replace the containing JSON value
      // atomically instead; the parent path remains validated by captureOps.
      if (stableStringify(baseVal) === stableStringify(targetVal)) return;
      emit(ctx, {
        changeType: 'modified',
        entityId,
        entityType,
        propertyPath: path,
        before: baseVal,
        after: targetVal,
        summary: `${entityLabel(entityType)} ${entityNameOf(entityId)}: ${pathTail(path)} changed`,
      });
      return;
    }

    // Nested collection registry lookup (e.g. variableStore.collections).
    const specs = nestedSpecsFor(path);
    if (specs) {
      for (const [key, spec] of Object.entries(specs)) {
        const baseChild = isRecord(baseVal) ? (baseVal as Record<string, unknown>)[key] : undefined;
        const targetChild = isRecord(targetVal)
          ? (targetVal as Record<string, unknown>)[key]
          : undefined;
        const childPath = `${path}.${key}`;
        if (spec.ordered) {
          compareOrdered(ctx, childPath, spec, baseChild, targetChild);
        } else {
          compareMap(ctx, childPath, spec, baseChild, targetChild);
        }
      }
      const consumed = new Set(Object.keys(specs));
      for (const key of unionKeys(baseRec, targetRec)) {
        if (consumed.has(key)) continue;
        compareValue(
          ctx,
          entityType,
          entityId,
          `${path}.${key}`,
          recordAt(baseRec, key),
          recordAt(targetRec, key),
        );
      }
      return;
    }

    for (const key of unionKeys(baseRec, targetRec)) {
      compareValue(ctx, entityType, entityId, `${path}.${key}`, baseRec[key], targetRec[key]);
    }
    return;
  }

  if (Array.isArray(baseVal) || Array.isArray(targetVal)) {
    // One side may be undefined when a collection was added/removed;
    // normalize to empty arrays so the comparison is total (never throws).
    compareArray(
      ctx,
      entityType,
      entityId,
      path,
      (baseVal ?? []) as unknown[],
      (targetVal ?? []) as unknown[],
    );
    return;
  }

  const equal = scalarEqual(baseVal, targetVal, ctx, path);
  if (equal) return;
  emit(ctx, {
    changeType: 'modified',
    entityId,
    entityType,
    propertyPath: path,
    before: baseVal,
    after: targetVal,
    summary: `${entityLabel(entityType)} ${entityNameOf(entityId)}: ${pathTail(path)} changed from ${shortValue(baseVal)} to ${shortValue(targetVal)}`,
  });
}

/**
 * Nested arrays are compared by a single rewrite change carrying the full
 * before/after arrays. Id-less arrays (fills, strokes, effects, points,
 * runs) have no stable per-element identity, so element-level changes are
 * not emitted; merge treats concurrent rewrites of the same array as a
 * conflict unless the resulting arrays are identical.
 */
function compareArray(
  ctx: DiffContext,
  entityType: DiffEntityKind,
  entityId: string,
  path: string,
  baseArr: unknown[],
  targetArr: unknown[],
): void {
  if (baseArr.length === 0 && targetArr.length === 0) return;
  const baseIds = baseArr.map((item) => (typeof item === 'string' ? item : stableStringify(item)));
  const targetIds = targetArr.map((item) =>
    typeof item === 'string' ? item : stableStringify(item),
  );
  if (sameArray(baseIds, targetIds)) return;
  emit(ctx, {
    changeType: 'reordered',
    entityId,
    entityType,
    propertyPath: path,
    before: baseArr,
    after: targetArr,
    summary: `${entityLabel(entityType)} ${entityNameOf(entityId)}: ${pathTail(path)} array changed (${baseArr.length} → ${targetArr.length} entries)`,
  });
}

function compareText(
  ctx: DiffContext,
  entityId: string,
  path: string,
  baseText: string,
  targetText: string,
): void {
  if (baseText === targetText) return;
  const baseClusters = graphemeClusters(baseText);
  const targetClusters = graphemeClusters(targetText);
  const pairs = lcsIndices(baseClusters, targetClusters);
  const baseMatched = new Set(pairs.map((pair) => pair[0]));
  const targetMatched = new Set(pairs.map((pair) => pair[1]));
  let baseStart = baseClusters.length;
  let baseEnd = -1;
  let targetStart = targetClusters.length;
  let targetEnd = -1;
  for (let i = 0; i < baseClusters.length; i++) {
    if (baseMatched.has(i)) continue;
    baseStart = Math.min(baseStart, i);
    baseEnd = Math.max(baseEnd, i);
  }
  for (let j = 0; j < targetClusters.length; j++) {
    if (targetMatched.has(j)) continue;
    targetStart = Math.min(targetStart, j);
    targetEnd = Math.max(targetEnd, j);
  }
  // Ranges are [start, end) — exclusive end, matching splice semantics.
  if (baseEnd !== -1) baseEnd += 1;
  if (targetEnd !== -1) targetEnd += 1;
  // Pure insertion (no unmatched base clusters): the insertion point is
  // right after the base cluster matched to the target cluster before the
  // inserted run. Pure deletion is symmetric.
  if (baseEnd === -1 && targetEnd !== -1) {
    let insertionPoint = 0;
    for (const [bi, tj] of pairs) {
      if (tj < targetStart) insertionPoint = bi + 1;
    }
    baseStart = insertionPoint;
    baseEnd = insertionPoint;
  } else if (targetEnd === -1 && baseEnd !== -1) {
    let deletionPoint = 0;
    for (const [bi, tj] of pairs) {
      if (bi < baseStart) deletionPoint = tj + 1;
    }
    targetStart = deletionPoint;
    targetEnd = deletionPoint;
  }
  emit(ctx, {
    changeType: 'text',
    entityId,
    entityType: 'node',
    propertyPath: path,
    before: baseText,
    after: targetText,
    textRanges: { baseStart, baseEnd, targetStart, targetEnd },
    summary: `Text changed (${baseEnd - baseStart + (targetEnd - targetStart)} clusters affected)`,
  });
}

// ── Emission / summary helpers ────────────────────────────────────────────────

function emit(
  ctx: DiffContext,
  change: Omit<SemanticChange, 'changeId' | 'machineApplicable'>,
): void {
  ctx.changes.push({
    ...change,
    changeId: `${change.entityType}:${change.entityId}:${change.propertyPath ?? '~'}:${change.changeType}`,
    machineApplicable: true,
  });
}

function summarize(changes: SemanticChange[]): DiffSummary {
  const summary: DiffSummary = emptySummary();
  for (const change of changes) {
    summary.total += 1;
    summary[change.changeType] += 1;
    summary.byEntity[change.entityType] = (summary.byEntity[change.entityType] ?? 0) + 1;
  }
  return summary;
}

function emptySummary(): DiffSummary {
  return {
    total: 0,
    added: 0,
    removed: 0,
    modified: 0,
    renamed: 0,
    reordered: 0,
    text: 0,
    byEntity: {},
  };
}

function entityLabel(entityType: DiffEntityKind): string {
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

function entityNameOf(entityId: string): string {
  return `"${entityId}"`;
}

function entitySummary(
  entityType: DiffEntityKind,
  changeType: 'added' | 'removed',
  id: string,
  payload: unknown,
): string {
  const name = isRecord(payload) && typeof payload.name === 'string' ? payload.name : id;
  return `${entityLabel(entityType)} "${name}" ${changeType === 'added' ? 'added' : 'removed'}`;
}

function pathTail(path: string): string {
  return path.split('.').pop() ?? path;
}

function shortValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') return String(Math.round(value * 1e6) / 1e6);
  if (typeof value === 'string') {
    return value.length > 40 ? `"${value.slice(0, 37)}…"` : `"${value}"`;
  }
  const text = stableStringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

// ── Equality / LCS helpers ────────────────────────────────────────────────────

function scalarEqual(
  baseVal: unknown,
  targetVal: unknown,
  ctx: DiffContext,
  path: string,
): boolean {
  if (baseVal === targetVal) return true;
  if (ctx.options.epsilonPolicy === 'exact') return false;
  if (typeof baseVal === 'number' && typeof targetVal === 'number') {
    const epsilon = epsilonForPath(path);
    if (epsilon !== undefined) return Math.abs(baseVal - targetVal) <= epsilon;
    return baseVal === targetVal;
  }
  return false;
}

function epsilonForPath(path: string): number | undefined {
  const last = path.split('.').pop() ?? '';
  if (TRANSFORM_ELEMENT_RE.test(last)) return 1e-9;
  return EPSILON_BY_SEGMENT[last];
}

/**
 * Longest common subsequence over an array of comparable strings.
 * Returns matched index pairs `[baseIndex, targetIndex]` in order.
 */
/**
 * Largest DP table (cells) the exact quadratic LCS may allocate: 64 MiB of
 * Uint32. A 10k-entry root order would otherwise allocate ~400 MiB per history
 * capture, and ~50k entries exceed typed-array limits and throw.
 */
const MAX_LCS_TABLE_CELLS = 16 * 1024 * 1024;

export function lcsIndices(
  base: readonly string[],
  target: readonly string[],
): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  if (n === 0 || m === 0) return [];
  // The backtrack below matches equal leading elements greedily, so a common
  // prefix is always paired index-for-index; trimming it yields the same pairs
  // while shrinking the table to the region that actually changed.
  let prefix = 0;
  while (prefix < n && prefix < m && base[prefix] === target[prefix]) prefix++;
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);
  if (prefix === n || prefix === m) return pairs;
  const restBase = base.slice(prefix);
  const restTarget = target.slice(prefix);
  const rest =
    (restBase.length + 1) * (restTarget.length + 1) <= MAX_LCS_TABLE_CELLS
      ? lcsQuadratic(restBase, restTarget)
      : lcsBounded(restBase, restTarget);
  for (const [i, j] of rest) pairs.push([i + prefix, j + prefix]);
  return pairs;
}

function lcsQuadratic(base: readonly string[], target: readonly string[]): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  const dp: Uint32Array = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    const row = i * (m + 1);
    const nextRow = (i + 1) * (m + 1);
    for (let j = m - 1; j >= 0; j--) {
      const baseItem = base[i]!;
      const targetItem = target[j]!;
      dp[row + j] =
        baseItem === targetItem
          ? (dp[nextRow + j + 1] as number) + 1
          : Math.max(dp[row + j + 1] as number, dp[nextRow + j] as number);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const baseItem = base[i];
    const targetItem = target[j];
    if (baseItem !== undefined && baseItem === targetItem) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if ((dp[(i + 1) * (m + 1) + j] as number) >= (dp[i * (m + 1) + j + 1] as number)) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * LCS for inputs whose quadratic table exceeds the memory cap. Collection ids
 * are unique in a valid document, and the LCS of two duplicate-free sequences
 * is the longest increasing run of target positions in base order, found in
 * O(n log n). Duplicated ids (a malformed document) keep only the first
 * occurrence as a match candidate, which still yields a valid common
 * subsequence; the caller's array rewrite carries the exact final order.
 */
function lcsBounded(base: readonly string[], target: readonly string[]): Array<[number, number]> {
  const targetIndex = new Map<string, number>();
  for (let j = 0; j < target.length; j++) {
    if (!targetIndex.has(target[j]!)) targetIndex.set(target[j]!, j);
  }
  const seenBase = new Set<string>();
  const candidates: Array<[number, number]> = [];
  for (let i = 0; i < base.length; i++) {
    const id = base[i]!;
    if (seenBase.has(id)) continue;
    seenBase.add(id);
    const j = targetIndex.get(id);
    if (j !== undefined) candidates.push([i, j]);
  }
  // Patience sorting over target indices; `tails[k]` is the candidate index
  // ending the best increasing run of length k + 1.
  const tails: number[] = [];
  const previous = new Int32Array(candidates.length).fill(-1);
  for (let c = 0; c < candidates.length; c++) {
    const j = candidates[c]![1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (candidates[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[c] = tails[lo - 1]!;
    tails[lo] = c;
  }
  const pairs: Array<[number, number]> = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1]! : -1;
  while (cursor >= 0) {
    pairs.push(candidates[cursor]!);
    cursor = previous[cursor]!;
  }
  return pairs.reverse();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

export function deepEqualStable(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function elementId(item: unknown): string {
  if (typeof item === 'string') return item;
  if (isRecord(item)) {
    const id = item.id;
    if (typeof id === 'string') return id;
    return stableStringify(item);
  }
  return stableStringify(item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unionKeys(a: object, b: object): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])];
}

/** Mirrors the replay operation's safe property-path grammar. */
function isCapturePathSegment(key: string): boolean {
  return CAPTURE_PATH_SEGMENT_RE.test(key) && !FORBIDDEN_CAPTURE_PATH_SEGMENTS.has(key);
}

function recordAt(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function nestedSpecsFor(path: string): Record<string, CollectionSpec> | null {
  const exact = NESTED_COLLECTIONS[path];
  if (exact) return exact;
  const segments = path.split('.');
  if (segments.length === 3 && segments[0] === 'variableStore' && segments[1] === 'collections') {
    const spec = NESTED_COLLECTIONS['variableStore.collections.*'];
    if (spec) return spec;
  }
  return null;
}
