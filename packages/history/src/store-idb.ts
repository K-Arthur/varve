/**
 * IndexedDB HistoryStore backend (ADR-0020, M5/M6 browser persistence).
 *
 * Persists the append-only operation log, revision DAG, branch/checkpoint
 * refs, content-addressed snapshots, and recovery refs in IndexedDB so
 * persistent history survives close, reload, and restart in the webview
 * (browser and Tauri desktop). Atomicity mirrors the memory implementation:
 * - `appendOperations` stages segment + manifest in ONE readwrite
 *   transaction (a reader can never observe a half-appended segment)
 * - `commitRevision` writes the revision record plus any branch-head/
 *   branch/checkpoint updates in ONE transaction (a branch is never
 *   observed pointing at an incomplete revision)
 *
 * Layout (database `varve-history`, schema version 1):
 * - `manifest`      keyPath documentId — one row per document
 * - `segments`      keyPath [documentId, segmentIndex]
 * - `revisions`     keyPath revisionId + documentId index
 * - `branches`      keyPath branchId + documentId index
 * - `checkpoints`   keyPath checkpointId + documentId index
 * - `snapshots`     keyPath [documentId, canonicalHash]
 * - `recoveryRefs`  keyPath [documentId, recoveryId]
 */
import { type IDBPDatabase, openDB } from 'idb';
import { buildSegment, type LogSegment } from './log';
import type { SnapshotRecord } from './snapshots';
import type { HistoryStore, RevisionCommit, RevisionCommitResult } from './store';
import type {
  BranchRef,
  CheckpointRef,
  DocumentManifest,
  RecoveryRef,
  RevisionRecord,
  StoredOperation,
} from './types';

export const HISTORY_DB_NAME = 'varve-history';
export const HISTORY_DB_VERSION = 1;

export const STORE_MANIFEST = 'manifest';
export const STORE_SEGMENTS = 'segments';
export const STORE_REVISIONS = 'revisions';
export const STORE_BRANCHES = 'branches';
export const STORE_CHECKPOINTS = 'checkpoints';
export const STORE_SNAPSHOTS = 'snapshots';
export const STORE_RECOVERY_REFS = 'recoveryRefs';

export async function openHistoryDb(): Promise<IDBPDatabase> {
  return openDB(HISTORY_DB_NAME, HISTORY_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_MANIFEST)) {
        db.createObjectStore(STORE_MANIFEST, { keyPath: 'documentId' });
      }
      if (!db.objectStoreNames.contains(STORE_SEGMENTS)) {
        db.createObjectStore(STORE_SEGMENTS, {
          keyPath: ['documentId', 'segmentIndex'],
        });
      }
      if (!db.objectStoreNames.contains(STORE_REVISIONS)) {
        const store = db.createObjectStore(STORE_REVISIONS, { keyPath: 'revisionId' });
        store.createIndex('documentId', 'documentId');
      }
      if (!db.objectStoreNames.contains(STORE_BRANCHES)) {
        const store = db.createObjectStore(STORE_BRANCHES, { keyPath: 'branchId' });
        store.createIndex('documentId', 'documentId');
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        const store = db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'checkpointId' });
        store.createIndex('documentId', 'documentId');
      }
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, {
          keyPath: ['documentId', 'canonicalHash'],
        });
      }
      if (!db.objectStoreNames.contains(STORE_RECOVERY_REFS)) {
        db.createObjectStore(STORE_RECOVERY_REFS, {
          keyPath: ['documentId', 'recoveryId'],
        });
      }
    },
  });
}

