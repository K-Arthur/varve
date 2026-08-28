/**
 * Deterministic replay (ADR-0021/0022).
 *
 * Replay starts from the nearest snapshotted ancestor (or the genesis
 * snapshot) and applies stored operations in logical-sequence order over the
 * half-open range `(base.operationEnd, revision.operationEnd]`. The result
 * is canonicalized and compared to the revision's recorded hash. Timestamps
 * never influence replay.
 */

import type { Document } from '@varve/scene';
import { applyOperation, canonicalHistoryHash, hasOperation } from '@varve/scene';
import { verifySegmentChecksum } from './log';
import { applyRasterDelta, RASTER_DELTA_OPERATION, type RasterDeltaPayload } from './rasterDelta';
import { createRasterTileStore, type RasterTileStore } from './rasterTileStore';
import { snapshotToDocument } from './snapshots';
import type { HistoryStore } from './store';
import type { LogPosition, RevisionRecord, StoredOperation, VerifyResult } from './types';

export class ReplayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Apply stored operations to a base document (pure, logical-sequence order). */
export function applyStoredOperations(base: Document, operations: StoredOperation[]): Document {
  let doc = base;
  for (const op of operations) {
    if (op.operationType === RASTER_DELTA_OPERATION) {
      throw new ReplayError(
        'replay.raster-tile-store-required',
        'raster delta replay requires the asynchronous tile-store path',
      );
    }
    if (!hasOperation(op.operationType)) {
      throw new ReplayError(
        'replay.unknown-operation',
        `unknown operation type: ${op.operationType}`,
      );
    }
    doc = applyOperation(doc, op.operationType, op.payload);
  }
  return doc;
}

/**
 * Apply stored operations with exact raster content resolution. Raster deltas
 * are deliberately resolved from immutable committed blobs, never by invoking
 * the current brush, eraser, or filter algorithm.
 */
export async function applyStoredOperationsAsync(
  base: Document,
  operations: StoredOperation[],
  tileStore: RasterTileStore = createRasterTileStore(),
): Promise<Document> {
  let doc = base;
  for (const op of operations) {
    if (op.operationType === RASTER_DELTA_OPERATION) {
      try {
        doc = await applyRasterDelta(doc, op.payload as RasterDeltaPayload, tileStore, 'after');
      } catch (error) {
        throw new ReplayError('replay.raster-delta-failed', String(error));
      }
      continue;
    }
    if (!hasOperation(op.operationType)) {
      throw new ReplayError(
        'replay.unknown-operation',
        `unknown operation type: ${op.operationType}`,
      );
    }
    doc = applyOperation(doc, op.operationType, op.payload);
  }
  return doc;
}

/** Canonical hash of a document (replay verification input). */
export function hashOf(document: Document): string {
  return canonicalHistoryHash(document);
}

/** Position just after `position` (exclusive start for ranges). */
export function positionAfter(position: LogPosition | undefined): LogPosition {
  if (!position) return { segment: 0, offset: 0 };
  return { segment: position.segment, offset: position.offset + 1 };
}

/** Position just before `position` (exclusive end for ranges). */
export function positionBefore(position: LogPosition | undefined): LogPosition {
  if (!position) return { segment: 0, offset: 0 };
  return { segment: position.segment, offset: Math.max(0, position.offset) };
}

interface ReplayBase {
  baseRevisionId: string;
  baseRevision: RevisionRecord;
}

/**
 * Walk a revision's ancestry to the nearest snapshotted revision.
 * Genesis is always snapshotted (createGenesisRevision guarantees it).
 */
