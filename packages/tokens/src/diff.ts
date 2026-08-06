/**
 * Semantic token diffing (ADR-0108 / spec §20).
 *
 * Compares semantic token snapshots — never raw text lines. Change
 * classification distinguishes rename, move, rename+move, value change,
 * type change, metadata change, extension change, source move, delete and
 * recreate, and ambiguous possible renames.
 *
 * Identity precedence: stable id → vendor id → source pointer → path.
 * Heuristic rename detection (no identity metadata) is conservative and
 * flagged ambiguous (ADR-0109).
 */

import { pathKey } from './parse';
import type { DtcgDocument, DtcgTokenNode, TokenDiagnostic } from './types';

export interface TokenSnapshot {
  /** Stable identity when known (org.varve.id, vendor id, or scene token id). */
  id?: string;
  path: string[];
  type?: string;
  value?: unknown;
  description?: string;
  deprecated?: boolean | string;
  extensions: Record<string, unknown>;
  sourcePointer?: string;
  sourceFileId?: string;
}

export type TokenSnapshotMap = Map<string, TokenSnapshot>;

export type TokenChangeKind =
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'moved'
  | 'renamed-moved'
  | 'value-changed'
  | 'reference-changed'
  | 'type-changed'
  | 'metadata-changed'
  | 'extension-changed'
  | 'source-moved'
  | 'delete-recreated'
  | 'possible-rename';

export interface TokenChange {
  kind: TokenChangeKind;
  /** New path (pathKey). */
  path: string;
  oldPath?: string;
  /** Stable identity when known. */
  id?: string;
  details: string[];
  ambiguous?: boolean;
}

export interface SemanticDiff {
  changes: TokenChange[];
  /** True when nothing semantic changed (text may differ — formatting only). */
  formattingOnly: boolean;
  counts: Record<TokenChangeKind, number>;
}

export function snapshotFromDocument(doc: DtcgDocument): TokenSnapshotMap {
  const map: TokenSnapshotMap = new Map();
  for (const token of Object.values(doc.tokens)) {
    map.set(pathKey(token.path), snapshotFromTokenNode(token));
  }
  return map;
}

export function snapshotFromTokenNode(token: DtcgTokenNode): TokenSnapshot {
  return {
    path: token.path,
    type: token.type,
    value: token.value,
    description: token.description,
    deprecated: token.deprecated,
    extensions: token.extensions,
    sourcePointer: token.pointer,
  };
}

export function snapshotFromTokens(tokens: Record<string, DtcgTokenNode>): TokenSnapshotMap {
  const map: TokenSnapshotMap = new Map();
  for (const token of Object.values(tokens)) {
    map.set(pathKey(token.path), snapshotFromTokenNode(token));
  }
  return map;
}

