/**
 * Token Sync Center selectors (ADR-0107/0108 UI layer).
 *
 * Pure functions that derive display state from the persisted
 * TokenSynchronization on VariableStore: per-source status rows and change
 * summaries. No React, no DOM — unit-testable in node.
 */
import type { TokenSource, TokenSynchronization, TokenSyncStatus } from '@varve/scene/tokens';

export interface SourceStatusRow {
  sourceId: string;
  name: string;
  kind: TokenSource['kind'];
  direction: TokenSource['direction'];
  status: TokenSyncStatus;
  lastSyncAt?: string;
  tokenCount: number;
  locallyModifiedCount: number;
  conflictCount: number;
  unresolvedCount: number;
  deprecatedCount: number;
}

export interface ChangeSummary {
  locallyModified: number;
  conflicted: number;
  unresolved: number;
  createdLocally: number;
  deletedTombstones: number;
  total: number;
}

export function sourceStatusRows(sync: TokenSynchronization | undefined): SourceStatusRow[] {
  if (!sync) return [];
  const { store } = sync;
  const rows: SourceStatusRow[] = [];
  for (const source of Object.values(store.sources)) {
    const tokens = Object.values(store.tokens).filter((t) => t.source?.sourceId === source.id);
    rows.push({
      sourceId: source.id,
      name: source.name,
      kind: source.kind,
      direction: source.direction,
      status: source.syncState.status,
      lastSyncAt: source.syncState.lastSyncAt,
      tokenCount: tokens.length,
      locallyModifiedCount: tokens.filter((t) => t.localState.locallyModified).length,
      conflictCount: tokens.filter((t) => t.localState.conflicted).length,
      unresolvedCount: tokens.filter((t) => t.localState.unresolved).length,
      deprecatedCount: tokens.filter(
        (t) => t.deprecated === true || typeof t.deprecated === 'string',
      ).length,
    });
  }
  return rows;
}

export function changeSummary(sync: TokenSynchronization | undefined): ChangeSummary {
  if (!sync) {
    return {
      locallyModified: 0,
      conflicted: 0,
      unresolved: 0,
      createdLocally: 0,
      deletedTombstones: 0,
      total: 0,
    };
  }
  const tokens = Object.values(sync.store.tokens);
  const summary: ChangeSummary = {
    locallyModified: tokens.filter((t) => t.localState.locallyModified).length,
    conflicted: tokens.filter((t) => t.localState.conflicted).length,
    unresolved: tokens.filter((t) => t.localState.unresolved).length,
    createdLocally: tokens.filter((t) => t.localState.createdLocally).length,
    deletedTombstones: Object.keys(sync.store.tombstones).length,
    total: tokens.length,
  };
  return summary;
}

export function syncStatusLabel(status: TokenSyncStatus): string {
  switch (status) {
    case 'clean':
      return 'In sync';
    case 'local-changes':
      return 'Local changes';
    case 'remote-changes':
      return 'Source changed';
    case 'diverged':
      return 'Diverged';
    case 'conflicted':
      return 'Conflicts';
    case 'invalid':
      return 'Invalid';
    case 'unavailable':
      return 'Source unavailable';
    case 'disconnected':
    default:
      return 'Disconnected';
  }
}
