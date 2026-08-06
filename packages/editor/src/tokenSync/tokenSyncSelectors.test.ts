/**
 * Token Sync Center selector tests (pure, node).
 */

import { addSource, addToken, createEmptyTokenSynchronization } from '@varve/scene/tokens';
import { describe, expect, it } from 'vitest';
import { changeSummary, sourceStatusRows, syncStatusLabel } from './tokenSyncSelectors';

function seededSync() {
  const sync = createEmptyTokenSynchronization();
  sync.store = addSource(sync.store, {
    id: 'src_one',
    name: 'Brand tokens',
    kind: 'local-file',
    direction: 'bidirectional',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: ['tokens.json'],
      direction: 'bidirectional',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'diverged', lastSyncAt: '2026-08-05T00:00:00.000Z' },
  });
  sync.store = addToken(sync.store, {
    id: 'tok_a',
    path: ['color', 'brand', 'primary'],
    displayName: 'primary',
    type: 'color',
    value: '#0066cc',
    extensions: {},
    source: {
      sourceId: 'src_one',
      sourceFileId: 'tokens.json',
      sourcePointer: '/color/brand/primary',
      adapterId: 'dtcg-2025.10',
      specificationVersion: '2025.10',
    },
    localState: {
      createdLocally: false,
      detachedFromSource: false,
      locallyModified: true,
      unresolved: false,
      conflicted: true,
    },
  } as never).store;
  sync.store = addToken(sync.store, {
    id: 'tok_b',
    path: ['spacing', 'small'],
    displayName: 'small',
    type: 'dimension',
    value: { value: 8, unit: 'px' },
    extensions: {},
    source: {
      sourceId: 'src_one',
      sourceFileId: 'tokens.json',
      sourcePointer: '/spacing/small',
      adapterId: 'dtcg-2025.10',
      specificationVersion: '2025.10',
    },
    localState: {
      createdLocally: false,
      detachedFromSource: false,
      locallyModified: false,
      unresolved: false,
      conflicted: false,
    },
  } as never).store;
  return sync;
}

describe('sourceStatusRows', () => {
  it('summarizes sources with token counts and conflict counts', () => {
    const rows = sourceStatusRows(seededSync());
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe('Brand tokens');
    expect(row.status).toBe('diverged');
    expect(row.tokenCount).toBe(2);
    expect(row.locallyModifiedCount).toBe(1);
    expect(row.conflictCount).toBe(1);
    expect(row.lastSyncAt).toBe('2026-08-05T00:00:00.000Z');
  });

  it('returns an empty list without sync state', () => {
    expect(sourceStatusRows(undefined)).toEqual([]);
  });
});

describe('changeSummary', () => {
  it('aggregates token state across the store', () => {
    const summary = changeSummary(seededSync());
    expect(summary.total).toBe(2);
    expect(summary.locallyModified).toBe(1);
    expect(summary.conflicted).toBe(1);
  });

  it('counts tombstones as deletions', () => {
    const sync = seededSync();
    sync.store = {
      ...sync.store,
      tombstones: {
        tok_gone: {
          tokenId: 'tok_gone',
          path: ['a'],
          deletedBy: 'remote',
          at: '2026-08-05T00:00:00.000Z',
        },
      },
    };
    expect(changeSummary(sync).deletedTombstones).toBe(1);
  });
});

describe('syncStatusLabel', () => {
  it('maps every status to a human label', () => {
    expect(syncStatusLabel('clean')).toBe('In sync');
    expect(syncStatusLabel('conflicted')).toBe('Conflicts');
    expect(syncStatusLabel('unavailable')).toBe('Source unavailable');
    expect(syncStatusLabel('disconnected')).toBe('Disconnected');
  });
});
