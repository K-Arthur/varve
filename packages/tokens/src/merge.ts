/**
 * Three-way semantic merge (ADR-0108 / spec §21).
 *
 * base / local / remote per semantic field:
 * - local === base and remote changed → accept remote
 * - remote === base and local changed → accept local
 * - local and remote made the same change → merge cleanly
 * - both changed differently → conflict (explicit, never auto-resolved)
 * - rename on one side + value edit on the other → combined when identity
 *   is certain
 * - delete vs edit → delete-versus-edit conflict
 * - merged reference graph containing a cycle → plan invalid
 *
 * Composites merge per component; metadata merges per field. Produces a
 * validated TokenMergePlan before any mutation.
 */

import { validateTokenValue } from './codecs';
import { deepEqual, isPureReference, type TokenSnapshot, type TokenSnapshotMap } from './diff';
import { pathKey } from './parse';
import { isStableTokenType } from './spec';
import type { TokenDiagnostic } from './types';

export type MergeDecision =
  | 'accept-local'
  | 'accept-remote'
  | 'same-change'
  | 'combined-rename-value'
  | 'delete-vs-edit'
  | 'conflict';

export interface FieldConflict {
  field: string;
  base: unknown;
  local: unknown;
  remote: unknown;
}

export interface TokenMerge {
  id?: string;
  /** Result path (pathKey). */
  path: string;
  oldPath?: string;
  decision: MergeDecision;
  conflicts: FieldConflict[];
  base?: TokenSnapshot;
  local: TokenSnapshot;
  remote: TokenSnapshot;
  /** Merged snapshot when the decision resolves without conflicts. */
  result?: TokenSnapshot;
  diagnostics: TokenDiagnostic[];
}

export interface TokenMergePlan {
  merges: TokenMerge[];
  diagnostics: TokenDiagnostic[];
  /** False when any merge is unresolved or the merged graph is invalid. */
  valid: boolean;
  /** Number of tokens that would change. */
  affectedCount: number;
}

export interface ThreeWayInput {
  base: TokenSnapshotMap;
  local: TokenSnapshotMap;
  remote: TokenSnapshotMap;
}

export function threeWayMerge(input: ThreeWayInput): TokenMergePlan {
  const merges: TokenMerge[] = [];
  const diagnostics: TokenDiagnostic[] = [];

  const localById = indexById(input.local);
  const remoteById = indexById(input.remote);

  // Match tokens across the three snapshots by identity, then path.
  const matchedKeys = new Set<string>();

  // Pass 1: identity-matched tokens (stable ids) — may be renamed.
  for (const [baseKey, baseToken] of input.base) {
    if (!baseToken.id) continue;
    const localToken = localById.get(baseToken.id);
    const remoteToken = remoteById.get(baseToken.id);
    if (!localToken && !remoteToken) continue;
    const localKey = localToken ? pathKey(localToken.path) : undefined;
    const remoteKey = remoteToken ? pathKey(remoteToken.path) : undefined;
    matchedKeys.add(baseKey);
    if (localKey) matchedKeys.add(localKey);
    if (remoteKey) matchedKeys.add(remoteKey);
    merges.push(
      mergeToken(
        baseToken,
        localToken ?? (localKey !== undefined ? input.local.get(localKey) : undefined),
        remoteToken ?? undefined,
      ),
    );
  }

  // Pass 2: path-matched tokens without identity.
  for (const [baseKey, baseToken] of input.base) {
    if (matchedKeys.has(baseKey)) continue;
    const localToken = input.local.get(baseKey);
    const remoteToken = input.remote.get(baseKey);
    if (!localToken && !remoteToken) {
      matchedKeys.add(baseKey);
      continue;
    }
    matchedKeys.add(baseKey);
    merges.push(mergeToken(baseToken, localToken, remoteToken));
  }

  // Pass 3: additions and deletions on each side.
  for (const [localKey, localToken] of input.local) {
    if (matchedKeys.has(localKey)) continue;
    const baseToken = input.base.get(localKey);
    const remoteToken = input.remote.get(localKey);
    matchedKeys.add(localKey);
    if (baseToken) {
      // Deleted locally.
      if (remoteToken && !deepEqual(remoteToken, baseToken)) {
        merges.push({
          id: baseToken.id,
          path: localKey,
          oldPath: localKey,
          decision: 'delete-vs-edit',
          conflicts: [{ field: '$token', base: 'present', local: 'deleted', remote: 'edited' }],
          local: localToken,
          remote: remoteToken,
          base: baseToken,
          diagnostics: [],
        });
      } else {
        merges.push({
          id: baseToken.id,
          path: localKey,
          oldPath: localKey,
          decision: 'accept-remote',
          conflicts: [],
          local: localToken,
          remote: remoteToken ?? remoteTokenFromBase(baseToken),
          base: baseToken,
          result: remoteToken ?? baseToken,
          diagnostics: [],
        });
      }
      continue;
    }
    const remoteExists = input.remote.has(localKey);
    if (remoteExists) {
      merges.push({
        path: localKey,
        decision: 'same-change',
        conflicts: [],
        local: localToken,
        remote: input.remote.get(localKey)!,
        result: localToken,
        diagnostics: [],
      });
      matchedKeys.add(localKey);
      continue;
    }
    merges.push({
      id: localToken.id,
      path: localKey,
      decision: 'accept-local',
      conflicts: [],
      local: localToken,
      remote: remoteToken ?? localToken,
      result: localToken,
      diagnostics: [],
    });
  }

  // Remaining remote additions (not in base, not in local).
  for (const [remoteKey, remoteToken] of input.remote) {
    if (matchedKeys.has(remoteKey)) continue;
    matchedKeys.add(remoteKey);
    merges.push({
      id: remoteToken.id,
      path: remoteKey,
      decision: 'accept-remote',
      conflicts: [],
      local: remoteToken,
      remote: remoteToken,
      result: remoteToken,
      diagnostics: [],
    });
  }

  const plan = buildPlan(merges, diagnostics);
  return plan;
}

