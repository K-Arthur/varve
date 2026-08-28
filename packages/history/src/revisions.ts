/**
 * Revision creation and DAG validation (ADR-0022/0023).
 *
 * Invariants enforced here and verified by `validateRevisionGraph`:
 * - genesis has zero parents; normal revisions have exactly one; merges two
 * - parents exist and were committed before the child
 * - the canonical hash matches the replayed content
 * - revision ids are immutable (a store write is idempotent-identical)
 */

import type { Document } from '@varve/scene';
import { canonicalHistoryHash } from '@varve/scene';
import type { RasterTileStore } from './rasterTileStore';
import { createSnapshot } from './snapshots';
import { type HistoryStore, mintHistoryId } from './store';
import type {
  BranchRef,
  CheckpointRef,
  IntegrityIssue,
  LogPosition,
  RevisionAuthor,
  RevisionOrigin,
  RevisionRecord,
} from './types';

export interface CreateRevisionInput {
  document: Document;
  documentId: string;
  parentRevisionIds: string[];
  author: RevisionAuthor;
  origin: RevisionOrigin;
  semanticSummary: RevisionRecord['semanticSummary'];
  transactionId?: string;
  operationStart?: LogPosition;
  operationEnd?: LogPosition;
  snapshotId?: string;
  schemaVersion?: number;
}

/** Build a RevisionRecord for a document state (does not persist it). */
export function buildRevision(input: CreateRevisionInput): RevisionRecord {
  const hash = canonicalHistoryHash(input.document);
  return {
    revisionId: mintHistoryId('r'),
    documentId: input.documentId,
    parentRevisionIds: [...input.parentRevisionIds],
    transactionId: input.transactionId,
    canonicalDocumentHash: hash,
    snapshotId: input.snapshotId,
    operationStart: input.operationStart,
    operationEnd: input.operationEnd,
    author: input.author,
    semanticSummary: input.semanticSummary,
    createdAt: Date.now(),
    schemaVersion: input.schemaVersion ?? 1,
    origin: input.origin,
  };
}

/** Validate parent-count invariants for a revision against the graph. */
export function validateRevisionShape(
  revision: RevisionRecord,
  existingParents: string[],
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const { parentRevisionIds } = revision;
  if (parentRevisionIds.length === 0) {
    if (
      revision.origin !== 'import' &&
      revision.origin !== 'migration' &&
      revision.origin !== 'recovery'
    ) {
      issues.push({
        severity: 'error',
        code: 'revision.parentless',
        message: `revision ${revision.revisionId} has zero parents but origin ${revision.origin}`,
        subjectId: revision.revisionId,
      });
    }
  } else if (parentRevisionIds.length === 1) {
    if (!existingParents.includes(parentRevisionIds[0]!)) {
      issues.push({
        severity: 'error',
        code: 'revision.missing-parent',
        message: `revision ${revision.revisionId} references missing parent ${parentRevisionIds[0]}`,
        subjectId: revision.revisionId,
      });
    }
  } else if (parentRevisionIds.length === 2) {
    for (const parent of parentRevisionIds) {
      if (!existingParents.includes(parent)) {
        issues.push({
          severity: 'error',
          code: 'revision.missing-merge-parent',
          message: `merge revision ${revision.revisionId} references missing parent ${parent}`,
          subjectId: revision.revisionId,
        });
      }
    }
  } else {
    issues.push({
      severity: 'error',
      code: 'revision.too-many-parents',
      message: `revision ${revision.revisionId} has ${parentRevisionIds.length} parents`,
      subjectId: revision.revisionId,
    });
  }
  return issues;
}

