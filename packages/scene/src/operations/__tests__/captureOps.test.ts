/**
 * document.transaction-capture tests (M7 bridge capture op) — scene side.
 *
 * Validation and apply semantics live with the operation registry. Round-trip
 * properties (diff → capture → replay reproduces the target hash) live in
 * `packages/history` where the differ is available.
 */

import type { CapturedChange, Document, TransactionCapturePayload } from '@varve/scene';
import {
  addChild,
  canonicalHash,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
  summarizeOperation,
  validatePayload,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';

registerBuiltinOperations();

function baseDoc(): Document {
  const doc = {
    ...createDocument('capture-fixture', { flat: true }),
    id: 'capture-fixture-doc',
  } as Document;
  const a = makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const b = makeShapeNode('n2_bbbb', { kind: 'rect', x: 20, y: 0, w: 10, h: 10 });
  return addChild(addChild(doc, a.id, a), b.id, b);
}

function change(partial: Partial<CapturedChange> = {}): CapturedChange {
  return {
    changeType: 'modified',
    entityId: 'n1_aaaa',
    entityType: 'node',
    propertyPath: 'nodes.n1_aaaa.opacity',
    before: 1,
    after: 0.5,
    summary: 'opacity changed',
    ...partial,
  };
}

function payload(partial: Partial<TransactionCapturePayload> = {}): TransactionCapturePayload {
  return {
    transactionId: 'tx-1',
    changes: [change()],
    summary: { label: 'Set opacity', kind: 'modify', affectedEntityIds: ['n1_aaaa'] },
    beforeHash: canonicalHash(baseDoc()),
    afterHash: 'a'.repeat(64),
    ...partial,
  };
}

describe('document.transaction-capture validation', () => {
  it('accepts a well-formed payload', () => {
    expect(validatePayload('document.transaction-capture', payload()).ok).toBe(true);
  });

  it('rejects prototype-chain path segments', () => {
    const result = validatePayload('document.transaction-capture', {
      ...payload(),
      changes: [change({ propertyPath: 'nodes.n1_aaaa.__proto__.polluted' })],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/proto/i);
  });

  it('rejects constructor and prototype segments', () => {
    for (const segment of ['constructor', 'prototype']) {
      const result = validatePayload('document.transaction-capture', {
        ...payload(),
        changes: [change({ propertyPath: `nodes.n1_aaaa.${segment}.x` })],
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects non-finite numbers in before/after values', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = validatePayload('document.transaction-capture', {
        ...payload(),
        changes: [change({ after: bad })],
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects functions, symbols, and bigint values', () => {
    const badValues: unknown[] = [() => 1, Symbol('x'), 1n];
    for (const bad of badValues) {
      const result = validatePayload('document.transaction-capture', {
        ...payload(),
        changes: [change({ after: bad })],
      });
      expect(result.ok).toBe(false);
    }
  });

  it('rejects circular values', () => {
    const circular: Record<string, unknown> = { self: null };
    circular.self = circular;
    const result = validatePayload('document.transaction-capture', {
      ...payload(),
      changes: [change({ after: circular })],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects unknown change types, bad hashes, and empty change lists', () => {
    expect(
      validatePayload('document.transaction-capture', {
        ...payload(),
        changes: [change({ changeType: 'explode' as CapturedChange['changeType'] })],
      }).ok,
    ).toBe(false);
    expect(validatePayload('document.transaction-capture', payload({ afterHash: 'zzz' })).ok).toBe(
      false,
    );
    expect(validatePayload('document.transaction-capture', payload({ changes: [] })).ok).toBe(
      false,
    );
    expect(validatePayload('document.transaction-capture', payload({ transactionId: '' })).ok).toBe(
      false,
    );
  });

  it('rejects invalid text ranges', () => {
    const result = validatePayload('document.transaction-capture', {
      ...payload(),
      changes: [
        change({
          changeType: 'text',
          textRanges: { baseStart: 5, baseEnd: 2, targetStart: 0, targetEnd: 1 },
        }),
      ],
    });
    expect(result.ok).toBe(false);
  });

  it('summarizes with the captured step label', () => {
    const summary = summarizeOperation('document.transaction-capture', payload());
    expect(summary.label).toBe('Set opacity');
    expect(summary.kind).toBe('modify');
    expect(summary.affectedEntityIds).toEqual(['n1_aaaa']);
  });
});
