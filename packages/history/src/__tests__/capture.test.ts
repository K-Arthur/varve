/**
 * Capture round-trip property (M7): diffDocuments(before, after) → capture
 * op payload → apply over `before` must reproduce `after` byte-for-byte
 * (canonical SHA-256 equality). This is the invariant replayAndVerify
 * depends on for editor transactions recorded through the capture bridge.
 */

import type { Document } from '@varve/scene';
import {
  addChild,
  applyOperation,
  canonicalHash,
  canonicalHistoryHash,
  createDocument,
  createVariableStore,
  makeShapeNode,
  makeTableNode,
  moveNode,
  registerBuiltinOperations,
  removeNode,
  type TransactionCapturePayload,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../diff';

registerBuiltinOperations();

const CAPTURE_TYPE = 'document.transaction-capture';

function patch(doc: Document, nodeId: string, path: string, value: unknown): Document {
  return applyOperation(doc, 'node.patch', { nodeId, path, value });
}

function baseDoc(): Document {
  const doc = {
    ...createDocument('capture-roundtrip', { flat: true }),
    id: 'capture-roundtrip-doc',
  } as Document;
  const a = makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const b = makeShapeNode('n2_bbbb', { kind: 'rect', x: 20, y: 0, w: 10, h: 10 });
  const c = makeShapeNode('n3_cccc', { kind: 'rect', x: 40, y: 0, w: 10, h: 10 });
  const withC = addChild(addChild(doc, a.id, a), b.id, b);
  return addChild(withC, c.id, c);
}

function capture(before: Document, after: Document, label = 'Edit'): TransactionCapturePayload {
  const diff = diffDocuments(before, after);
  return {
    transactionId: 'tx-roundtrip',
    changes: diff.changes,
    summary: { label, kind: 'modify', affectedEntityIds: [] },
    beforeHash: diff.baseHash,
    afterHash: diff.targetHash,
  };
}

function replay(before: Document, payload: TransactionCapturePayload): Document {
  return applyOperation(before, CAPTURE_TYPE, payload);
}

function expectRoundTrip(before: Document, after: Document): void {
  const payload = capture(before, after);
  const replayed = replay(before, payload);
  expect(canonicalHash(replayed)).toBe(canonicalHash(after));
  expect(canonicalHistoryHash(replayed)).toBe(payload.afterHash);
}

describe('capture round-trip', () => {
  it('scalar property edit', () => {
    expectRoundTrip(baseDoc(), patch(baseDoc(), 'n1_aaaa', 'opacity', 0.5));
  });

  it('rename and move of existing nodes', () => {
    let doc = baseDoc();
    doc = patch(doc, 'n2_bbbb', 'name', 'B2');
    doc = moveNode(doc, 'n3_cccc', 1);
    expectRoundTrip(baseDoc(), doc);
  });

  it('node add, delete, and reorder combined', () => {
    let doc = baseDoc();
    const d = makeShapeNode('n4_dddd', { kind: 'rect', x: 60, y: 0, w: 10, h: 10 });
    doc = addChild(doc, doc.id, d);
    doc = moveNode(doc, 'n4_dddd', 1);
    doc = removeNode(doc, 'n3_cccc');
    expectRoundTrip(baseDoc(), doc);
  });

  it('text edits across multiple keystroke-style steps', () => {
    let doc = baseDoc();
    doc = patch(doc, 'n1_aaaa', 'text', 'H');
    doc = patch(doc, 'n1_aaaa', 'text', 'He');
    doc = patch(doc, 'n1_aaaa', 'text', 'Hello');
    doc = patch(doc, 'n1_aaaa', 'text', 'Hello Varve');
    doc = patch(doc, 'n1_aaaa', 'text', 'Hello Varve!');
    doc = patch(doc, 'n1_aaaa', 'text', 'Hello Varve');
    expectRoundTrip(baseDoc(), doc);
  });

  it('cascading sequential captures replay deterministically', () => {
    let doc = baseDoc();
    let replayed = baseDoc();
    const steps: Array<{ before: Document; after: Document }> = [];
    for (let i = 0; i < 20; i++) {
      const next = patch(doc, 'n1_aaaa', 'opacity', 0.05 * i);
      steps.push({ before: doc, after: next });
      doc = next;
    }
    for (const step of steps) {
      replayed = replay(replayed, capture(step.before, step.after, `step ${step.after}`));
    }
    expect(canonicalHash(replayed)).toBe(canonicalHash(doc));
  });

  it('identical documents produce no changes and equal hashes', () => {
    const doc = baseDoc();
    const diff = diffDocuments(doc, doc);
    expect(diff.changed).toBe(false);
    expect(diff.changes).toHaveLength(0);
  });

  it('adds an optional variable store when replaying over a legacy document', () => {
    const before = baseDoc();
    const after: Document = { ...before, variableStore: createVariableStore() };
    after.variableStore!.variables.v_0001 = {
      id: 'v_0001',
      name: 'Brand',
      type: 'color',
      valuesByMode: { default: '#39d0c6' },
    };
    expectRoundTrip(before, after);
  });

  it('removes an optional variable store without leaving an undefined property', () => {
    const before: Document = { ...baseDoc(), variableStore: createVariableStore() };
    before.variableStore!.variables.v_0001 = {
      id: 'v_0001',
      name: 'Brand',
      type: 'color',
      valuesByMode: { default: '#39d0c6' },
    };
    const after: Document = { ...before };
    delete after.variableStore;
    expectRoundTrip(before, after);
  });

  it('replays a table node addition with its nested model intact', () => {
    const before = baseDoc();
    const table = makeTableNode('table_aaaa', { rows: 4, columns: 4 });
    const after = addChild(before, table.id, table);
    expectRoundTrip(before, after);
  });
});
