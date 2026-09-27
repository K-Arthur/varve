/**
 * External-update planning (ADR-0108/0110/0117).
 *
 * When a connected source is re-read (the user re-imports a file that
 * already owns tokens), the update is planned as a base/local/remote
 * three-way semantic merge — never a source-wins overwrite and never a
 * timestamp comparison.
 *
 * - base  = the token state captured at the last clean sync
 *           (`TokenBaseSnapshot.tokenBases`; provenance value as a fallback)
 * - local = the tokens currently owned by the source in this document
 * - remote= the tokens in the re-read document
 *
 * The function is pure: it returns a validated `TokenMergePlan` plus a
 * user-facing summary. Nothing is applied until the caller commits the plan.
 */
import {
  applyConflictResolutions,
  buildReferenceGraph,
  type ConflictResolutionChoice,
  type DtcgDocument,
  deepEqual,
  type FieldConflict,
  pathKey,
  resolveFormatTokenValue,
  snapshotFromDocument,
  type TokenMerge,
  type TokenMergePlan,
  type TokenSnapshot,
  type TokenSnapshotMap,
  threeWayMerge,
  validateResolvedTokenValues,
} from '@varve/tokens';
import type {
  DesignTokenStore,
  TokenGroupMeta,
  TokenSourceId,
  TokenSynchronization,
} from './model';
import { remoteIdentityDiagnostics } from './mutationSafety';
import { formatDocumentFromTokenRecords, projectTokenValue } from './runtimeProjection';
import { tokensBySource } from './store';
import { stableVarveId } from './variableBridge';

export interface SourceUpdateConflict {
  /** pathKey of the conflicting token. */
  key: string;
  path: readonly string[];
  localDeleted: boolean;
  remoteDeleted: boolean;
  fields: FieldConflict[];
  local: TokenSnapshot;
  remote: TokenSnapshot;
  base?: TokenSnapshot;
}

export interface SourceUpdateSummary {
  added: number;
  updated: number;
  deleted: number;
  unchanged: number;
  conflicts: SourceUpdateConflict[];
  valid: boolean;
  plan: TokenMergePlan;
}