function mergeToken(
  baseToken: TokenSnapshot,
  localToken: TokenSnapshot | undefined,
  remoteToken: TokenSnapshot | undefined,
): TokenMerge {
  const baseKey = pathKey(baseToken.path);

  if (!localToken && !remoteToken) {
    // Deleted on both sides.
    return {
      id: baseToken.id,
      path: baseKey,
      oldPath: baseKey,
      decision: 'same-change',
      conflicts: [],
      local: baseToken,
      remote: baseToken,
      diagnostics: [],
    };
  }
  if (!localToken) {
    // Deleted locally.
    if (remoteToken && !deepEqual(remoteToken, baseToken)) {
      return {
        id: baseToken.id,
        path: baseKey,
        oldPath: baseKey,
        decision: 'delete-vs-edit',
        conflicts: [{ field: '$token', base: 'present', local: 'deleted', remote: 'edited' }],
        local: baseToken,
        remote: remoteToken,
        base: baseToken,
        diagnostics: [],
      };
    }
    return {
      id: baseToken.id,
      path: baseKey,
      oldPath: baseKey,
      decision: 'accept-remote',
      conflicts: [],
      local: baseToken,
      remote: remoteToken ?? baseToken,
      base: baseToken,
      result: remoteToken ?? baseToken,
      diagnostics: [],
    };
  }
  if (!remoteToken) {
    // Deleted remotely.
    if (!deepEqual(localToken, baseToken)) {
      return {
        id: baseToken.id,
        path: baseKey,
        oldPath: baseKey,
        decision: 'delete-vs-edit',
        conflicts: [{ field: '$token', base: 'present', local: 'edited', remote: 'deleted' }],
        local: localToken,
        remote: baseToken,
        base: baseToken,
        diagnostics: [],
      };
    }
    return {
      id: baseToken.id,
      path: baseKey,
      oldPath: baseKey,
      decision: 'accept-local',
      conflicts: [],
      local: localToken,
      remote: baseToken,
      base: baseToken,
      result: localToken,
      diagnostics: [],
    };
  }

  const localKey = pathKey(localToken.path);
  const remoteKey = pathKey(remoteToken.path);

  // Both sides renamed to different paths — explicit conflict.
  if (baseToken.id && localKey !== baseKey && remoteKey !== baseKey && localKey !== remoteKey) {
    return {
      id: baseToken.id,
      path: localKey,
      oldPath: baseKey,
      decision: 'conflict',
      conflicts: [{ field: 'path', base: baseKey, local: localKey, remote: remoteKey }],
      local: localToken,
      remote: remoteToken,
      base: baseToken,
      diagnostics: [],
    };
  }

  // Rename on one side + value edit on the other: combine when identity is
  // certain (both carry the same stable id).
  if (
    baseToken.id &&
    localKey !== baseKey &&
    remoteKey === baseKey &&
    !deepEqual(remoteToken.value, baseToken.value)
  ) {
    const localDelta = fieldDelta('value', baseToken, localToken);
    const remoteDelta = fieldDelta('value', baseToken, remoteToken);
    if (localDelta === 'same' && remoteDelta === 'changed') {
      const result: TokenSnapshot = { ...remoteToken, path: localToken.path, id: baseToken.id };
      return {
        id: baseToken.id,
        path: localKey,
        oldPath: baseKey,
        decision: 'combined-rename-value',
        conflicts: [],
        local: localToken,
        remote: remoteToken,
        base: baseToken,
        result,
        diagnostics: [],
      };
    }
  }

  // Field-level merge.
  const conflicts: FieldConflict[] = [];
  const result: TokenSnapshot = {
    id: baseToken.id,
    path: localToken.path,
    type: mergeField('type', baseToken, localToken, remoteToken, conflicts),
    value: mergeField('value', baseToken, localToken, remoteToken, conflicts),
    description: mergeField('description', baseToken, localToken, remoteToken, conflicts),
    deprecated: mergeField('deprecated', baseToken, localToken, remoteToken, conflicts),
    extensions: mergeField('extensions', baseToken, localToken, remoteToken, conflicts),
    sourcePointer: localToken.sourcePointer ?? remoteToken.sourcePointer,
  } as TokenSnapshot;
  if (result.type === undefined) delete result.type;
  if (result.description === undefined) delete result.description;
  if (result.deprecated === undefined) delete result.deprecated;

  const localChanged = !deepEqual(localToken, baseToken);
  const remoteChanged = !deepEqual(remoteToken, baseToken);

  let decision: MergeDecision;
  if (!localChanged && !remoteChanged) decision = 'same-change';
  else if (!localChanged) decision = 'accept-remote';
  else if (!remoteChanged) decision = 'accept-local';
  else if (conflicts.length === 0) decision = 'same-change';
  else decision = 'conflict';

  const tokenMerge: TokenMerge = {
    id: baseToken.id,
    path: localKey,
    oldPath: baseKey === localKey ? undefined : baseKey,
    decision,
    conflicts,
    local: localToken,
    remote: remoteToken,
    base: baseToken,
    result: decision === 'conflict' ? undefined : result,
    diagnostics: [],
  };

  // Value-level validation of the merged result. Pure references are not
  // codec-validated (their type is the target's type, per the format).
  if (
    result.value !== undefined &&
    result.type !== undefined &&
    isStableTokenType(result.type) &&
    !isPureReference(result.value)
  ) {
    const ctx = { sourceFileId: 'merge', pointer: localKey, path: localToken.path };
    const validation = validateTokenValue(result.type, result.value, ctx);
    if (validation.diagnostics.length > 0) {
      tokenMerge.diagnostics.push(...validation.diagnostics);
      tokenMerge.decision = 'conflict';
      tokenMerge.conflicts.push({
        field: 'value',
        base: baseToken.value,
        local: localToken.value,
        remote: remoteToken.value,
      });
      tokenMerge.result = undefined;
    }
  }
  return tokenMerge;
}