/** Open an IndexedDB-backed history store (one shared connection). */
export function createIndexedDbHistoryStore(
  db: IDBPDatabase | Promise<IDBPDatabase> = openHistoryDb(),
  faults: { failOnAppend?: boolean } = {},
): HistoryStore {
  const connect = typeof db === 'object' && db !== null && 'name' in db ? Promise.resolve(db) : db;

  return {
    // ── manifest + log ──────────────────────────────────────────────────────
    async getManifest(documentId) {
      const database = await connect;
      return (await database.get(STORE_MANIFEST, documentId)) ?? null;
    },

    async appendOperations(documentId, operations) {
      const database = await connect;
      if (operations.length === 0) {
        return { segment: -1, offset: 0 };
      }
      const tx = database.transaction([STORE_SEGMENTS, STORE_MANIFEST], 'readwrite');
      try {
        if (faults.failOnAppend) {
          // Fault injection (ADR-0020): the transaction must abort before the
          // manifest advances; readers must never observe the half segment.
          throw new Error('injected append failure');
        }
        const manifest = (await tx.objectStore(STORE_MANIFEST).get(documentId)) ?? null;
        const current: DocumentManifest = manifest ?? {
          documentId,
          nextLogicalSequence: 1,
          nextSegmentIndex: 0,
        };
        const stamped = operations.map((op, i) => ({
          ...op,
          logicalSequence: current.nextLogicalSequence + i,
        }));
        const { segment, nextSegmentIndex } = buildSegment({
          documentId,
          operations: stamped,
          segmentIndex: current.nextSegmentIndex,
          nextLogicalSequence: current.nextLogicalSequence + stamped.length,
        });
        await tx.objectStore(STORE_SEGMENTS).put(segment);
        await tx.objectStore(STORE_MANIFEST).put({
          ...current,
          nextLogicalSequence: current.nextLogicalSequence + stamped.length,
          nextSegmentIndex,
        });
        await tx.done;
        return { segment: segment.segmentIndex, offset: 0 };
      } catch (err) {
        tx.abort();
        try {
          await tx.done;
        } catch {
          // Expected abort rejection; the original error is re-thrown below.
        }
        throw err;
      }
    },

    async getSegment(documentId, segmentIndex) {
      const database = await connect;
      return (await database.get(STORE_SEGMENTS, [documentId, segmentIndex])) ?? null;
    },

    async listSegments(documentId) {
      const database = await connect;
      const all = (await database.getAll(STORE_SEGMENTS)) as LogSegment[];
      return all
        .filter((segment) => segment.documentId === documentId)
        .sort((a, b) => a.segmentIndex - b.segmentIndex);
    },

    async readOperations(documentId, start, end) {
      const database = await connect;
      const out: StoredOperation[] = [];
      for (let s = start.segment; s <= end.segment; s++) {
        const segment = await database.get(STORE_SEGMENTS, [documentId, s]);
        if (!segment) break;
        const from = s === start.segment ? start.offset : 0;
        const to =
          s === end.segment
            ? Math.min(end.offset, segment.operations.length)
            : segment.operations.length;
        for (let i = from; i < to; i++) {
          const op = segment.operations[i];
          if (op) out.push(op);
        }
      }
      return out;
    },

    async setSegments(documentId, segments) {
      const database = await connect;
      const tx = database.transaction([STORE_SEGMENTS, STORE_MANIFEST], 'readwrite');
      const retained = new Set(segments.map((s) => s.segmentIndex));
      const existing = (await tx.objectStore(STORE_SEGMENTS).getAll()) as LogSegment[];
      for (const segment of existing) {
        if (segment.documentId === documentId && !retained.has(segment.segmentIndex)) {
          await tx.objectStore(STORE_SEGMENTS).delete([documentId, segment.segmentIndex]);
        }
      }
      for (const segment of segments) {
        await tx.objectStore(STORE_SEGMENTS).put(segment);
      }
      const manifest = ((await tx
        .objectStore(STORE_MANIFEST)
        .get(documentId)) as DocumentManifest | null) ?? {
        documentId,
        nextLogicalSequence: 1,
        nextSegmentIndex: 0,
      };
      const last = segments[segments.length - 1];
      await tx.objectStore(STORE_MANIFEST).put({
        ...manifest,
        nextSegmentIndex: last ? last.segmentIndex + 1 : 0,
      });
      await tx.done;
    },

    // ── revisions ────────────────────────────────────────────────────────────
    async putRevision(revision) {
      const database = await connect;
      await database.put(STORE_REVISIONS, revision);
    },

    async getRevision(documentId, revisionId) {
      const database = await connect;
      const revision = (await database.get(STORE_REVISIONS, revisionId)) as
        | RevisionRecord
        | undefined;
      return revision?.documentId === documentId ? revision : null;
    },

    async listRevisions(documentId) {
      const database = await connect;
      const all = (await database.getAll(STORE_REVISIONS)) as RevisionRecord[];
      return all.filter((revision) => revision.documentId === documentId);
    },

    async commitRevision(commit: RevisionCommit): Promise<RevisionCommitResult> {
      const database = await connect;
      const tx = database.transaction(
        [STORE_REVISIONS, STORE_BRANCHES, STORE_CHECKPOINTS],
        'readwrite',
      );
      await tx.objectStore(STORE_REVISIONS).put(commit.revision);
      let branchHead: BranchRef | undefined;
      if (commit.createBranch) {
        await tx.objectStore(STORE_BRANCHES).put(commit.createBranch);
        branchHead = commit.createBranch;
      }
      if (commit.moveBranchHead) {
        const existing = (await tx
          .objectStore(STORE_BRANCHES)
          .get(commit.moveBranchHead.branchId)) as BranchRef | undefined;
        if (existing) {
          const updated: BranchRef = {
            ...existing,
            headRevisionId: commit.moveBranchHead.headRevisionId,
            status: commit.moveBranchHead.status ?? existing.status,
            updatedAt: Date.now(),
          };
          await tx.objectStore(STORE_BRANCHES).put(updated);
          branchHead = updated;
        }
      }
      if (commit.createCheckpoint) {
        await tx.objectStore(STORE_CHECKPOINTS).put(commit.createCheckpoint);
      }
      await tx.done;
      return { revision: commit.revision, branchHead };
    },

    // ── branch refs ──────────────────────────────────────────────────────────
    async putBranch(branch) {
      const database = await connect;
      await database.put(STORE_BRANCHES, branch);
    },

    async getBranch(documentId, branchId) {
      const database = await connect;
      const branch = (await database.get(STORE_BRANCHES, branchId)) as BranchRef | undefined;
      return branch?.documentId === documentId ? branch : null;
    },

    async listBranches(documentId) {
      const database = await connect;
      const all = (await database.getAll(STORE_BRANCHES)) as BranchRef[];
      return all.filter((branch) => branch.documentId === documentId);
    },

    async deleteBranch(branchId) {
      const database = await connect;
      await database.delete(STORE_BRANCHES, branchId);
    },

    // ── checkpoint refs ──────────────────────────────────────────────────────
    async putCheckpoint(checkpoint) {
      const database = await connect;
      await database.put(STORE_CHECKPOINTS, checkpoint);
    },

    async getCheckpoint(documentId, checkpointId) {
      const database = await connect;
      const checkpoint = (await database.get(STORE_CHECKPOINTS, checkpointId)) as
        | CheckpointRef
        | undefined;
      return checkpoint?.documentId === documentId ? checkpoint : null;
    },

    async listCheckpoints(documentId) {
      const database = await connect;
      const all = (await database.getAll(STORE_CHECKPOINTS)) as CheckpointRef[];
      return all.filter((checkpoint) => checkpoint.documentId === documentId);
    },

    async deleteCheckpoint(checkpointId) {
      const database = await connect;
      await database.delete(STORE_CHECKPOINTS, checkpointId);
    },

    // ── snapshots (content-addressed by canonical hash) ──────────────────────
    async putSnapshot(snapshot) {
      const database = await connect;
      await database.put(STORE_SNAPSHOTS, snapshot);
    },

    async getSnapshot(documentId, canonicalHash) {
      const database = await connect;
      return (
        ((await database.get(STORE_SNAPSHOTS, [documentId, canonicalHash])) as
          | SnapshotRecord
          | undefined) ?? null
      );
    },

    // ── recovery refs ────────────────────────────────────────────────────────
    async putRecoveryRef(ref) {
      const database = await connect;
      await database.put(STORE_RECOVERY_REFS, ref);
    },

    async listRecoveryRefs(documentId) {
      const database = await connect;
      const all = (await database.getAll(STORE_RECOVERY_REFS)) as RecoveryRef[];
      return all
        .filter((ref) => ref.documentId === documentId)
        .sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}
