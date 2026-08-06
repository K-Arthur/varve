/**
 * HistoryStore contract and memory implementation (ADR-0020).
 *
 * The contract is backend-agnostic: memory (tests/demo), IndexedDB (web),
 * and SQLite (desktop) must all satisfy the same atomicity guarantees:
 * - operations append in checksummed segments; the manifest advances in the
 *   same transaction
 * - a revision record and any branch-head/checkpoint update commit together
 *   (a branch is never pointed at an incomplete revision)
 * - reads never observe a half-applied append
 *
 * The memory implementation uses a single immutable state object per
 * mutation, which gives exactly the transactional semantics the contract
 * requires; platform backends are documented follow-ups.
 */
import { randomHex } from '@varve/scene';
import { buildSegment, type LogSegment } from './log';
import type { SnapshotRecord } from './snapshots';
import type {
  BranchRef,
  CheckpointRef,
  DocumentManifest,
  IntegrityIssue,
  LogPosition,
  RecoveryRef,
  RevisionRecord,
  StoredOperation,
  TailRecoveryReport,
} from './types';

export interface HistoryStore {
  // ── manifest + log ─────────────────────────────────────────────────────────
  getManifest(documentId: string): Promise<DocumentManifest | null>;
  /** Append operations and advance the manifest atomically. */
  appendOperations(documentId: string, operations: StoredOperation[]): Promise<LogPosition>;
  getSegment(documentId: string, segmentIndex: number): Promise<LogSegment | null>;
  listSegments(documentId: string): Promise<LogSegment[]>;
  /** Operations in [start, end) — half-open range over the log. */
  readOperations(
    documentId: string,
    start: LogPosition,
    end: LogPosition,
  ): Promise<StoredOperation[]>;
  /** Recovery-only: replace the segment list with the valid prefix. */
  setSegments?(documentId: string, segments: LogSegment[]): Promise<void>;

  // ── revisions ──────────────────────────────────────────────────────────────
  putRevision(revision: RevisionRecord): Promise<void>;
  getRevision(documentId: string, revisionId: string): Promise<RevisionRecord | null>;
  listRevisions(documentId: string): Promise<RevisionRecord[]>;
  /**
   * Commit a revision plus optional branch-head / branch / checkpoint updates
   * in ONE transaction: a branch is never observed pointing at an incomplete
   * revision, and a checkpoint never references a missing revision.
   */
  commitRevision(commit: RevisionCommit): Promise<RevisionCommitResult>;

  // ── branch refs (atomic with revision writes at the caller level) ──────────
  putBranch(branch: BranchRef): Promise<void>;
  getBranch(documentId: string, branchId: string): Promise<BranchRef | null>;
  listBranches(documentId: string): Promise<BranchRef[]>;

  // ── checkpoint refs ────────────────────────────────────────────────────────
  putCheckpoint(checkpoint: CheckpointRef): Promise<void>;
  getCheckpoint(documentId: string, checkpointId: string): Promise<CheckpointRef | null>;
  listCheckpoints(documentId: string): Promise<CheckpointRef[]>;

  // ── snapshots (content-addressed by canonical hash) ────────────────────────
  putSnapshot(snapshot: SnapshotRecord): Promise<void>;
  getSnapshot(documentId: string, canonicalHash: string): Promise<SnapshotRecord | null>;

  // ── recovery refs ──────────────────────────────────────────────────────────
  putRecoveryRef(ref: RecoveryRef): Promise<void>;
  listRecoveryRefs(documentId: string): Promise<RecoveryRef[]>;
}

/** Atomically commit a revision plus an optional head/branch/checkpoint update. */
export interface RevisionCommit {
  revision: RevisionRecord;
  /** Branch head movement that must commit with the revision. */
  moveBranchHead?: { branchId: string; headRevisionId: string; status?: BranchRef['status'] };
  /** New branch creation committed with the revision. */
  createBranch?: BranchRef;
  /** New checkpoint committed with the revision. */
  createCheckpoint?: CheckpointRef;
}

