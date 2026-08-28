/**
 * Tail recovery and integrity validation (ADR-0046).
 *
 * Recovery never points a branch at an incomplete revision:
 * 1. verify each segment's checksum; find the first corrupt segment
 * 2. truncate the corrupt segment and everything after it
 * 3. find the newest revision whose log range is fully inside the valid
 *    segments AND whose canonical hash replays correctly — last known good
 * 4. rewind any branch head past the last known good revision
 * 5. report exactly what was preserved and discarded
 */
import { verifySegmentChecksum } from './log';
import type { RasterTileStore } from './rasterTileStore';
import { replayAndVerify } from './replay';
import type { HistoryStore } from './store';
import type { IntegrityIssue, LogPosition, TailRecoveryReport } from './types';

/**
 * Recover a document's log tail. With `applyTruncation: true` the store's
 * segment list is replaced by the valid prefix and branch heads are rewound.
 */
export async function recoverTail(
  store: HistoryStore,
  documentId: string,
  opts: { applyTruncation?: boolean; rasterTileStore?: RasterTileStore } = {},
): Promise<TailRecoveryReport> {
  const segments = await store.listSegments(documentId);
  const report: TailRecoveryReport = {
    documentId,
    truncatedSegments: [],
    discardedOperations: 0,
    rewoundBranches: [],
    warnings: [],
  };

  // 1. Find the first invalid segment (checksum, version, or sequence gap).
  let firstBad = -1;
  for (let i = 0; i < segments.length; i++) {
    const problem = verifySegmentChecksum(segments[i]!);
    if (problem) {
      firstBad = i;
      report.warnings.push(`segment ${i}: ${problem}`);
      break;
    }
  }
  if (firstBad >= 0) {
    for (let i = firstBad; i < segments.length; i++) {
      report.truncatedSegments.push(i);
      report.discardedOperations += segments[i]!.operations.length;
    }
  }
  if (firstBad < 0) {
    return {
      ...report,
      lastKnownGoodRevisionId: await lastKnownGood(store, documentId, opts.rasterTileStore),
    };
  }

  const validSegments = segments.slice(0, firstBad);
  const lastValidEnd: LogPosition = validSegments.length
    ? {
        segment: validSegments.length - 1,
        offset: validSegments[validSegments.length - 1]!.operations.length,
      }
    : { segment: -1, offset: 0 };

  // 2. Find the newest revision fully inside the valid log with a verified hash.
  const revisions = (await store.listRevisions(documentId)).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  let lastGood: { revisionId: string; createdAt: number } | undefined;
  for (const revision of revisions) {
    const end = revision.operationEnd;
    if (!end) continue;
    if (end.segment > lastValidEnd.segment) continue;
    if (end.segment === lastValidEnd.segment && end.offset > lastValidEnd.offset) continue;
    try {
      const result = await replayAndVerify(
        store,
        documentId,
        revision.revisionId,
        opts.rasterTileStore,
      );
      if (result.verified) {
        lastGood = { revisionId: revision.revisionId, createdAt: revision.createdAt };
        break;
      }
      report.warnings.push(`revision ${revision.revisionId}: hash mismatch during recovery scan`);
    } catch {
      report.warnings.push(`revision ${revision.revisionId}: replay failed during recovery scan`);
    }
  }
  if (!lastGood) report.warnings.push('no valid revision found in the surviving log');
  else report.lastKnownGoodRevisionId = lastGood.revisionId;

  // 3. Rewind branch heads that point past the last known good revision.
  for (const branch of await store.listBranches(documentId)) {
    const head = await store.getRevision(documentId, branch.headRevisionId);
    const dangling = !head;
    const pastGood =
      lastGood !== undefined &&
      head !== null &&
      (head.createdAt > lastGood.createdAt ||
        (head.createdAt === lastGood.createdAt && head.revisionId !== lastGood.revisionId));
    if (dangling || pastGood) {
      if (opts.applyTruncation && lastGood) {
        await store.putBranch({
          ...branch,
          headRevisionId: lastGood.revisionId,
          updatedAt: Date.now(),
        });
      }
      report.rewoundBranches.push(branch.branchId);
    }
  }

  if (opts.applyTruncation) {
    await truncateSegments(store, documentId, firstBad);
  }
  return report;
}

