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
import { applyMergePlanToSync } from '../syncApply';
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
  it('rejects a remote identity annotation that belongs to another source', () => {
    const sync = seeded(1);
    addOwned(sync, 'tok_foreign', ['foreign'], 5);
    const foreign = sync.store.tokens.tok_foreign!;
    sync.store = {
      ...sync.store,
      tokens: {
        ...sync.store.tokens,
        tok_foreign: {
          ...foreign,
          source: { ...foreign.source!, sourceId: 'src_other' as typeof SOURCE_ID },
        },
      },
    };
    const original = sync.store;
    const summary = planSourceUpdate(
      sync,
      doc('{"a":{"$type":"number","$value":9,"$extensions":{"org.varve":{"id":"tok_foreign"}}}}'),
      SOURCE_ID,
    );

    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.foreign-token-id',
    );
    expect(() =>
      applyMergePlanToSync(sync, undefined, summary.plan, 'default', { sourceId: SOURCE_ID }),
    ).toThrow(/sync.foreign-token-id/);
    expect(sync.store).toBe(original);
    expect(sync.store.tokens.tok_foreign?.value).toBe(5);
  });

  it('rejects duplicate stable identities in one remote document', () => {
    const summary = planSourceUpdate(
      seeded(1),
      doc(
        '{"a":{"$type":"number","$value":2,"$extensions":{"org.varve":{"id":"tok_a"}}},"b":{"$type":"number","$value":3,"$extensions":{"org.varve":{"id":"tok_a"}}}}',
      ),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.duplicate-token-id',
    );
    expect(() =>
      applyMergePlanToSync(seeded(1), undefined, summary.plan, 'default', { sourceId: SOURCE_ID }),
    ).toThrow(/sync.duplicate-token-id/);
  });

  it('blocks linked type changes before native modes and property bindings can become stale', () => {
    const sync = seeded(1);
    sync.store = { ...sync.store, variableLinks: { 'var-linked': 'tok_a' } };
    const original = sync.store;
    const summary = planSourceUpdate(
      sync,
      doc('{"a":{"$type":"dimension","$value":{"value":1,"unit":"px"}}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.linked-type-change-unsupported',
    );
    expect(sync.store).toBe(original);
    expect(sync.store.tokens.tok_a?.type).toBe('number');
  });

  it('permits a valid unlinked token type change', () => {
    const summary = planSourceUpdate(
      seeded(1),
      doc('{"a":{"$type":"dimension","$value":{"value":1,"unit":"px"}}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(true);
    expect(summary.updated).toBe(1);
  });

  it('blocks a linked dimension update that would remove its runtime projection', () => {
    const sync = seeded({ value: 8, unit: 'px' });
    const token = sync.store.tokens.tok_a!;
    sync.store = {
      ...sync.store,
      tokens: { ...sync.store.tokens, tok_a: { ...token, type: 'dimension' } },
      variableLinks: { 'var-linked': 'tok_a' },
    };
    sync.store = setBaseSnapshot(sync.store, captureBaseSnapshot(sync.store, SOURCE_ID, 'T0'));

    const summary = planSourceUpdate(
      sync,
      doc('{"a":{"$type":"dimension","$value":{"value":1,"unit":"rem"}}}'),
      SOURCE_ID,
    );

    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'token.runtime-projection-change-unsupported',
    );
    expect(sync.store.tokens.tok_a?.value).toEqual({ value: 8, unit: 'px' });
  });

  it('checks the runtime projection when a linked token is renamed', () => {
    const sync = seeded({ value: 8, unit: 'px' });
    const token = sync.store.tokens.tok_a!;
    sync.store = {
      ...sync.store,
      tokens: { ...sync.store.tokens, tok_a: { ...token, type: 'dimension' } },
      variableLinks: { 'var-linked': 'tok_a' },
    };
    sync.store = setBaseSnapshot(sync.store, captureBaseSnapshot(sync.store, SOURCE_ID, 'T0'));

    const summary = planSourceUpdate(
      sync,
      doc(
        '{"renamed":{"$type":"dimension","$value":{"value":1,"unit":"rem"},"$extensions":{"org.varve":{"id":"tok_a"}}}}',
      ),
      SOURCE_ID,
    );

    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'token.runtime-projection-change-unsupported',
    );
  });

  it('blocks a remote addition that collides with a retained local token', () => {
    const sync = seeded(1);
    addOwned(sync, 'tok_local', ['b'], 7);
    const local = sync.store.tokens.tok_local!;
    sync.store = {
      ...sync.store,
      tokens: { ...sync.store.tokens, tok_local: { ...local, source: undefined } },
    };
    const summary = planSourceUpdate(
      sync,
      doc('{"a":{"$type":"number","$value":1},"b":{"$type":"number","$value":9}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.path-collision',
    );
    expect(sync.store.tokens.tok_local?.value).toBe(7);
  });
  it('blocks a deletion that would leave a retained local alias dangling', () => {
    const sync = seeded(1);
    addOwned(sync, 'tok_local_alias', ['localAlias'], '{a}');
    const alias = sync.store.tokens.tok_local_alias!;
    sync.store = {
      ...sync.store,
      tokens: { ...sync.store.tokens, tok_local_alias: { ...alias, source: undefined } },
    };
    const summary = planSourceUpdate(sync, doc('{}'), SOURCE_ID);
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(
      true,
    );
    expect(sync.store.tokens.tok_a?.value).toBe(1);
  });
  it('blocks changed source group metadata without mutating the stored metadata', () => {
    const sync = seeded(1);
    const existing = {
      description: 'Brand colors',
      deprecated: 'Use the core palette',
      extensions: { 'org.example': { owner: 'design' } },
    };
    sync.store = { ...sync.store, groupMeta: { brand: existing } };
    const summary = planSourceUpdate(
      sync,
      doc(
        '{"a":{"$type":"number","$value":1},"brand":{"$description":"Updated brand colors","$deprecated":true,"$extensions":{"org.example":{"owner":"product"}},"new":{"$type":"number","$value":2}}}',
      ),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'sync.group-metadata-update-unsupported',
        severity: 'error',
        message: expect.stringMatching(
          /updates tokens only.*preserve the original group metadata/i,
        ),
      }),
    );
    expect(sync.store.groupMeta?.brand).toEqual(existing);
  });

  it('blocks new group metadata when a source update adds tokens under that group', () => {
    const sync = seeded(1);
    const summary = planSourceUpdate(
      sync,
      doc(
        '{"a":{"$type":"number","$value":1},"brand":{"$description":"Brand colors","new":{"$type":"number","$value":2}}}',
      ),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.group-metadata-update-unsupported',
    );
  });

  it('allows token additions when incoming group metadata matches the document', () => {
    const sync = seeded(1);
    const existing = {
      description: 'Brand colors',
      deprecated: 'Use the core palette',
      extensions: { 'org.example': { owner: 'design' } },
    };
    sync.store = { ...sync.store, groupMeta: { brand: existing } };
    const summary = planSourceUpdate(
      sync,
      doc(
        '{"a":{"$type":"number","$value":1},"brand":{"$description":"Brand colors","$deprecated":"Use the core palette","$extensions":{"org.example":{"owner":"design"}},"new":{"$type":"number","$value":2}}}',
      ),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(true);
    expect(summary.added).toBe(1);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'sync.group-metadata-update-unsupported',
    );
  });

  it('blocks removing group metadata from a group that remains in the source', () => {
    const sync = seeded(1);
    sync.store = {
      ...sync.store,
      groupMeta: { brand: { description: 'Brand colors', extensions: {} } },
    };
    const summary = planSourceUpdate(
      sync,
      doc('{"a":{"$type":"number","$value":1},"brand":{"new":{"$type":"number","$value":2}}}'),
      SOURCE_ID,
    );
    expect(summary.valid).toBe(false);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.group-metadata-update-unsupported',
    );
  });

  it('blocks a disappeared group when it contains tokens owned by this source', () => {
    const sync = seeded(1);
    addOwned(sync, 'tok_brand_primary', ['brand', 'primary'], 2);
    sync.store = {
      ...sync.store,
      groupMeta: { brand: { description: 'Brand colors', extensions: {} } },
    };
    sync.store = setBaseSnapshot(sync.store, captureBaseSnapshot(sync.store, SOURCE_ID, 'T1'));
    const summary = planSourceUpdate(sync, doc('{"a":{"$type":"number","$value":1}}'), SOURCE_ID);
    expect(summary.valid).toBe(false);
    expect(summary.deleted).toBe(1);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'sync.group-metadata-update-unsupported',
    );
  });

  it('does not attribute foreign group metadata to this source re-import', () => {
    const sync = seeded(1);
    sync.store = addToken(sync.store, {
      id: 'tok_foreign',
      path: ['foreign', 'token'],
      displayName: 'token',
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
    sync.store = {
      ...sync.store,
      groupMeta: { foreign: { description: 'Owned elsewhere', extensions: {} } },
    };
    const summary = planSourceUpdate(sync, doc('{"a":{"$type":"number","$value":1}}'), SOURCE_ID);
    expect(summary.valid).toBe(true);
    expect(summary.plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'sync.group-metadata-update-unsupported',
    );
  });

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
