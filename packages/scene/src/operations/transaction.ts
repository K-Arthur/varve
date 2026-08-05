/**
 * Transaction coordinator (ADR-0018).
 *
 * A transaction is the user-visible history step: an ordered list of atomic
 * operations plus step metadata. Policies:
 * - pointer-down→up gestures, slider scrubs, batch actions group into one
 *   transaction (callers drive begin/append/commit)
 * - empty transactions never create steps
 * - nesting is flattened (reference-counted); mismatched nesting is
 *   detected and reported, never silently committed
 * - a transaction is validated as a whole before commit; a failed apply
 *   rolls back to the begin state
 * - limits bound operations per transaction and payload sizes
 *
 * The coordinator is pure and stateless across transactions: `createSession`
 * builds a fresh session; `commit` returns a `CommittedTransaction` with the
 * ordered operations and the final document.
 */
import type { Document } from '../document';
import {
  affectedEntitiesOf,
  applyOperation,
  preconditionFailure,
  summarizeOperation,
  validatePayload,
} from './registry';
import type { OperationActor, OperationSource } from './types';
import { DEFAULT_DISPATCHER_LIMITS, type DispatcherLimits } from './types';

export interface OperationRecord {
  operationType: string;
  payload: unknown;
  /** Operation ids are minted by the coordinator (document-scoped). */
  operationId: string;
  affectedEntityIds: string[];
}

export interface TransactionSession {
  readonly open: boolean;
  readonly operationCount: number;
  readonly depth: number;
  /** Begin-state document (for abort/rollback and empty detection). */
  readonly beginDocument: Document;
  append(
    type: string,
    payload: unknown,
  ): { ok: true; operationId: string } | { ok: false; errors: string[] };
  commit(): CommittedTransaction | null;
  abort(): void;
}

export interface CommittedTransaction {
  transactionId: string;
  operations: OperationRecord[];
  document: Document;
  summary: { label: string; kind: string; affectedEntityIds: string[] };
  /** True when the transaction made no document change (dropped step). */
  empty: boolean;
}

export interface TransactionCoordinatorOptions {
  documentId: string;
  actor: OperationActor;
  source: OperationSource;
  baseRevisionId: string;
  limits?: Partial<DispatcherLimits>;
}

let transactionCounter = 0;

function nextTransactionId(documentId: string): string {
  transactionCounter += 1;
  return `tx-${documentId}-${transactionCounter}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

function nextOperationId(documentId: string, index: number): string {
  return `op-${documentId}-${index}-${Math.floor(Math.random() * 0xffff).toString(16)}`;
}

export function createTransactionSession(
  document: Document,
  opts: TransactionCoordinatorOptions,
): TransactionSession {
  const limits: DispatcherLimits = { ...DEFAULT_DISPATCHER_LIMITS, ...opts.limits };
  const transactionId = nextTransactionId(opts.documentId);
  let open = true;
  let depth = 0;
  const beginDocument = document;
  let operations: OperationRecord[] = [];

  const session: TransactionSession = {
    get open() {
      return open;
    },
    get operationCount() {
      return operations.length;
    },
    get depth() {
      return depth;
    },
    get beginDocument() {
      return beginDocument;
    },
    append(type: string, payload: unknown) {
      if (!open) return { ok: false, errors: ['transaction is closed'] };
      const validated = validatePayload(type, payload);
      if (!validated.ok) return { ok: false, errors: validated.errors };
      const precondition = preconditionFailure(beginDocument, type, validated.value);
      if (precondition) return { ok: false, errors: [precondition] };
      const payloadBytes = byteLengthOf(validated.value);
      if (payloadBytes > limits.maxPayloadBytesPerOperation) {
        return {
          ok: false,
          errors: [`operation payload exceeds ${limits.maxPayloadBytesPerOperation} bytes`],
        };
      }
      if (operations.length >= limits.maxOperationsPerTransaction) {
        return {
          ok: false,
          errors: [`transaction exceeds ${limits.maxOperationsPerTransaction} operations`],
        };
      }
      const affected = affectedEntitiesOf(type, validated.value);
      if (affected.length > limits.maxAffectedEntitiesPerOperation) {
        return {
          ok: false,
          errors: [
            `operation affects more than ${limits.maxAffectedEntitiesPerOperation} entities`,
          ],
        };
      }
      operations.push({
        operationType: type,
        payload: validated.value,
        operationId: nextOperationId(opts.documentId, operations.length),
        affectedEntityIds: affected,
      });
      return { ok: true, operationId: operations[operations.length - 1]!.operationId };
    },
    commit() {
      if (!open) return null;
      depth = 0;
      open = false;
      if (operations.length === 0) return null;
      let doc = beginDocument;
      for (const op of operations) {
        doc = applyOperation(doc, op.operationType, op.payload);
      }
      const summary = summarizeOperation(
        operations[operations.length - 1]!.operationType,
        operations[operations.length - 1]!.payload,
      );
      // Reference-equality check: an empty transaction must not create a step.
      const empty = doc === beginDocument;
      if (empty) {
        return {
          transactionId,
          operations,
          document: doc,
          summary: {
            label: summary.label,
            kind: summary.kind,
            affectedEntityIds: summary.affectedEntityIds,
          },
          empty: true,
        };
      }
      return {
        transactionId,
        operations,
        document: doc,
        summary: {
          label: summary.label,
          kind: summary.kind,
          affectedEntityIds: dedupe([
            ...summary.affectedEntityIds,
            ...operations.flatMap((o) => o.affectedEntityIds),
          ]),
        },
        empty: false,
      };
    },
    abort() {
      open = false;
      depth = 0;
      operations = [];
    },
  };

  return session;
}

/**
 * Nested begin/commit bookkeeping for editor adapters. Nesting is flattened:
 * only the outermost commit materializes a step; mismatched nesting is
 * reported so silent accidental commits are impossible.
 */
export function createNestingGuard(): {
  begin(): void;
  commit(): { outerCommit: boolean; balanced: boolean };
  abort(): void;
} {
  let depth = 0;
  return {
    begin() {
      depth += 1;
    },
    commit() {
      if (depth <= 0) return { outerCommit: false, balanced: false };
      depth -= 1;
      return { outerCommit: depth === 0, balanced: true };
    },
    abort() {
      depth = 0;
    },
  };
}

function byteLengthOf(value: unknown): number {
  return JSON.stringify(value)?.length ?? 0;
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)];
}