/** Rewrite the store's segment list to the valid prefix (backend hook). */
async function truncateSegments(
  store: HistoryStore,
  documentId: string,
  keep: number,
): Promise<void> {
  const storeAny = store as HistoryStore & {
    setSegments?: (id: string, segments: unknown[]) => Promise<void>;
  };
  if (storeAny.setSegments) {
    const segments = await store.listSegments(documentId);
    await storeAny.setSegments(documentId, segments.slice(0, keep));
  } else {
    throw new Error('this store backend does not support tail truncation');
  }
}

async function lastKnownGood(
  store: HistoryStore,
  documentId: string,
  rasterTileStore?: RasterTileStore,
): Promise<string | undefined> {
  const revisions = (await store.listRevisions(documentId)).sort(
    (a, b) => b.createdAt - a.createdAt,
  );
  for (const revision of revisions) {
    if (revision.operationEnd === undefined) continue;
    try {
      const result = await replayAndVerify(store, documentId, revision.revisionId, rasterTileStore);
      if (result.verified) return revision.revisionId;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

/**
 * Full integrity validation of a document's history (read-only): segment
 * checksums, revision graph invariants, ref resolution, and replay-based
 * hash verification of every ref-reachable revision.
 */
export async function validateHistory(
  store: HistoryStore,
  documentId: string,
  opts: { rasterTileStore?: RasterTileStore } = {},
): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];

  for (const segment of await store.listSegments(documentId)) {
    const problem = verifySegmentChecksum(segment);
    if (problem) {
      issues.push({ severity: 'error', code: 'segment.checksum', message: problem });
    }
  }

  const revisions = await store.listRevisions(documentId);
  const byId = new Map(revisions.map((r) => [r.revisionId, r]));
  for (const revision of revisions) {
    if (
      revision.parentRevisionIds.length === 0 &&
      !['import', 'migration', 'recovery'].includes(revision.origin)
    ) {
      issues.push({
        severity: 'error',
        code: 'revision.parentless',
        message: `revision ${revision.revisionId} has zero parents but origin ${revision.origin}`,
        subjectId: revision.revisionId,
      });
    }
    if (revision.parentRevisionIds.length > 2) {
      issues.push({
        severity: 'error',
        code: 'revision.too-many-parents',
        message: `revision ${revision.revisionId} has ${revision.parentRevisionIds.length} parents`,
        subjectId: revision.revisionId,
      });
    }
    for (const parent of revision.parentRevisionIds) {
      if (!byId.has(parent)) {
        issues.push({
          severity: 'error',
          code: 'revision.missing-parent',
          message: `revision ${revision.revisionId} references missing parent ${parent}`,
          subjectId: revision.revisionId,
        });
      }
    }
  }

  for (const branch of await store.listBranches(documentId)) {
    if (!byId.has(branch.headRevisionId)) {
      issues.push({
        severity: 'error',
        code: 'branch.dangling-head',
        message: `branch ${branch.branchId} (${branch.name}) head missing: ${branch.headRevisionId}`,
        subjectId: branch.branchId,
      });
    }
  }
  for (const checkpoint of await store.listCheckpoints(documentId)) {
    if (!byId.has(checkpoint.revisionId)) {
      issues.push({
        severity: 'error',
        code: 'checkpoint.dangling',
        message: `checkpoint ${checkpoint.checkpointId} target missing: ${checkpoint.revisionId}`,
        subjectId: checkpoint.checkpointId,
      });
    }
  }

  // Replay-verify every ref-reachable revision.
  const reachable = new Set<string>();
  for (const branch of await store.listBranches(documentId)) reachable.add(branch.headRevisionId);
  for (const checkpoint of await store.listCheckpoints(documentId))
    reachable.add(checkpoint.revisionId);
  for (const revision of revisions) {
    if (!reachable.has(revision.revisionId)) continue;
    try {
      const result = await replayAndVerify(
        store,
        documentId,
        revision.revisionId,
        opts.rasterTileStore,
      );
      if (!result.verified) {
        issues.push({
          severity: 'error',
          code: 'revision.hash-mismatch',
          message: `revision ${revision.revisionId} content hash mismatch`,
          subjectId: revision.revisionId,
        });
      }
    } catch {
      issues.push({
        severity: 'error',
        code: 'revision.replay-failed',
        message: `revision ${revision.revisionId} could not be replayed`,
        subjectId: revision.revisionId,
      });
    }
  }

  return issues;
}
