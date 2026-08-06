/**
 * Persistent history core types (ADR-0020/0022/0023).
 *
 * - A revision is an immutable record in a DAG: zero parents (genesis),
 *   one parent (normal transaction), or exactly two parents (merge).
 * - A branch is a named movable reference to a revision head.
 * - A checkpoint is a named reference to an immutable revision.
 * - Log positions index into the append-only operation segments.
 * - Timestamps are metadata only — they never determine ordering or hashing.
 */
import type { SemanticSummary } from '@varve/scene';

export type RevisionOrigin =
  | 'edit'
  | 'undo'
  | 'redo'
  | 'revert'
  | 'save'
  | 'autosave'
  | 'checkpoint'
  | 'branch'
  | 'merge'
  | 'import'
  | 'migration'
  | 'recovery';

export interface RevisionAuthor {
  actorId: string;
  kind: 'local-user' | 'remote-user' | 'system' | 'migration' | 'import';
}

export interface LogPosition {
  segment: number;
  offset: number;
}

export interface RevisionRecord {
  revisionId: string;
  documentId: string;
  /** Zero for genesis/import roots, one for normal revisions, two for merges. */
  parentRevisionIds: string[];
  transactionId?: string;
  /** SHA-256 of the canonical document bytes (ADR-0021/0027). */
  canonicalDocumentHash: string;
  /** Content-addressed snapshot reference, when one exists. */
  snapshotId?: string;
  /** Inclusive log range that produced this revision (absent for imports). */
  operationStart?: LogPosition;
  operationEnd?: LogPosition;
  author: RevisionAuthor;
  semanticSummary: SemanticSummary;
  createdAt: number;
  schemaVersion: number;
  origin: RevisionOrigin;
}

export interface BranchRef {
  branchId: string;
  documentId: string;
  name: string;
  headRevisionId: string;
  createdFromRevisionId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'merged' | 'archived';
}

export interface CheckpointRef {
  checkpointId: string;
  documentId: string;
  revisionId: string;
  name: string;
  description?: string;
  pinned: boolean;
  createdAt: number;
}

/** A stored operation as it appears in an append-only segment. */
export interface StoredOperation {
  operationId: string;
  operationType: string;
  schemaVersion: number;
  /** Document-scoped logical sequence (the only ordering key). */
  logicalSequence: number;
  affectedEntityIds: string[];
  payload: unknown;
}

export interface RecoveryRef {
  recoveryId: string;
  documentId: string;
  revisionId: string;
  createdAt: number;
  note?: string;
}

/** Pinned document state for recovery bookkeeping. */
export interface DocumentManifest {
  documentId: string;
  nextLogicalSequence: number;
  nextSegmentIndex: number;
  lastCommittedRevisionId?: string;
}

export interface IntegrityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  /** Optional related ids for diagnostics. */
  subjectId?: string;
}

export interface TailRecoveryReport {
  documentId: string;
  /** Segment indexes dropped (corrupt tail and everything after). */
  truncatedSegments: number[];
  /** Number of operations dropped with the truncated tail. */
  discardedOperations: number;
  lastKnownGoodRevisionId?: string;
  /** Branch heads rewound to the last known good revision. */
  rewoundBranches: string[];
  warnings: string[];
}

export interface VerifyResult {
  revisionId: string;
  /** True when the canonical hash of the replayed document matches. */
  verified: boolean;
  replayedDocumentHash: string;
  expectedHash: string;
  /** Replay path: starting revision (genesis or nearest snapshot). */
  replayedFromRevisionId: string;
  appliedOperationCount: number;
}