export async function findReplayBase(
  store: HistoryStore,
  documentId: string,
  revision: RevisionRecord,
): Promise<ReplayBase> {
  let current = revision;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(current.revisionId)) {
      throw new ReplayError('replay.cycle', `revision cycle detected at ${current.revisionId}`);
    }
    visited.add(current.revisionId);
    if (current.snapshotId) {
      return { baseRevisionId: current.revisionId, baseRevision: current };
    }
    if (current.parentRevisionIds.length === 0) {
      throw new ReplayError(
        'replay.unsnapshotted-genesis',
        `genesis ${current.revisionId} has no snapshot; replay base unavailable`,
      );
    }
    const parent = await store.getRevision(documentId, current.parentRevisionIds[0]!);
    if (!parent) {
      throw new ReplayError('replay.missing-parent', `parent of ${current.revisionId} missing`);
    }
    current = parent;
  }
}

/**
 * Replay a revision from its nearest snapshotted ancestor and verify the
 * recorded canonical hash. Throws ReplayError on structural problems;
 * returns `verified: false` on hash mismatch.
 */
export async function replayAndVerify(
  store: HistoryStore,
  documentId: string,
  revisionId: string,
  tileStore: RasterTileStore = createRasterTileStore(),
): Promise<VerifyResult> {
  const revision = await store.getRevision(documentId, revisionId);
  if (!revision) throw new ReplayError('replay.missing-revision', `revision ${revisionId} missing`);

  const { baseRevision } = await findReplayBase(store, documentId, revision);
  const snapshot = baseRevision.snapshotId
    ? await store.getSnapshot(documentId, baseRevision.snapshotId)
    : null;
  if (!snapshot) {
    throw new ReplayError(
      'replay.missing-snapshot',
      `snapshot for ${baseRevision.revisionId} missing`,
    );
  }
  const document = snapshotToDocument(snapshot);

  const start = positionAfter(baseRevision.operationEnd);
  const end = positionBefore(revision.operationEnd);
  const ops = await store.readOperations(documentId, start, end);
  const replayed = await applyStoredOperationsAsync(document, ops, tileStore);

  const actual = hashOf(replayed);
  return {
    revisionId,
    verified: actual === revision.canonicalDocumentHash,
    replayedDocumentHash: actual,
    expectedHash: revision.canonicalDocumentHash,
    replayedFromRevisionId: baseRevision.revisionId,
    appliedOperationCount: ops.length,
  };
}

/** Verify all segments of a document (checksums + contiguity). */
export async function verifySegments(store: HistoryStore, documentId: string): Promise<string[]> {
  const problems: string[] = [];
  const segments = await store.listSegments(documentId);
  for (const segment of segments) {
    const problem = verifySegmentChecksum(segment);
    if (problem) problems.push(problem);
  }
  return problems;
}

/** Load the live document at a revision by replaying (callers may cache). */
export async function loadDocumentAt(
  store: HistoryStore,
  documentId: string,
  revisionId: string,
  tileStore: RasterTileStore = createRasterTileStore(),
): Promise<Document> {
  const result = await replayAndVerify(store, documentId, revisionId, tileStore);
  if (!result.verified) {
    throw new ReplayError('replay.hash-mismatch', `revision ${revisionId} hash mismatch`);
  }
  return replayToDocument(store, documentId, revisionId, tileStore);
}

/** Replay to a document WITHOUT hash verification (fast path). */
export async function replayToDocument(
  store: HistoryStore,
  documentId: string,
  revisionId: string,
  tileStore: RasterTileStore = createRasterTileStore(),
): Promise<Document> {
  const revision = await store.getRevision(documentId, revisionId);
  if (!revision) throw new ReplayError('replay.missing-revision', `revision ${revisionId} missing`);
  const { baseRevision } = await findReplayBase(store, documentId, revision);
  const snapshot = baseRevision.snapshotId
    ? await store.getSnapshot(documentId, baseRevision.snapshotId)
    : null;
  if (!snapshot) throw new ReplayError('replay.missing-snapshot', `snapshot missing`);
  const document = snapshotToDocument(snapshot);
  const ops = await store.readOperations(
    documentId,
    positionAfter(baseRevision.operationEnd),
    positionBefore(revision.operationEnd),
  );
  return applyStoredOperationsAsync(document, ops, tileStore);
}
