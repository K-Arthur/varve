/**
 * Tail recovery and integrity validation (ADR-0046).
 *
 * Recovery never points a branch at an incomplete revision:
 * 1. verify each segment's checksum; find the first corrupt segment
 * 2. truncate the corrupt segment and everything after it
 * 3. find the newest revision whose log range is fully inside the valid
 *    segments AND whose canonical hash replays correctly — last known good
 * 4. repair each invalid branch head to its nearest verified first-parent
 *    ancestor (never an unrelated branch's global head)
 * 5. report exactly what was preserved and discarded
 */
import { verifySegmentChecksum } from './log';
import type { RasterTileStore } from './rasterTileStore';
import { replayAndVerify } from './replay';
import type { HistoryStore } from './store';
import type { IntegrityIssue, LogPosition, RevisionRecord, TailRecoveryReport } from './types';

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
  // A checksum-clean tail is not necessarily semantically valid: a buggy
  // writer or an interrupted cross-version upgrade can leave a revision hash
  // that no longer matches its replay.  Continue through the same verified
  // head-recovery path in that case instead of returning early and leaving a
  // branch pointed at the bad revision.
  const validSegments = firstBad < 0 ? segments : segments.slice(0, firstBad);
  const lastValidEnd: LogPosition = validSegments.length
    ? {
        segment: validSegments[validSegments.length - 1]!.segmentIndex,
        offset: validSegments[validSegments.length - 1]!.operations.length,
      }
    : { segment: -1, offset: 0 };

  // 2. Find the newest revision fully inside the valid log with a verified hash.
  const revisions = (await store.listRevisions(documentId)).sort(compareNewestFirst);
  const revisionsById = new Map(revisions.map((revision) => [revision.revisionId, revision]));
  const verification = new Map<string, boolean>();

  const isVerified = async (revision: RevisionRecord): Promise<boolean> => {
    const cached = verification.get(revision.revisionId);
    if (cached !== undefined) return cached;
    try {
      const result = await replayAndVerify(
        store,
        documentId,
        revision.revisionId,
        opts.rasterTileStore,
      );
      verification.set(revision.revisionId, result.verified);
      if (!result.verified) {
        report.warnings.push(`revision ${revision.revisionId}: hash mismatch during recovery scan`);
      }
      return result.verified;
    } catch {
      verification.set(revision.revisionId, false);
      report.warnings.push(`revision ${revision.revisionId}: replay failed during recovery scan`);
      return false;
    }
  };

  let lastGood: RevisionRecord | undefined;
  for (const revision of revisions) {
    if (!isRevisionInsideValidLog(revision, lastValidEnd)) continue;
    if (await isVerified(revision)) {
      lastGood = revision;
      break;
    }
  }
  if (!lastGood) report.warnings.push('no valid revision found in the surviving log');
  else report.lastKnownGoodRevisionId = lastGood.revisionId;

  // 3. Rewind each invalid branch to its own nearest verified ancestor.
  //
  // The newest globally valid revision is useful integrity-report metadata,
  // but it is not necessarily on every branch.  Repointing an older corrupt
  // branch to that unrelated revision can silently cross histories; walking
  // first parents matches replay's own lineage semantics instead.
  for (const branch of await store.listBranches(documentId)) {
    const head = revisionsById.get(branch.headRevisionId);
    const target = await findNearestVerifiedBranchRevision({
      head,
      branchBase: revisionsById.get(branch.createdFromRevisionId),
      revisionsById,
      lastValidEnd,
      isVerified,
    });

    if (!target) {
      report.warnings.push(
        `branch ${branch.branchId}: no verified ancestor found; head was left unchanged`,
      );
      continue;
    }
    if (!head || target.revisionId !== head.revisionId) {
      if (opts.applyTruncation) {
        await store.putBranch({
          ...branch,
          headRevisionId: target.revisionId,
          updatedAt: Date.now(),
        });
      }
      report.rewoundBranches.push(branch.branchId);
    }
  }

  if (opts.applyTruncation && firstBad >= 0) {
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

/**
 * The append log gives us a stable ordering even when several commits land in
 * the same millisecond.  `createdAt` is presentation metadata, so it must not
 * decide which recoverable revision survives.
 */
function compareNewestFirst(a: RevisionRecord, b: RevisionRecord): number {
  const aEnd = a.operationEnd;
  const bEnd = b.operationEnd;
  if (aEnd && bEnd) {
    if (aEnd.segment !== bEnd.segment) return bEnd.segment - aEnd.segment;
    if (aEnd.offset !== bEnd.offset) return bEnd.offset - aEnd.offset;
  } else if (aEnd) {
    return -1;
  } else if (bEnd) {
    return 1;
  }
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return b.revisionId.localeCompare(a.revisionId);
}

/** A snapshot-only genesis/import root is valid whenever it can replay. */
function isRevisionInsideValidLog(revision: RevisionRecord, end: LogPosition): boolean {
  const revisionEnd = revision.operationEnd;
  if (!revisionEnd) return true;
  if (revisionEnd.segment !== end.segment) return revisionEnd.segment < end.segment;
  return revisionEnd.offset <= end.offset;
}

interface BranchRecoverySearch {
  head: RevisionRecord | undefined;
  branchBase: RevisionRecord | undefined;
  revisionsById: ReadonlyMap<string, RevisionRecord>;
  lastValidEnd: LogPosition;
  isVerified: (revision: RevisionRecord) => Promise<boolean>;
}

/**
 * Find the closest usable revision on a branch's first-parent replay path.
 *
 * A missing head has no parent information, so the branch creation point is
 * the only safe fallback. For a present but corrupt head, retain its actual
 * first-parent chain. First-parent is intentional: `findReplayBase` follows
 * it too, and a merge's secondary parent is not a safe substitute for the
 * branch's visible document lineage.
 */
async function findNearestVerifiedBranchRevision(
  input: BranchRecoverySearch,
): Promise<RevisionRecord | undefined> {
  const visit = async (start: RevisionRecord | undefined): Promise<RevisionRecord | undefined> => {
    let current = start;
    const visited = new Set<string>();
    while (current && !visited.has(current.revisionId)) {
      visited.add(current.revisionId);
      if (
        isRevisionInsideValidLog(current, input.lastValidEnd) &&
        (await input.isVerified(current))
      ) {
        return current;
      }
      const parentId = current.parentRevisionIds[0];
      current = parentId ? input.revisionsById.get(parentId) : undefined;
    }
    return undefined;
  };

  const fromHead = await visit(input.head);
  if (fromHead) return fromHead;
  // The base is normally on the visited ancestry above. It is only a fallback
  // when the branch head is dangling or its lineage itself is incomplete.
  return input.branchBase ? visit(input.branchBase) : undefined;
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
