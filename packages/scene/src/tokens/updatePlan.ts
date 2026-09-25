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
  type ConflictResolutionChoice,
  type DtcgDocument,
  deepEqual,
  type FieldConflict,
  pathKey,
  snapshotFromDocument,
  type TokenMerge,
  type TokenMergePlan,
  type TokenSnapshot,
  type TokenSnapshotMap,
  threeWayMerge,
} from '@varve/tokens';
import type { DesignTokenStore, TokenSourceId, TokenSynchronization } from './model';
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

/**
 * Plan an external update for one source. `resolutions` maps a conflicting
 * token's pathKey to the user's choice; unresolved conflicts keep the plan
 * invalid and the caller must not apply it.
 */
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

  const raw = threeWayMerge({ base, local, remote });
  const plan =
    Object.keys(resolutions).length > 0 ? applyConflictResolutions(raw, resolutions) : raw;

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
