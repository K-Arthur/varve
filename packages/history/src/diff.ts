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
import { canonicalHash, graphemeClusters } from '@varve/scene';

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
  const baseHash = canonicalHash(base);
  const targetHash = canonicalHash(target);
  if (baseHash === targetHash) {
    return { baseHash, targetHash, changed: false, changes: [], summary: emptySummary() };
  }

  compareDocument(ctx, base, target);
  return {
    baseHash,
    targetHash,
    changed: ctx.changes.length > 0,
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
  const baseMap = (baseVal ?? {}) as Record<string, unknown>;
  const targetMap = (targetVal ?? {}) as Record<string, unknown>;
  for (const id of unionKeys(baseMap, targetMap)) {
    const baseEntry = baseMap[id];
    const targetEntry = targetMap[id];
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
  for (const [, tj] of lcs) {
    const id = targetIds[tj]!;
    compareEntityAt(
      ctx,
      spec.entityType,
      id,
      `${containerPath}.${id}`,
      baseArr[baseIndexFor(lcs, tj)]!,
      targetArr[tj]!,
    );
  }
}

function baseIndexFor(lcs: Array<[number, number]>, targetIndex: number): number {
  for (const [bi, tj] of lcs) if (tj === targetIndex) return bi;
  return targetIndex;
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

  if (isRecord(baseVal) || isRecord(targetVal)) {
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
      const baseRec = (baseVal ?? {}) as Record<string, unknown>;
      const targetRec = (targetVal ?? {}) as Record<string, unknown>;
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

    const baseRec = (baseVal ?? {}) as Record<string, unknown>;
    const targetRec = (targetVal ?? {}) as Record<string, unknown>;
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
export function lcsIndices(
  base: readonly string[],
  target: readonly string[],
): Array<[number, number]> {
  const n = base.length;
  const m = target.length;
  if (n === 0 || m === 0) return [];
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