export function semanticDiff(base: TokenSnapshotMap, next: TokenSnapshotMap): SemanticDiff {
  const changes: TokenChange[] = [];
  const counts = createCounts();
  const nextById = new Map<string, TokenSnapshot>();
  for (const snapshot of next.values()) {
    if (snapshot.id) nextById.set(snapshot.id, snapshot);
  }
  const baseById = new Map<string, TokenSnapshot>();
  for (const snapshot of base.values()) {
    if (snapshot.id) baseById.set(snapshot.id, snapshot);
  }

  const consumedBaseKeys = new Set<string>();
  const consumedNextKeys = new Set<string>();

  // 1. Identity-based rename/move detection (exact).
  for (const [baseKey, baseToken] of base) {
    if (!baseToken.id) continue;
    const nextToken = nextById.get(baseToken.id);
    if (!nextToken) continue;
    const nextKey = pathKey(nextToken.path);
    if (nextKey !== baseKey) {
      consumedBaseKeys.add(baseKey);
      consumedNextKeys.add(nextKey);
      const lastSegmentSame =
        baseToken.path[baseToken.path.length - 1] === nextToken.path[nextToken.path.length - 1];
      const prefixSame = samePrefix(baseToken.path, nextToken.path);
      const kind: TokenChangeKind = prefixSame
        ? 'renamed'
        : lastSegmentSame
          ? 'moved'
          : 'renamed-moved';
      changes.push({
        kind,
        path: nextKey,
        oldPath: baseKey,
        id: baseToken.id,
        details: [`path ${baseKey} → ${nextKey}`],
      });
      counts[kind] += 1;
    }
    mergeSnapshotPair(baseToken, nextToken, baseKey, nextKey, changes, counts);
  }

  // 2. Pointer-lineage detection (exact when pointers match).
  // (Source-pointer moves are reported as source-moved only when identity
  // is absent — pointers are provenance, not identity.)

  // 3. Deletions, additions, and path-matched changes.
  for (const [baseKey, baseToken] of base) {
    if (consumedBaseKeys.has(baseKey)) continue;
    const nextToken = next.get(baseKey);
    if (!nextToken) {
      // Deleted — but check for delete+recreate via id on the other side.
      const recreated = [...next.values()].find(
        (t) => t.id !== undefined && t.id !== baseToken.id && pathKey(t.path) === baseKey,
      );
      if (recreated) {
        changes.push({
          kind: 'delete-recreated',
          path: baseKey,
          oldPath: baseKey,
          details: ['same path, different identity — deleted and recreated'],
        });
        counts['delete-recreated'] += 1;
        consumedNextKeys.add(baseKey);
      } else {
        changes.push({
          kind: 'deleted',
          path: baseKey,
          id: baseToken.id,
          details: [`token ${baseKey} removed`],
        });
        counts.deleted += 1;
      }
      continue;
    }
    consumedNextKeys.add(baseKey);
    // Same path, different identity: deleted and recreated in one change set.
    if (nextToken.id !== undefined && baseToken.id !== undefined && nextToken.id !== baseToken.id) {
      changes.push({
        kind: 'delete-recreated',
        path: baseKey,
        oldPath: baseKey,
        id: baseToken.id,
        details: ['same path, different identity — deleted and recreated'],
      });
      counts['delete-recreated'] += 1;
      continue;
    }
    mergeSnapshotPair(baseToken, nextToken, baseKey, baseKey, changes, counts);
  }

  // 4. Pure additions.
  for (const [nextKey, nextToken] of next) {
    if (consumedNextKeys.has(nextKey)) continue;
    changes.push({
      kind: 'added',
      path: nextKey,
      id: nextToken.id,
      details: [`token ${nextKey} added`],
    });
    counts.added += 1;
  }

  // 5. Conservative heuristic renames for identity-less tokens: a deletion
  // and an addition with matching type + value + description in the same
  // change set are proposed as possible renames (never merged).
  const deletedTokens = changes
    .filter((c) => c.kind === 'deleted')
    .map((c) => ({ change: c, snapshot: base.get(c.path) }));
  const addedTokens = changes
    .filter((c) => c.kind === 'added')
    .map((c) => ({ change: c, snapshot: next.get(c.path) }));
  for (const deleted of deletedTokens) {
    if (!deleted.snapshot) continue;
    const candidates = addedTokens.filter(
      (a) =>
        a.snapshot &&
        a.snapshot.type === deleted.snapshot?.type &&
        deepEqual(a.snapshot.value, deleted.snapshot?.value) &&
        a.snapshot.description === deleted.snapshot?.description,
    );
    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      candidate.change.kind = 'possible-rename';
      deleted.change.kind = 'possible-rename';
      deleted.change.path = candidate.change.path;
      deleted.change.oldPath = deleted.change.path;
      deleted.change.ambiguous = true;
      candidate.change.oldPath = candidate.change.path;
      candidate.change.ambiguous = true;
      deleted.change.details = [
        `possible rename ${deleted.change.oldPath} → ${candidate.change.path} (identity unknown, confirm)`,
      ];
      candidate.change.details = ['possible rename — confirm before applying'];
      counts['possible-rename'] += 1;
      counts.deleted -= 1;
      counts.added -= 1;
      deletedTokens.splice(deletedTokens.indexOf(deleted), 1);
      addedTokens.splice(addedTokens.indexOf(candidate), 1);
    }
  }

  return {
    changes,
    formattingOnly: changes.length === 0,
    counts,
  };
}

function mergeSnapshotPair(
  baseToken: TokenSnapshot,
  nextToken: TokenSnapshot,
  baseKey: string,
  nextKey: string,
  changes: TokenChange[],
  counts: Record<TokenChangeKind, number>,
): void {
  const emit = (kind: TokenChangeKind, detail: string): void => {
    changes.push({
      kind,
      path: nextKey,
      oldPath: baseKey === nextKey ? undefined : baseKey,
      id: nextToken.id ?? baseToken.id,
      details: [detail],
    });
    counts[kind] += 1;
  };

  if (baseToken.type !== nextToken.type) {
    emit('type-changed', `type ${baseToken.type ?? 'none'} → ${nextToken.type ?? 'none'}`);
  }
  const baseIsRef = isPureReference(baseToken.value);
  const nextIsRef = isPureReference(nextToken.value);
  if (baseIsRef !== nextIsRef) {
    emit('reference-changed', baseIsRef ? 'literal → reference' : 'reference → literal');
  } else if (!deepEqual(baseToken.value, nextToken.value)) {
    emit('value-changed', 'value changed');
  }
  if (baseToken.description !== nextToken.description) {
    emit('metadata-changed', 'description changed');
  }
  if (baseToken.deprecated !== nextToken.deprecated) {
    emit('metadata-changed', 'deprecation changed');
  }
  if (!deepEqual(baseToken.extensions, nextToken.extensions)) {
    emit('extension-changed', 'extensions changed');
  }
  if (baseToken.sourceFileId !== undefined && baseToken.sourceFileId !== nextToken.sourceFileId) {
    emit('source-moved', 'source file changed');
  }
}

export function isPureReference(value: unknown): boolean {
  if (typeof value === 'string') return /^\{[^{}]+\}$/.test(value.trim());
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return typeof record.$ref === 'string' && Object.keys(record).length === 1;
  }
  return false;
}

function samePrefix(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length - 1; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function createCounts(): Record<TokenChangeKind, number> {
  return {
    added: 0,
    deleted: 0,
    renamed: 0,
    moved: 0,
    'renamed-moved': 0,
    'value-changed': 0,
    'reference-changed': 0,
    'type-changed': 0,
    'metadata-changed': 0,
    'extension-changed': 0,
    'source-moved': 0,
    'delete-recreated': 0,
    'possible-rename': 0,
  };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.hasOwn(b, key)) return false;
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
        return false;
    }
    return true;
  }
  return false;
}

export type { TokenDiagnostic };