function recordToSnapshot(
  id: string,
  path: readonly string[],
  type: string,
  value: unknown,
  description: string | undefined,
  deprecated: boolean | string | undefined,
  extensions: Record<string, unknown>,
): TokenSnapshot {
  return {
    id,
    path: [...path],
    type,
    value,
    ...(description !== undefined ? { description } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
    extensions,
  };
}

/** Base map reconstructed from the captured snapshot (provenance fallback). */
function baseSnapshotMap(store: DesignTokenStore, sourceId: TokenSourceId): TokenSnapshotMap {
  const out: TokenSnapshotMap = new Map();
  const base = store.bases[sourceId];
  for (const token of tokensBySource(store, sourceId)) {
    const record = base?.tokenBases?.[token.id];
    const snapshot = record
      ? recordToSnapshot(
          token.id,
          [...record.path],
          record.type,
          record.value,
          record.description,
          record.deprecated,
          record.extensions,
        )
      : // Legacy store without captured bases: treat the last-imported value
        // as the base and current metadata as unchanged. Conservative — local
        // edits still surface via the locallyModified flag on the merge.
        recordToSnapshot(
          token.id,
          token.path,
          token.type,
          token.source?.lastImportedValue ?? token.value,
          token.description,
          token.deprecated,
          token.extensions,
        );
    snapshot.sourcePointer = token.source?.sourcePointer;
    out.set(pathKey(snapshot.path), snapshot);
  }
  return out;
}

function localSnapshotMap(store: DesignTokenStore, sourceId: TokenSourceId): TokenSnapshotMap {
  const out: TokenSnapshotMap = new Map();
  for (const token of tokensBySource(store, sourceId)) {
    const snapshot = recordToSnapshot(
      token.id,
      token.path,
      token.type,
      token.value,
      token.description,
      token.deprecated,
      token.extensions,
    );
    snapshot.sourcePointer = token.source?.sourcePointer;
    out.set(pathKey(token.path), snapshot);
  }
  return out;
}

/**
 * Remote snapshots from a parsed document. Varve-annotated sources carry a
 * stable `org.varve.id`, which lets a rename be matched by identity instead
 * of path; identity-less files match by path only.
 */
export function remoteSnapshotMap(document: DtcgDocument): TokenSnapshotMap {
  const map = snapshotFromDocument(document);
  for (const snapshot of map.values()) {
    const id = stableVarveId(snapshot.extensions);
    if (id) snapshot.id = id;
  }
  return map;
}

function conflictView(merge: TokenMerge): SourceUpdateConflict {
  return {
    key: merge.path,
    path: merge.result?.path ?? merge.remote?.path ?? merge.local.path,
    localDeleted: merge.localDeleted === true,
    remoteDeleted: merge.remoteDeleted === true,
    fields: merge.conflicts,
    local: merge.local,
    remote: merge.remote,
    ...(merge.base ? { base: merge.base } : {}),
  };
}

function normalizedGroupMeta(meta: Partial<TokenGroupMeta> | undefined): TokenGroupMeta {
  return {
    ...(meta?.description !== undefined ? { description: meta.description } : {}),
    ...(meta?.deprecated !== undefined ? { deprecated: meta.deprecated } : {}),
    extensions: meta?.extensions ?? {},
  };
}

/** Flatten effective group metadata the same way initial import stores it. */
function incomingGroupMeta(document: DtcgDocument): Map<string, TokenGroupMeta> {
  const result = new Map<string, TokenGroupMeta>();
  const visit = (groups: DtcgDocument['groups']): void => {
    for (const group of groups) {
      result.set(
        pathKey(group.path),
        normalizedGroupMeta({
          description: group.description,
          deprecated: group.deprecated,
          extensions: group.extensions,
        }),
      );
      visit(group.children.filter((child) => child.kind === 'group'));
    }
  };
  visit(document.groups);
  return result;
}

/**
 * Re-import currently applies token merges but has no group-metadata base or
 * merge operation. Reject material metadata differences rather than report a
 * successful update while leaving the old document metadata in place.
 */
function groupMetadataUpdateDiagnostics(
  document: DtcgDocument,
  current: Readonly<Record<string, TokenGroupMeta>> | undefined,
  sourceTokenPaths: readonly (readonly string[])[],
) {
  const diagnostics: TokenMergePlan['diagnostics'] = [];
  const incoming = incomingGroupMeta(document);
  const report = (key: string): void => {
    diagnostics.push({
      severity: 'error',
      code: 'sync.group-metadata-update-unsupported',
      message: `Group metadata at "${key}" differs from the document, but source re-import currently updates tokens only. The update is blocked so the metadata is not silently lost or left stale; preserve the original group metadata and retry after group-metadata sync is supported.`,
      sourceFileId: document.sourceFileId,
    });
  };

  for (const [key, metadata] of incoming) {
    if (deepEqual(normalizedGroupMeta(current?.[key]), metadata)) continue;
    report(key);
  }

  for (const key of Object.keys(current ?? {})) {
    if (incoming.has(key)) continue;
    const groupPath = key.split('.');
    // groupMeta has no source provenance. Only attribute a disappeared group
    // to this re-import when the source currently owns a token below it;
    // metadata-only and foreign groups cannot be assigned safely.
    const sourceOwnsAChild = sourceTokenPaths.some(
      (path) => path.length > groupPath.length && pathKey(path.slice(0, groupPath.length)) === key,
    );
    if (sourceOwnsAChild) report(key);
  }

  return diagnostics;
}

/** Type migration needs property and native-mode handling before relabeling a linked Variable. */
function linkedTypeChangeDiagnostics(
  store: DesignTokenStore,
  merges: readonly TokenMerge[],
  sourceFileId: string,
): TokenMergePlan['diagnostics'] {
  const linked = new Set(Object.values(store.variableLinks));
  const currentById = new Map(
    Object.values(store.tokens).map((token) => [token.id as string, token]),
  );
  return merges.flatMap((merge) => {
    const result = merge.result;
    const id = merge.id ?? result?.id ?? merge.local.id;
    const current = id ? currentById.get(id) : undefined;
    if (!current || !result?.type || current.type === result.type || !linked.has(current.id))
      return [];
    return [
      {
        severity: 'error' as const,
        code: 'sync.linked-type-change-unsupported',
        message: `${pathKey(result.path)} changes from ${current.type} to ${result.type}, but its linked Variable may carry property bindings or native mode values. The update is blocked until an explicit type migration can preserve those consumers. Create a distinct token path or retain the existing type.`,
        sourceFileId,
      },
    ];
  });
}

/**
 * Plan an external update for one source. `resolutions` maps a conflicting
 * token's pathKey to the user's choice; unresolved conflicts keep the plan
 * invalid and the caller must not apply it.
 */
function linkedProjectionDiagnostics(
  store: DesignTokenStore,
  proposed: DtcgDocument,
  merges: readonly TokenMerge[],
): TokenMergePlan['diagnostics'] {
  const previous = formatDocumentFromTokenRecords(Object.values(store.tokens), store.groupMeta);
  const linked = new Set(Object.values(store.variableLinks));
  const diagnostics: TokenMergePlan['diagnostics'] = [];
  for (const token of Object.values(store.tokens)) {
    if (!linked.has(token.id)) continue;
    const merge = merges.find(
      (candidate) => candidate.id === token.id || candidate.result?.id === token.id,
    );
    if (!merge?.result || merge.deleted) continue;
    try {
      projectTokenValue(token.type, resolveFormatTokenValue(previous, token.path.join('.')));
    } catch {
      continue;
    }
    const nextPath = pathKey(merge.result.path);
    try {
      projectTokenValue(
        merge.result.type ?? token.type,
        resolveFormatTokenValue(proposed, nextPath),
      );
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: 'token.runtime-projection-change-unsupported',
        sourceFileId: proposed.sourceFileId,
        message: `${token.path.join('.')} currently supplies a working linked value. This update would make it unavailable at ${nextPath}: ${error instanceof Error ? error.message : String(error)} Retain the compatible value or detach its consumers before changing its projection.`,
      });
    }
  }
  return diagnostics;
}