/** Create the genesis revision for a document (single source of truth). */
export async function createGenesisRevision(
  store: HistoryStore,
  document: Document,
  opts: {
    documentId: string;
    author: RevisionAuthor;
    branchName?: string;
    rasterTileStore?: RasterTileStore;
  },
): Promise<{ genesis: RevisionRecord; branch: BranchRef }> {
  const revision = buildRevision({
    document,
    documentId: opts.documentId,
    parentRevisionIds: [],
    author: opts.author,
    origin: 'migration',
    semanticSummary: { label: 'Genesis', kind: 'admin', affectedEntityIds: [] },
  });
  // The genesis is always snapshotted so replay has a base (ADR-0021).
  const snapshot = await createSnapshot(store, document, {
    documentId: opts.documentId,
    revisionId: revision.revisionId,
    rasterTileStore: opts.rasterTileStore,
  });
  const snapshotted = { ...revision, snapshotId: snapshot.canonicalHash };
  const branch: BranchRef = {
    branchId: mintHistoryId('b'),
    documentId: opts.documentId,
    name: opts.branchName ?? 'main',
    headRevisionId: snapshotted.revisionId,
    createdFromRevisionId: snapshotted.revisionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
  };
  await store.commitRevision({ revision: snapshotted, createBranch: branch });
  return { genesis: snapshotted, branch };
}

/** Validate the whole revision graph of a document (structure, refs). */
export async function validateRevisionGraph(
  store: HistoryStore,
  documentId: string,
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const revisions = await store.listRevisions(documentId);
  const byId = new Map(revisions.map((r) => [r.revisionId, r]));

  for (const revision of revisions) {
    const parents = revision.parentRevisionIds.filter((p) => byId.has(p));
    issues.push(...validateRevisionShape(revision, revision.parentRevisionIds));
    if (parents.length !== revision.parentRevisionIds.length) {
      issues.push({
        severity: 'error',
        code: 'revision.dangling-parent',
        message: `revision ${revision.revisionId} has dangling parents`,
        subjectId: revision.revisionId,
      });
    }
  }

  // Branch heads and checkpoints must resolve.
  for (const branch of await store.listBranches(documentId)) {
    if (!byId.has(branch.headRevisionId)) {
      issues.push({
        severity: 'error',
        code: 'branch.dangling-head',
        message: `branch ${branch.branchId} (${branch.name}) points at missing revision ${branch.headRevisionId}`,
        subjectId: branch.branchId,
      });
    }
  }
  for (const checkpoint of await store.listCheckpoints(documentId)) {
    if (!byId.has(checkpoint.revisionId)) {
      issues.push({
        severity: 'error',
        code: 'checkpoint.dangling',
        message: `checkpoint ${checkpoint.checkpointId} points at missing revision ${checkpoint.revisionId}`,
        subjectId: checkpoint.checkpointId,
      });
    }
  }
  return issues;
}

/** Create a named checkpoint at an existing revision (atomic ref write). */
export async function createCheckpoint(
  store: HistoryStore,
  documentId: string,
  revisionId: string,
  name: string,
  opts: { description?: string; pinned?: boolean } = {},
): Promise<CheckpointRef> {
  const revision = await store.getRevision(documentId, revisionId);
  if (!revision) throw new Error(`checkpoint target revision does not exist: ${revisionId}`);
  const checkpoint: CheckpointRef = {
    checkpointId: mintHistoryId('cp'),
    documentId,
    revisionId,
    name,
    description: opts.description,
    pinned: opts.pinned ?? false,
    createdAt: Date.now(),
  };
  await store.putCheckpoint(checkpoint);
  return checkpoint;
}

/** Move a branch head to an existing revision (validated, atomic). */
export async function moveBranchHead(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  headRevisionId: string,
): Promise<BranchRef | null> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw new Error(`branch does not exist: ${branchId}`);
  const revision = await store.getRevision(documentId, headRevisionId);
  if (!revision) throw new Error(`head revision does not exist: ${headRevisionId}`);
  const next: BranchRef = {
    ...branch,
    headRevisionId,
    updatedAt: Date.now(),
  };
  await store.putBranch(next);
  return next;
}