type FieldName = 'type' | 'value' | 'description' | 'deprecated' | 'extensions';

function fieldDelta(
  field: FieldName,
  base: TokenSnapshot,
  next: TokenSnapshot,
): 'same' | 'changed' {
  return deepEqual(base[field], next[field]) ? 'same' : 'changed';
}

function mergeField(
  field: FieldName,
  base: TokenSnapshot,
  local: TokenSnapshot,
  remote: TokenSnapshot,
  conflicts: FieldConflict[],
): unknown {
  const localDelta = fieldDelta(field, base, local);
  const remoteDelta = fieldDelta(field, base, remote);
  if (localDelta === 'same') return remote[field];
  if (remoteDelta === 'same') return local[field];
  if (deepEqual(local[field], remote[field])) return local[field];
  // Both changed differently: composite values merge per component.
  if (field === 'value' && isComposite(local[field]) && isComposite(remote[field])) {
    const mergedComponents = mergeComponents(base[field], local[field], remote[field], conflicts);
    if (mergedComponents !== undefined) return mergedComponents;
  }
  conflicts.push({ field, base: base[field], local: local[field], remote: remote[field] });
  return undefined;
}

function isComposite(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeComponents(
  base: unknown,
  local: unknown,
  remote: unknown,
  conflicts: FieldConflict[],
): unknown | undefined {
  const baseRecord = base as Record<string, unknown>;
  const localRecord = local as Record<string, unknown>;
  const remoteRecord = remote as Record<string, unknown>;
  const keys = new Set([...Object.keys(localRecord), ...Object.keys(remoteRecord)]);
  const result: Record<string, unknown> = {};
  let conflicted = false;
  for (const key of keys) {
    const baseValue = baseRecord[key];
    const localValue = localRecord[key];
    const remoteValue = remoteRecord[key];
    if (deepEqual(localValue, baseValue)) result[key] = remoteValue;
    else if (deepEqual(remoteValue, baseValue)) result[key] = localValue;
    else if (deepEqual(localValue, remoteValue)) result[key] = localValue;
    else {
      conflicts.push({
        field: `value.${key}`,
        base: baseValue,
        local: localValue,
        remote: remoteValue,
      });
      conflicted = true;
    }
  }
  return conflicted ? undefined : result;
}

function buildPlan(merges: TokenMerge[], diagnostics: TokenDiagnostic[]): TokenMergePlan {
  const conflicted = merges.filter(
    (m) => m.decision === 'conflict' || m.decision === 'delete-vs-edit',
  );
  const mergedTokens: TokenSnapshotMap = new Map();
  for (const merge of merges) {
    if (merge.result) mergedTokens.set(pathKey(merge.result.path), merge.result);
  }
  // Cycle check on the merged graph (references must not create cycles).
  const mergedValues = new Map<string, unknown>();
  for (const merge of merges) {
    if (merge.result?.value !== undefined)
      mergedValues.set(pathKey(merge.result.path), merge.result.value);
  }
  const cycle = detectMergedGraphCycle(mergedValues);
  if (cycle) {
    diagnostics.push({
      severity: 'error',
      code: 'merge.cycle',
      message: `The proposed merged graph contains a reference cycle involving ${cycle}`,
      sourceFileId: 'merge',
    });
  }
  const valid = conflicted.length === 0 && !cycle;
  return {
    merges,
    diagnostics,
    valid,
    affectedCount: merges.filter((m) => m.decision !== 'same-change').length,
  };
}

function detectMergedGraphCycle(values: Map<string, unknown>): string | undefined {
  const edges = new Map<string, string[]>();
  for (const [key, value] of values) {
    const refs: string[] = [];
    collectReferences(value, refs);
    if (refs.length > 0) edges.set(key, refs);
  }
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const visit = (key: string, stack: Set<string>): string | undefined => {
    color.set(key, GRAY);
    stack.add(key);
    for (const target of edges.get(key) ?? []) {
      const state = color.get(target) ?? WHITE;
      if (state === GRAY) return [...stack].find((s) => s === target) ?? key;
      if (state === WHITE) {
        const found = visit(target, stack);
        if (found) return found;
      }
    }
    stack.delete(key);
    color.set(key, BLACK);
    return undefined;
  };
  for (const key of edges.keys()) {
    if ((color.get(key) ?? WHITE) === WHITE) {
      const found = visit(key, new Set());
      if (found) return found;
    }
  }
  return undefined;
}

function collectReferences(value: unknown, refs: string[]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
      refs.push(match[1]!);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, refs);
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectReferences(child, refs);
  }
}

function indexById(map: TokenSnapshotMap): Map<string, TokenSnapshot> {
  const index = new Map<string, TokenSnapshot>();
  for (const snapshot of map.values()) {
    if (snapshot.id) index.set(snapshot.id, snapshot);
  }
  return index;
}

function remoteTokenFromBase(base: TokenSnapshot): TokenSnapshot {
  return { ...base };
}

export { deepEqual, isPureReference };
