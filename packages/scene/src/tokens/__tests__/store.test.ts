/**
 * Canonical token model + store tests (ADR-0100/ADR-0102).
 *
 * Verifies: collision-resistant identity, path/type/value validation,
 * path uniqueness, ownership rules, tombstones, base snapshots, variable
 * links, and the persisted round trip through the document codec.
 */
import { describe, expect, it } from 'vitest';

import { createDocument } from '../../document';
import { DocumentCodec } from '../../documentCodec';
import { serializeDocument } from '../../index';
import { createVariableStore, mergeVariableStores } from '../../variables';
import { createSequentialTokenIdGenerator, mintTokenId } from '../identity';
import {
  addSource,
  addToken,
  claimOwnership,
  createEmptyTokenSynchronization,
  createTokenStore,
  deleteToken,
  getTokenByPath,
  linkVariable,
  mintToken,
  renameToken,
  setBaseSnapshot,
  updateToken,
} from '../store';
import {
  bindVariableToToken,
  detachTokenRecord,
  isSynchronizedVariable,
  stableVarveId,
  tokenForVariable,
} from '../variableBridge';

function makeToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tok_abc123' as const,
    path: ['color', 'brand', 'primary'],
    displayName: 'primary',
    type: 'color',
    value: { colorSpace: 'srgb', components: [0, 0.4, 0.8] },
    extensions: {},
    localState: {
      createdLocally: true,
      detachedFromSource: false,
      locallyModified: false,
      unresolved: false,
      conflicted: false,
    },
    ...overrides,
  };
}

describe('token identity', () => {
  it('mints collision-resistant ids decoupled from path', () => {
    const a = mintTokenId();
    const b = mintTokenId();
    expect(a).toMatch(/^tok_/);
    expect(a).not.toBe(b);
  });

  it('supports deterministic generators for tests', () => {
    const gen = createSequentialTokenIdGenerator();
    expect(mintTokenId(gen)).toBe('tok_test-1');
    expect(mintTokenId(gen)).toBe('tok_test-2');
  });
});

describe('token store', () => {
  it('addToken stores a validated record', () => {
    const store = createTokenStore();
    const { token, diagnostics } = addToken(store, makeToken() as never);
    expect(diagnostics).toEqual([]);
    expect(store.tokens[token.id]).toBeUndefined(); // store returned by addToken, not input
    const inserted = addToken(createTokenStore(), makeToken() as never);
    expect(inserted.store.tokens['tok_abc123']?.path).toEqual(['color', 'brand', 'primary']);
  });

  it('rejects duplicate paths', () => {
    let store = createTokenStore();
    const first = addToken(store, makeToken({ id: 'tok_a' }) as never);
    store = first.store;
    const second = addToken(store, makeToken({ id: 'tok_b' }) as never);
    expect(second.diagnostics.map((d) => d.code)).toContain('token.duplicate-path');
  });

  it('rejects duplicate ids', () => {
    const first = addToken(createTokenStore(), makeToken({ id: 'tok_a' }) as never);
    const second = addToken(first.store, makeToken({ id: 'tok_a', path: ['other'] }) as never);
    expect(second.diagnostics.map((d) => d.code)).toContain('token.duplicate-id');
  });

  it('rejects non-finite values', () => {
    const result = addToken(
      createTokenStore(),
      makeToken({ id: 'tok_a', value: { x: Number.NaN } }) as never,
    );
    expect(result.diagnostics.map((d) => d.code)).toContain('token.non-finite-value');
  });

  it('rejects invalid ids and empty paths', () => {
    const badId = addToken(createTokenStore(), makeToken({ id: 'v1' }) as never);
    expect(badId.diagnostics.map((d) => d.code)).toContain('token.invalid-id');
    const emptyPath = addToken(createTokenStore(), makeToken({ id: 'tok_a', path: [] }) as never);
    expect(emptyPath.diagnostics.map((d) => d.code)).toContain('token.empty-path');
  });

  it('renameToken keeps the id and updates the path', () => {
    let store = createTokenStore();
    const { store: s1 } = addToken(store, makeToken({ id: 'tok_a' }) as never);
    store = renameToken(s1, 'tok_a', ['color', 'action', 'primary']);
    expect(getTokenByPath(store, ['color', 'action', 'primary'])?.id).toBe('tok_a');
    expect(getTokenByPath(store, ['color', 'brand', 'primary'])).toBeUndefined();
  });

  it('updateToken preserves extensions by copying', () => {
    const { store } = addToken(
      createTokenStore(),
      makeToken({ id: 'tok_a', extensions: { vendor: 1 } }) as never,
    );
    const updated = updateToken(store, 'tok_a', { description: 'new' });
    expect(updated.token.extensions).toEqual({ vendor: 1 });
  });

  it('deleteToken with tombstone records the deletion', () => {
    const { store } = addToken(createTokenStore(), makeToken({ id: 'tok_a' }) as never);
    const after = deleteToken(store, 'tok_a', { tombstone: true, deletedBy: 'remote' });
    expect(after.tokens['tok_a']).toBeUndefined();
    expect(after.tombstones['tok_a']?.deletedBy).toBe('remote');
    expect(after.tombstones['tok_a']?.path).toEqual(['color', 'brand', 'primary']);
  });

  it('deleteToken without tombstone leaves no trace', () => {
    const { store } = addToken(createTokenStore(), makeToken({ id: 'tok_a' }) as never);
    const after = deleteToken(store, 'tok_a');
    expect(after.tokens['tok_a']).toBeUndefined();
    expect(after.tombstones['tok_a']).toBeUndefined();
  });

  it('ownership is exclusive per token', () => {
    const { store } = addToken(createTokenStore(), makeToken({ id: 'tok_a' }) as never);
    const claimed = claimOwnership(store, 'tok_a', 'src_one');
    const conflict = claimOwnership(claimed, 'tok_a', 'src_two');
    expect(conflict.ownership['tok_a']).toBe('src_one');
  });

  it('mintToken assigns the generated id', () => {
    const gen = createSequentialTokenIdGenerator();
    const { store, tokenId } = mintToken(
      createTokenStore(),
      makeToken({ path: ['x'] }) as never,
      gen,
    );
    expect(tokenId).toBe('tok_test-1');
    expect(store.tokens[tokenId]).toBeDefined();
  });

  it('base snapshots are stored per source', () => {
    const store = setBaseSnapshot(createTokenStore(), {
      sourceId: 'src_one',
      schemaVersion: 1,
      semanticHash: 'h1',
      revision: 'base-1',
      capturedAt: '2026-08-05T00:00:00.000Z',
      tokenHashes: { tok_a: 'sha-a' },
    });
    expect(store.bases['src_one']?.revision).toBe('base-1');
  });

  it('revisions are monotonic across mutations', () => {
    const store = createTokenStore();
    const first = addToken(store, makeToken({ id: 'tok_a' }) as never);
    expect(first.store.nextRevision).toBe('r2');
    const second = updateToken(first.store, 'tok_a', { description: 'x' });
    expect(second.store.nextRevision).toBe('r3');
  });
});