export function planSourceUpdate(
  sync: TokenSynchronization,
  document: DtcgDocument,
  sourceId: TokenSourceId,
  resolutions: Readonly<Record<string, ConflictResolutionChoice>> = {},
): SourceUpdateSummary {
  const store = sync.store;
  const base = baseSnapshotMap(store, sourceId);
  const local = localSnapshotMap(store, sourceId);
  const remote = remoteSnapshotMap(document);
  const identityDiagnostics = remoteIdentityDiagnostics(
    store,
    remote,
    sourceId,
    document.sourceFileId,
  );

  const raw = threeWayMerge({ base, local, remote });
  let plan = Object.keys(resolutions).length > 0 ? applyConflictResolutions(raw, resolutions) : raw;
  if (identityDiagnostics.length > 0)
    plan = { ...plan, valid: false, diagnostics: [...plan.diagnostics, ...identityDiagnostics] };
  if (plan.valid) {
    const records = Object.values(store.tokens).filter(
      (token) => token.source?.sourceId !== sourceId,
    );
    const proposed = plan.merges.flatMap((merge) =>
      merge.result
        ? [
            {
              path: merge.result.path,
              type: merge.result.type ?? 'string',
              value: merge.result.value,
              description: merge.result.description,
              deprecated: merge.result.deprecated,
              extensions: merge.result.extensions,
            },
          ]
        : [],
    );
    const existingPaths = new Set(records.map((record) => pathKey(record.path)));
    const collisions = proposed.filter((record) => existingPaths.has(pathKey(record.path)));
    const mergedDocument = formatDocumentFromTokenRecords(
      [...records, ...proposed],
      store.groupMeta,
    );
    const diagnostics = [
      ...linkedTypeChangeDiagnostics(store, plan.merges, document.sourceFileId),
      ...groupMetadataUpdateDiagnostics(
        document,
        store.groupMeta,
        tokensBySource(store, sourceId).map((token) => token.path),
      ),
      ...mergedDocument.diagnostics,
      ...buildReferenceGraph(mergedDocument).diagnostics,
      ...validateResolvedTokenValues(mergedDocument),
      ...linkedProjectionDiagnostics(store, mergedDocument, plan.merges),
      ...collisions.map((record) => ({
        severity: 'error' as const,
        code: 'sync.path-collision',
        message: `Another source or local token already owns ${pathKey(record.path)}. Choose a distinct path before applying.`,
        sourceFileId: document.sourceFileId,
      })),
    ];
    plan = {
      ...plan,
      diagnostics: [...plan.diagnostics, ...diagnostics],
      valid: !diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
    };
  }

  const summary: SourceUpdateSummary = {
    added: 0,
    updated: 0,
    deleted: 0,
    unchanged: 0,
    conflicts: [],
    valid: plan.valid,
    plan,
  };

  for (const merge of plan.merges) {
    if (merge.decision === 'conflict' || merge.decision === 'delete-vs-edit') {
      summary.conflicts.push(conflictView(merge));
      continue;
    }
    if (merge.decision === 'same-change') {
      summary.unchanged += 1;
      continue;
    }
    if (merge.deleted) {
      summary.deleted += 1;
      continue;
    }
    if (!merge.result) continue;
    if (!merge.base) {
      summary.added += 1;
    } else if (!deepEqual(merge.result, merge.local)) {
      // A local-won merge leaves the document unchanged; only count merges
      // that actually move a token.
      summary.updated += 1;
    } else {
      summary.unchanged += 1;
    }
  }

  summary.valid = summary.conflicts.length === 0 && plan.valid;
  return summary;
}

/** True when the store already owns tokens for this source (a re-sync, not a
 * first import). Drives which workflow the panel offers. */
export function sourceHasTokens(sync: TokenSynchronization | undefined, sourceId: string): boolean {
  if (!sync) return false;
  return tokensBySource(sync.store, sourceId as TokenSourceId).length > 0;
}
