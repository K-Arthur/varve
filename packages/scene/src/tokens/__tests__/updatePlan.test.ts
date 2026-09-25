/**
 * External-update planning tests (ADR-0108/0110).
 *
 * A re-import of a connected source is a base/local/remote three-way merge:
 * local edits survive, remote edits apply, deletions are explicit, and
 * concurrent edits become reviewable conflicts — never a silent overwrite.
 */

import { parseFormatDocument } from '@varve/tokens';
import { describe, expect, it } from 'vitest';
import {
  addSource,
  addToken,
  captureBaseSnapshot,
  createEmptyTokenSynchronization,
  type DesignTokenRecord,
  setBaseSnapshot,
  type TokenSynchronization,
} from '..';
import { planSourceUpdate } from '../updatePlan';

const SOURCE_ID = 'src_update' as const;

function seedSource(): TokenSynchronization {
  const sync = createEmptyTokenSynchronization();
  sync.store = addSource(sync.store, {
    id: SOURCE_ID,
    name: 'Brand tokens',
    kind: 'local-file',
    direction: 'bidirectional',
    adapterId: 'dtcg-2025.10',
    configuration: {
      entryFiles: ['tokens.json'],
      direction: 'bidirectional',
      stableIdPolicy: 'annotate',
    },
    syncState: { status: 'clean' },
  });
  return sync;
}

function addOwned(
  sync: TokenSynchronization,
  id: string,
  path: string[],
  value: unknown,
  type = 'number',
): void {
  const record = {
    id,
    path,
    displayName: path[path.length - 1],
    type,
    value,
    extensions: {},
    source: {
      sourceId: SOURCE_ID,
      sourceFileId: 'tokens.json',
      sourcePointer: `/${path.join('/')}`,
      adapterId: 'dtcg-2025.10',
      specificationVersion: '2025.10',
      lastImportedValue: value,
    },
    localState: {
      createdLocally: false,
      detachedFromSource: false,
      locallyModified: false,
      unresolved: false,
      conflicted: false,
    },
  } as DesignTokenRecord;
  sync.store = addToken(sync.store, record as never).store;
}

/** Seed `a` locally, then capture the base as if it were imported with
 * `baseValue` (so local and base can differ). */
function seeded(baseValue: unknown, localValue: unknown = baseValue): TokenSynchronization {
  const sync = seedSource();
  addOwned(sync, 'tok_a', ['a'], localValue);
  const store = sync.store;
  const token = store.tokens.tok_a as DesignTokenRecord;
  const baseSource = {
    ...store,
    tokens: { ...store.tokens, tok_a: { ...token, value: baseValue } },
  };
  return {
    ...sync,
    store: setBaseSnapshot(store, captureBaseSnapshot(baseSource, SOURCE_ID, 'T0')),
  };
}

function doc(text: string) {
  return parseFormatDocument(text, { sourceFileId: 'tokens.json' });
}

describe('planSourceUpdate', () => {
  it('applies a remote value edit when the local copy is unchanged', () => {
    const summary = planSourceUpdate(
      seeded(1),
      doc('{"a": {"$type": "number", "$value": 2}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(true);
    expect(summary.updated).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.deleted).toBe(0);
    expect(summary.conflicts).toHaveLength(0);
  });

  it('treats a local-only edit as unchanged when the source did not move', () => {
    const summary = planSourceUpdate(
      seeded(1, 7),
      doc('{"a": {"$type": "number", "$value": 1}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(true);
    expect(summary.updated).toBe(0);
    expect(summary.unchanged).toBe(1);
  });

  it('surfaces concurrent edits as an explicit conflict, then resolves it', () => {
    const sync = seeded(1, 2);
    const remote = doc('{"a": {"$type": "number", "$value": 3}}');

    const unresolved = planSourceUpdate(sync, remote, SOURCE_ID);
    expect(unresolved.valid).toBe(false);
    expect(unresolved.conflicts).toHaveLength(1);
    expect(unresolved.conflicts[0]?.key).toBe('a');
    expect(unresolved.conflicts[0]?.local.value).toBe(2);
    expect(unresolved.conflicts[0]?.remote.value).toBe(3);

    const resolved = planSourceUpdate(sync, remote, SOURCE_ID, { a: 'remote' });
    expect(resolved.valid).toBe(true);
    expect(resolved.conflicts).toHaveLength(0);
    expect(resolved.updated).toBe(1);
    expect(resolved.plan.merges[0]?.result?.value).toBe(3);
  });

  it('reports a source deletion when the local copy is unchanged', () => {
    const summary = planSourceUpdate(seeded(1), doc('{}'), SOURCE_ID);
    expect(summary.valid).toBe(true);
    expect(summary.deleted).toBe(1);
    expect(summary.plan.merges[0]?.deleted).toBe(true);
  });

  it('reports a remote addition as new', () => {
    const summary = planSourceUpdate(
      seeded(1),
      doc('{"a": {"$type": "number", "$value": 1}, "b": {"$type": "number", "$value": 9}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(true);
    expect(summary.unchanged).toBe(1);
    expect(summary.added).toBe(1);
  });

  it('ignores tokens owned by another source', () => {
    const sync = seeded(1);
    sync.store = addToken(sync.store, {
      id: 'tok_local',
      path: ['local'],
      displayName: 'local',
      type: 'number',
      value: 5,
      extensions: {},
      localState: {
        createdLocally: true,
        detachedFromSource: false,
        locallyModified: false,
        unresolved: false,
        conflicted: false,
      },
    } as never).store;
    const summary = planSourceUpdate(sync, doc('{}'), SOURCE_ID);
    expect(summary.deleted).toBe(1);
    expect(summary.plan.merges.find((m) => m.path === 'local')).toBeUndefined();
  });
});