describe('variable bridge', () => {
  it('bindVariableToToken links one variable to one token', () => {
    const { store } = addToken(createTokenStore(), makeToken({ id: 'tok_a' }) as never);
    const linked = bindVariableToToken(store, 'var-1', 'tok_a');
    expect(tokenForVariable(linked, 'var-1')?.id).toBe('tok_a');
    expect(isSynchronizedVariable(linked, 'var-1')).toBe(true);
    expect(isSynchronizedVariable(linked, 'var-2')).toBe(false);
  });

  it('linkVariable is a no-op for missing tokens', () => {
    const store = linkVariable(createTokenStore(), 'var-1', 'tok_missing');
    expect(store.variableLinks['var-1']).toBeUndefined();
  });

  it('detachTokenRecord removes provenance and marks detached', () => {
    const token = makeToken({
      id: 'tok_a',
      source: {
        sourceId: 'src_one',
        sourceFileId: 'f',
        sourcePointer: '/x',
        adapterId: 'dtcg',
        specificationVersion: '2025.10',
      },
    });
    const detached = detachTokenRecord(token as never);
    expect(detached.source).toBeUndefined();
    expect(detached.localState.detachedFromSource).toBe(true);
  });

  it('stableVarveId reads and writes the org.varve namespace', () => {
    expect(stableVarveId({})).toBeUndefined();
    expect(stableVarveId({ 'org.varve': { id: 'tok_x' } })).toBe('tok_x');
  });
});

describe('persistence', () => {
  it('tokenSync survives serialize → decode round trip', () => {
    const doc = createDocument();
    const tokenSync = createEmptyTokenSynchronization();
    const { store } = addToken(tokenSync.store, makeToken({ id: 'tok_roundtrip' }) as never);
    const withSync = {
      ...doc,
      variableStore: { ...createVariableStore(), tokenSync: { ...tokenSync, store } },
    };
    const json = serializeDocument(withSync);
    const decoded = DocumentCodec.decode(json);
    expect(decoded.ok).toBe(true);
    const roundTripped = (decoded as { document: { variableStore: { tokenSync?: unknown } } })
      .document.variableStore.tokenSync;
    expect(roundTripped).toEqual({ ...tokenSync, store });
  });

  it('mergeVariableStores keeps base tokenSync when both sides differ', () => {
    const base = createVariableStore();
    const source = createVariableStore();
    base.tokenSync = createEmptyTokenSynchronization();
    source.tokenSync = createEmptyTokenSynchronization();
    base.tokenSync.store.nextRevision = 'r1';
    source.tokenSync.store.nextRevision = 'r9';
    const merged = mergeVariableStores(base, source);
    expect(merged.tokenSync?.store.nextRevision).toBe('r1');
  });

  it('mergeVariableStores carries tokenSync from whichever side has it', () => {
    const base = createVariableStore();
    const source = createVariableStore();
    source.tokenSync = createEmptyTokenSynchronization();
    expect(mergeVariableStores(base, source).tokenSync).toBeDefined();
    expect(mergeVariableStores(source, base).tokenSync).toBeDefined();
  });

  it('sources round trip through the codec', () => {
    const doc = createDocument();
    const tokenSync = createEmptyTokenSynchronization();
    const withSource = addSource(tokenSync.store, {
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
      syncState: { status: 'clean' },
    });
    const withSync = {
      ...doc,
      variableStore: { ...createVariableStore(), tokenSync: { ...tokenSync, store: withSource } },
    };
    const decoded = DocumentCodec.decode(serializeDocument(withSync));
    const store = (
      decoded as {
        document: { variableStore: { tokenSync: { store: { sources: Record<string, unknown> } } } };
      }
    ).document.variableStore.tokenSync.store;
    expect(store.sources['src_one']?.name).toBe('Brand tokens');
    expect(store.sources['src_one']?.syncState.status).toBe('clean');
  });
});
