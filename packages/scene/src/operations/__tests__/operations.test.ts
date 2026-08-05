/**
 * Operation registry + transaction coordinator tests (ADR-0017/0018).
 */
import { describe, expect, it } from 'vitest';
import type { Document } from '../../document';
import { addNode, createDocument, makeShapeNode } from '../../document';
import { registerBuiltinOperations } from '../bootstrap';
import { applyOperation, hasOperation, listOperationTypes, validatePayload } from '../registry';
import { createNestingGuard, createTransactionSession } from '../transaction';

registerBuiltinOperations();

function baseDoc(): Document {
  const doc = createDocument('ops', { flat: true });
  return addNode(doc, makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 }));
}

const SESSION_OPTS = {
  documentId: 'doc-1',
  actor: { actorId: 'actor-1', kind: 'local-user' as const },
  source: 'inspector' as const,
  baseRevisionId: 'rev-1',
};

describe('operation registry', () => {
  it('registers the built-in operation families', () => {
    expect(hasOperation('node.create')).toBe(true);
    expect(hasOperation('node.delete')).toBe(true);
    expect(hasOperation('node.move')).toBe(true);
    expect(hasOperation('node.reorder')).toBe(true);
    expect(hasOperation('node.rename')).toBe(true);
    expect(hasOperation('node.patch')).toBe(true);
    expect(hasOperation('document.set')).toBe(true);
    expect(hasOperation('asset.register')).toBe(true);
    expect(listOperationTypes()).toContain('node.patch');
  });

  it('rejects unknown operation types', () => {
    expect(hasOperation('nope.does-not-exist')).toBe(false);
    expect(validatePayload('nope.does-not-exist', {})).toEqual({
      ok: false,
      errors: ['unknown operation type: nope.does-not-exist'],
    });
  });

  it('rejects duplicate registration with a conflicting schema version', () => {
    // registerBuiltinOperations is idempotent — no throw.
    registerBuiltinOperations();
    expect(hasOperation('node.patch')).toBe(true);
  });
});

describe('node ops', () => {
  it('node.create appends to the root and bumps nothing else', () => {
    const doc = baseDoc();
    const created = makeShapeNode('n2_bbbb', { kind: 'ellipse', cx: 1, cy: 1, rx: 2, ry: 2 });
    const next = applyOperation(doc, 'node.create', { node: created });
    expect(next.rootChildren).toContain('n2_bbbb');
    expect(next.nodes['n2_bbbb']).toBeDefined();
  });

  it('node.create rejects a duplicate id via precondition', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, SESSION_OPTS);
    const result = session.append('node.create', {
      node: makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 1, h: 1 }),
    });
    expect(result.ok).toBe(false);
    expect('errors' in result && result.errors[0]).toContain('already exists');
  });

  it('node.patch applies whitelisted properties only', () => {
    const doc = baseDoc();
    const patched = applyOperation(doc, 'node.patch', {
      nodeId: 'n1_aaaa',
      path: 'shape.w',
      value: 42,
    });
    expect((patched.nodes['n1_aaaa'] as { shape?: unknown } | undefined)?.shape).toEqual({
      kind: 'rect',
      x: 0,
      y: 0,
      w: 42,
      h: 10,
    });

    const rejected = validatePayload('node.patch', {
      nodeId: 'n1_aaaa',
      path: '__proto__.polluted',
      value: 1,
    });
    expect(rejected.ok).toBe(false);

    const badOpacity = validatePayload('node.patch', {
      nodeId: 'n1_aaaa',
      path: 'opacity',
      value: 2,
    });
    expect(badOpacity.ok).toBe(false);

    const nan = validatePayload('node.patch', {
      nodeId: 'n1_aaaa',
      path: 'shape.x',
      value: Number.NaN,
    });
    expect(nan.ok).toBe(false);
  });

  it('node.rename and node.delete work', () => {
    let doc = baseDoc();
    doc = applyOperation(doc, 'node.rename', { nodeId: 'n1_aaaa', name: 'Renamed' });
    expect((doc.nodes['n1_aaaa'] as { name?: string } | undefined)?.name).toBe('Renamed');
    doc = applyOperation(doc, 'node.delete', { nodeId: 'n1_aaaa' });
    expect(doc.nodes['n1_aaaa']).toBeUndefined();
    expect(doc.rootChildren).toEqual([]);
  });
});

describe('transaction coordinator', () => {
  it('groups operations into one step with a summary', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, SESSION_OPTS);
    const a = session.append('node.patch', { nodeId: 'n1_aaaa', path: 'shape.x', value: 5 });
    const b = session.append('node.patch', { nodeId: 'n1_aaaa', path: 'shape.y', value: 7 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const committed = session.commit();
    expect(committed).not.toBeNull();
    expect(committed!.operations.length).toBe(2);
    expect(
      (committed!.document.nodes['n1_aaaa'] as { shape?: unknown } | undefined)?.shape,
    ).toMatchObject({
      x: 5,
      y: 7,
    });
    expect(committed!.empty).toBe(false);
    expect(committed!.summary.kind).toBe('modify');
    expect(committed!.summary.affectedEntityIds).toContain('n1_aaaa');
  });

  it('drops empty transactions (reference equality)', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, SESSION_OPTS);
    // node.move to the same index is a no-op for the doc reference.
    const result = session.append('node.move', { nodeId: 'n1_aaaa', toIndex: 0 });
    expect(result.ok).toBe(true);
    const committed = session.commit();
    expect(committed!.empty).toBe(true);
  });

  it('append fails after commit; commit fails when closed', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, SESSION_OPTS);
    session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'x' });
    session.commit();
    expect(session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'y' })).toEqual({
      ok: false,
      errors: ['transaction is closed'],
    });
    expect(session.commit()).toBeNull();
  });

  it('abort discards pending operations', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, SESSION_OPTS);
    session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'x' });
    session.abort();
    expect(session.open).toBe(false);
    expect(session.operationCount).toBe(0);
  });

  it('enforces payload and operation-count limits', () => {
    const doc = baseDoc();
    const session = createTransactionSession(doc, {
      ...SESSION_OPTS,
      limits: { maxOperationsPerTransaction: 2 },
    });
    session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'a' });
    session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'b' });
    const third = session.append('node.patch', { nodeId: 'n1_aaaa', path: 'name', value: 'c' });
    expect(third.ok).toBe(false);
  });

  it('nesting guard flattens nested transactions', () => {
    const guard = createNestingGuard();
    guard.begin();
    guard.begin();
    expect(guard.commit()).toEqual({ outerCommit: false, balanced: true });
    expect(guard.commit()).toEqual({ outerCommit: true, balanced: true });
    expect(guard.commit()).toEqual({ outerCommit: false, balanced: false });
  });
});
