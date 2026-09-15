/**
 * Shared fixtures for history tests: document + operation recording.
 *
 * The genesis node.create is part of the migration snapshot only (never the
 * log); record() returns single-operation lists so each transaction applies
 * exactly the ops appended since the previous commit.
 */

import type { Document } from '@varve/scene';
import {
  affectedEntitiesOf,
  applyOperation,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import type { StoredOperation } from '../types';

registerBuiltinOperations();

export const FIXTURE_DOC_ID = 'golden-history-doc-0001';
export const FIXTURE_NODE_ID = 'n1_aaaa';

export interface OpsRecorder {
  document: Document;
  operations: StoredOperation[];
}

/** Start a fresh pinned-id document with one rect node and an empty recorder. */
export function startDoc(): { document: Document; recorder: OpsRecorder } {
  const doc = {
    ...createDocument('history-fixture', { flat: true }),
    id: FIXTURE_DOC_ID,
  } as Document;
  const node = makeShapeNode(FIXTURE_NODE_ID, { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  const withNode = applyOperation(doc, 'node.create', { node });
  return {
    document: withNode,
    recorder: { document: withNode, operations: [] },
  };
}

/** Apply an op through the registry and return a single-op recorder. */
export function record(
  recorder: OpsRecorder,
  type: string,
  payload: unknown,
  nextSequence: number,
  operationId = `op-${nextSequence}`,
): OpsRecorder {
  const next = applyOperation(recorder.document, type, payload);
  return {
    document: next,
    operations: [
      {
        operationId,
        operationType: type,
        schemaVersion: 1,
        logicalSequence: nextSequence,
        affectedEntityIds: affectedEntitiesOf(type, payload),
        payload,
      },
    ],
  };
}

export { applyOperation, createDocument };