export interface RevisionCommitResult {
  revision: RevisionRecord;
  branchHead?: BranchRef;
}

// ── Memory implementation ────────────────────────────────────────────────────

interface MemoryState {
  manifests: Map<string, DocumentManifest>;
  segments: Map<string, LogSegment[]>;
  revisions: Map<string, Map<string, RevisionRecord>>;
  branches: Map<string, Map<string, BranchRef>>;
  checkpoints: Map<string, Map<string, CheckpointRef>>;
  snapshots: Map<string, Map<string, SnapshotRecord>>;
  recoveryRefs: Map<string, RecoveryRef[]>;
}

export function createMemoryHistoryStore(): HistoryStore {
  const state: MemoryState = {
    manifests: new Map(),
    segments: new Map(),
    revisions: new Map(),
    branches: new Map(),
    checkpoints: new Map(),
    snapshots: new Map(),
    recoveryRefs: new Map(),
  };

  function ensureManifest(documentId: string): DocumentManifest {
    const existing = state.manifests.get(documentId);
    if (existing) return existing;
    const manifest: DocumentManifest = {
      documentId,
      nextLogicalSequence: 1,
      nextSegmentIndex: 0,
    };
    state.manifests.set(documentId, manifest);
    return manifest;
  }

  return {
    async getManifest(documentId) {
      return state.manifests.get(documentId) ?? null;
    },

    async appendOperations(documentId, operations) {
      const manifest = ensureManifest(documentId);
      if (operations.length === 0) return { segment: manifest.nextSegmentIndex - 1, offset: 0 };
      // Assign document-scoped logical sequences atomically.
      const stamped = operations.map((op, i) => ({
        ...op,
        logicalSequence: manifest.nextLogicalSequence + i,
      }));
      const { segment, nextSegmentIndex } = buildSegment({
        documentId,
        operations: stamped,
        segmentIndex: manifest.nextSegmentIndex,
        nextLogicalSequence: manifest.nextLogicalSequence + stamped.length,
      });
      const list = state.segments.get(documentId) ?? [];
      list.push(segment);
      state.segments.set(documentId, list);
      state.manifests.set(documentId, {
        ...manifest,
        nextLogicalSequence: manifest.nextLogicalSequence + stamped.length,
        nextSegmentIndex,
      });
      return { segment: segment.segmentIndex, offset: 0 };
    },

    async getSegment(documentId, segmentIndex) {
      return state.segments.get(documentId)?.[segmentIndex] ?? null;
    },

    async listSegments(documentId) {
      return state.segments.get(documentId) ?? [];
    },

    async setSegments(documentId, segments) {
      state.segments.set(documentId, segments);
      const manifest = state.manifests.get(documentId);
      if (manifest) {
        const last = segments[segments.length - 1];
        state.manifests.set(documentId, {
          ...manifest,
          nextSegmentIndex: last ? last.segmentIndex + 1 : 0,
        });
      }
    },

    async readOperations(documentId, start, end) {
      const segments = state.segments.get(documentId) ?? [];
      const out: StoredOperation[] = [];
      for (let s = start.segment; s <= end.segment; s++) {
        const segment = segments[s];
        if (!segment) break;
        if (s < start.segment || s > end.segment) continue;
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

    async putRevision(revision) {
      const map = state.revisions.get(revision.documentId) ?? new Map();
      map.set(revision.revisionId, revision);
      state.revisions.set(revision.documentId, map);
    },

    async commitRevision(commit) {
      // Single immutable state transition: revision + refs are committed
      // together (ADR-0020 atomic-ref rule).
      const documentId = commit.revision.documentId;
      const next = {
        manifests: state.manifests,
        segments: state.segments,
        revisions: new Map(state.revisions),
        branches: new Map(state.branches),
        checkpoints: new Map(state.checkpoints),
        snapshots: state.snapshots,
        recoveryRefs: state.recoveryRefs,
      };
      const revMap = new Map(next.revisions.get(documentId) ?? []);
      revMap.set(commit.revision.revisionId, commit.revision);
      next.revisions.set(documentId, revMap);

      let branchHead: BranchRef | undefined;
      if (commit.createBranch) {
        const branchMap = new Map(next.branches.get(documentId) ?? []);
        branchMap.set(commit.createBranch.branchId, commit.createBranch);
        next.branches.set(documentId, branchMap);
        branchHead = commit.createBranch;
      }
      if (commit.moveBranchHead) {
        const branchMap = new Map(next.branches.get(documentId) ?? []);
        const existing = branchMap.get(commit.moveBranchHead.branchId);
        if (existing) {
          const updated: BranchRef = {
            ...existing,
            headRevisionId: commit.moveBranchHead.headRevisionId,
            status: commit.moveBranchHead.status ?? existing.status,
            updatedAt: Date.now(),
          };
          branchMap.set(updated.branchId, updated);
          next.branches.set(documentId, branchMap);
          branchHead = updated;
        }
      }
      if (commit.createCheckpoint) {
        const cpMap = new Map(next.checkpoints.get(documentId) ?? []);
        cpMap.set(commit.createCheckpoint.checkpointId, commit.createCheckpoint);
        next.checkpoints.set(documentId, cpMap);
      }

      state.manifests = next.manifests;
      state.segments = next.segments;
      state.revisions = next.revisions;
      state.branches = next.branches;
      state.checkpoints = next.checkpoints;
      state.snapshots = next.snapshots;
      state.recoveryRefs = next.recoveryRefs;
      return { revision: commit.revision, branchHead };
    },

    async getRevision(documentId, revisionId) {
      return state.revisions.get(documentId)?.get(revisionId) ?? null;
    },

    async listRevisions(documentId) {
      return [...(state.revisions.get(documentId)?.values() ?? [])];
    },

    async putBranch(branch) {
      const map = state.branches.get(branch.documentId) ?? new Map();
      map.set(branch.branchId, branch);
      state.branches.set(branch.documentId, map);
    },

    async getBranch(documentId, branchId) {
      return state.branches.get(documentId)?.get(branchId) ?? null;
    },

    async listBranches(documentId) {
      return [...(state.branches.get(documentId)?.values() ?? [])];
    },

    async putCheckpoint(checkpoint) {
      const map = state.checkpoints.get(checkpoint.documentId) ?? new Map();
      map.set(checkpoint.checkpointId, checkpoint);
      state.checkpoints.set(checkpoint.documentId, map);
    },

    async getCheckpoint(documentId, checkpointId) {
      return state.checkpoints.get(documentId)?.get(checkpointId) ?? null;
    },

    async listCheckpoints(documentId) {
      return [...(state.checkpoints.get(documentId)?.values() ?? [])];
    },

    async putSnapshot(snapshot) {
      const map = state.snapshots.get(snapshot.documentId) ?? new Map();
      map.set(snapshot.canonicalHash, snapshot);
      state.snapshots.set(snapshot.documentId, map);
    },

    async getSnapshot(documentId, canonicalHash) {
      return state.snapshots.get(documentId)?.get(canonicalHash) ?? null;
    },

    async putRecoveryRef(ref) {
      const list = state.recoveryRefs.get(ref.documentId) ?? [];
      list.push(ref);
      state.recoveryRefs.set(ref.documentId, list);
    },

    async listRecoveryRefs(documentId) {
      return state.recoveryRefs.get(documentId) ?? [];
    },
  };
}

export async function commitRevision(
  store: HistoryStore,
  commit: RevisionCommit,
): Promise<RevisionCommitResult> {
  return store.commitRevision(commit);
}

/** Mint a collision-resistant history id (`r-<random hex>`). */
export function mintHistoryId(prefix: string): string {
  return `${prefix}-${randomHex(8)}`;
}

export function isIntegrityError(issue: IntegrityIssue): boolean {
  return issue.severity === 'error';
}

export type { SnapshotRecord, TailRecoveryReport };
