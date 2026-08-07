/**
 * EditorHistorySession — the editor's persistent history session (M7 wiring).
 *
 * Bridges the editor's transaction lifecycle into the `@varve/history`
 * revision store:
 *
 * - `attach(document)` — recovers/validates the document's persisted
 *   history (IndexedDB), rewinds corrupt tails, and either attaches the
 *   working document to the recorded head revision or creates a genesis
 *   revision (ADR-0020/0022). When the editor document is newer than the
 *   recorded head (external change, re-import), a reconciliation revision
 *   is created so the recorded history never silently diverges.
 * - `capture(before, after, selection)` — called at transaction commit
 *   boundaries. The deterministic semantic diff (ADR-0028) is recorded as
 *   one typed `document.transaction-capture` operation (ADR-0017 escape
 *   hatch) with the step label, then a one-parent revision is committed
 *   with an atomic branch-head move. Empty transactions never create
 *   revisions. Captures are serialized through an internal promise queue so
 *   logical sequences stay monotonic.
 * - Undo/redo is ADR-0019 Model A: the branch head moves along first-parent
 *   chains; a new edit after undo parents onto the current position and
 *   abandons (never deletes) the old direction; `materializeDivergence`
 *   turns abandoned paths into named branches.
 * - Checkpoint and branch refs, comparison, merging, and integrity
 *   validation are exposed here so the History panel, comparison workspace,
 *   and conflict resolver can be thin UI over a single source of truth.
 *
 * Selection and viewport state are deliberately NOT part of the history:
 * the session keeps a bounded in-memory selection journal keyed by revision
 * id so undo restores the same selection the user had when the step was
 * made (spec §13 — "selection and viewport restoration are handled
 * separately from document history").
 *
 * The in-memory editor undo stack remains the fallback for mutation paths
 * not yet migrated to transaction boundaries (mutation inventory, ADR-0017);
 * when this session is attached with history, undo/redo route here.
 */

import type {
  BranchRef,
  CheckpointRef,
  HistoryStore,
  MergeConflict,
  MergeResolution,
  MergeResult,
  RevisionOrigin,
  RevisionRecord,
  StoredOperation,
} from '@varve/history';
import {
  applyMergeResolutions,
  commitMergeRevision,
  createCheckpoint,
  createGenesisRevision,
  createSnapshot,
  diffDocuments,
  findBranchMergeBase,
  loadDocumentAt,
  materializeDivergenceBranch,
  mergeDocuments,
  mintHistoryId,
  moveBranchHead,
  positionAfter,
  recoverTail,
  redoRevision,
  SnapshotScheduler,
  undoN,
  undoRevision,
  undoTo,
  validateBranchName,
  validateCheckpointName,
  validateHistory,
  validateMergeResolutions,
  validateRevisionGraph,
  verifyResolvedDocument,
} from '@varve/history';
import type { Document, NodeId } from '@varve/scene';
import {
  canonicalHash,
  registerBuiltinOperations,
  type SemanticSummary,
  validatePayload,
} from '@varve/scene';

registerBuiltinOperations();

// ── Bounds (ADR-0030) ─────────────────────────────────────────────────────────

const MAX_SELECTION_JOURNAL_ENTRIES = 500;
const MAX_DOCUMENT_CACHE_ENTRIES = 8;

export interface HistoryIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

export interface AttachResult {
  /** The revision the working document is attached to. */
  headRevision: RevisionRecord;
  /** The active branch. */
  branch: BranchRef;
  /** True when the editor document differed from the recorded head and a
   *  reconciliation revision was created. */
  reconciled: boolean;
  /** Integrity issues found during attach. */
  issues: HistoryIssue[];
}

export interface HistoryStepView {
  revision: RevisionRecord;
  label: string;
  kind: string;
  origin: RevisionOrigin;
  affectedEntityCount: number;
  isHead: boolean;
  checkpointNames: string[];
  branchHeadNames: string[];
  /** Distance in steps from the current head (0 = head). */
  stepsBack: number;
}

export interface CaptureOptions {
  label: string;
  kind: string;
  source?:
    | 'canvas'
    | 'inspector'
    | 'layers'
    | 'history'
    | 'import'
    | 'plugin'
    | 'merge'
    | 'recovery'
    | 'api';
}

export interface EditorHistorySessionOptions {
  store: HistoryStore;
  documentId: string;
  authorActorId: string;
  scheduler?: SnapshotScheduler;
}

export class EditorHistorySession {
  private readonly store: HistoryStore;
  readonly documentId: string;
  private readonly actorId: string;
  private readonly scheduler: SnapshotScheduler;

  private attachedBranch: BranchRef | null = null;
  private lastCapturePromise: Promise<unknown> = Promise.resolve();
  private selectionJournal = new Map<string, NodeId[]>();
  private documentCache = new Map<string, Document>();
  private cacheOrder: string[] = [];
  private redoTarget: string | null = null;
  private undoableState = false;
  private lastUndoLabelState = 'Undo';
  private lastRedoLabelState = 'Redo';

  /** Revision the working document is currently attached to. */
  headRevisionId: string | null = null;
  /** Latest attach outcome (for UI). */
  lastAttach: AttachResult | null = null;

  constructor(options: EditorHistorySessionOptions) {
    this.store = options.store;
    this.documentId = options.documentId;
    this.actorId = options.authorActorId;
    this.scheduler = options.scheduler ?? new SnapshotScheduler();
  }

  get attached(): boolean {
    return this.attachedBranch !== null;
  }

  get branch(): BranchRef | null {
    return this.attachedBranch;
  }

  get canUndo(): boolean {
    return this.undoableState;
  }

  get canRedo(): boolean {
    return this.redoTarget !== null;
  }

  get undoLabel(): string {
    return this.lastUndoLabelState;
  }

  get redoLabel(): string {
    return this.lastRedoLabelState;
  }

  // ── Attach / reconcile ──────────────────────────────────────────────────────

  /** Attach the working document to the persisted history (genesis or
   *  reconciliation). Recovery runs before attach; a corrupt tail is
   *  rewound so the session never builds on garbage. */
  async attach(document: Document): Promise<AttachResult> {
    const issues: HistoryIssue[] = [];
    // History existence is determined by branch refs, not the manifest: a
    // genesis-only document has no operation segments yet, so the manifest
    // is legitimately absent.
    const branches = await this.store.listBranches(this.documentId);
    if (branches.length === 0) {
      const { genesis, branch } = await createGenesisRevision(this.store, document, {
        documentId: this.documentId,
        author: { actorId: this.actorId, kind: 'local-user' },
      });
      return this.finishAttach(genesis, branch, false, issues);
    }

    // Recovery pass: rewind corrupt tails before trusting the head.
    const recovery = await recoverTail(this.store, this.documentId);
    if (recovery.warnings.length > 0 || recovery.truncatedSegments.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'history.tail-recovered',
        message: `Recovered from an incomplete log tail: ${recovery.truncatedSegments.length} segment(s) truncated, ${recovery.discardedOperations} operation(s) discarded`,
      });
    }

    const branch = branches[0]!;
    const head = await this.store.getRevision(this.documentId, branch.headRevisionId);
    if (!head) {
      issues.push({
        severity: 'error',
        code: 'history.dangling-head',
        message: `Branch ${branch.name} points at a missing revision; recreating genesis`,
      });
      const { genesis, branch: fresh } = await createGenesisRevision(this.store, document, {
        documentId: this.documentId,
        author: { actorId: this.actorId, kind: 'local-user' },
      });
      return this.finishAttach(genesis, fresh, true, issues);
    }

    // Reconcile the working document against the recorded head.
    const workingHash = canonicalHash(document);
    if (workingHash === head.canonicalDocumentHash) {
      return this.finishAttach(head, branch, false, issues);
    }
    const reconciliation = await this.captureRevisionFor(
      document,
      head,
      branch,
      { label: 'Loaded working state', kind: 'admin' },
      'recovery',
      issues,
    );
    if (reconciliation) {
      issues.push({
        severity: 'warning',
        code: 'history.reconciled',
        message:
          'The working document differed from the recorded head; a reconciliation revision was created',
      });
      return this.finishAttach(reconciliation, branch, true, issues);
    }
    return this.finishAttach(head, branch, false, issues);
  }

  private finishAttach(
    head: RevisionRecord,
    branch: BranchRef,
    reconciled: boolean,
    issues: HistoryIssue[],
  ): AttachResult {
    this.attachedBranch = branch;
    this.headRevisionId = head.revisionId;
    this.undoableState = head.parentRevisionIds.length > 0;
    this.redoTarget = null;
    this.lastAttach = { headRevision: head, branch, reconciled, issues };
    return this.lastAttach;
  }

  // ── Capture (transaction commit boundary) ───────────────────────────────────

  /** Record a committed user transaction. Serialized; empty transactions
   *  (reference-equal documents) never create revisions. Returns the
   *  created revision or null. */
  capture(
    before: Document,
    after: Document,
    selection: NodeId[],
    options: CaptureOptions,
  ): Promise<RevisionRecord | null> {
    const task = async (): Promise<RevisionRecord | null> => {
      if (!this.attachedBranch || !this.headRevisionId) return null;
      if (before === after) return null;
      const head = await this.store.getRevision(this.documentId, this.headRevisionId);
      if (!head) return null;
      const diff = diffDocuments(before, after);
      if (!diff.changed) return null;
      const revision = await this.commitCapture(
        after,
        head,
        this.attachedBranch,
        diff,
        options,
        'edit',
      );
      if (revision) this.rememberSelection(revision.revisionId, selection);
      return revision;
    };
    const result = this.lastCapturePromise.then(task, task);
    // Swallow capture failures in the queue chain (the next capture must
    // still run); failures surface via the returned promise.
    this.lastCapturePromise = result.catch(() => undefined);
    return result;
  }

  private async captureRevisionFor(
    after: Document,
    parent: RevisionRecord,
    branch: BranchRef,
    options: CaptureOptions,
    origin: RevisionOrigin,
    issues: HistoryIssue[],
  ): Promise<RevisionRecord | null> {
    const parentDocument = await this.loadCachedDocument(parent.revisionId, parent);
    const diff = diffDocuments(parentDocument, after);
    if (!diff.changed) return null;
    return this.commitCapture(after, parent, branch, diff, options, origin, issues);
  }

  private async commitCapture(
    after: Document,
    parent: RevisionRecord,
    branch: BranchRef,
    diff: ReturnType<typeof diffDocuments>,
    options: CaptureOptions,
    origin: RevisionOrigin,
    issues?: HistoryIssue[],
  ): Promise<RevisionRecord | null> {
    const summary: SemanticSummary = {
      label: options.label,
      kind: options.kind,
      affectedEntityIds: [...new Set(diff.changes.map((c) => c.entityId))],
    };
    const payload = {
      transactionId: mintHistoryId('tx'),
      changes: diff.changes,
      summary,
      beforeHash: diff.baseHash,
      afterHash: diff.targetHash,
    };
    const validated = validatePayload('document.transaction-capture', payload);
    if (!validated.ok) {
      const message = `capture validation failed: ${validated.errors.join('; ')}`;
      issues?.push({ severity: 'error', code: 'history.capture-invalid', message });
      return null;
    }
    const stored: StoredOperation = {
      operationId: mintHistoryId('op'),
      operationType: 'document.transaction-capture',
      schemaVersion: 1,
      logicalSequence: 0, // assigned by the store
      affectedEntityIds: summary.affectedEntityIds,
      payload,
    };
    const position = await this.store.appendOperations(this.documentId, [stored]);
    const end = positionAfter(position);
    const revision: RevisionRecord = {
      revisionId: mintHistoryId('r'),
      documentId: this.documentId,
      parentRevisionIds: [parent.revisionId],
      transactionId: options.label,
      canonicalDocumentHash: diff.targetHash,
      operationStart: position,
      operationEnd: end,
      author: { actorId: this.actorId, kind: 'local-user' },
      semanticSummary: summary,
      createdAt: Date.now(),
      schemaVersion: 1,
      origin,
    };

    // Threshold-based snapshot policy keeps replay cheap (ADR-0021).
    let snapshotted = revision;
    const due = this.scheduler.noteCommit({
      replayedBytesSinceSnapshot: 0,
      replayMsSinceSnapshot: 0,
      atCheckpoint: false,
      atShutdown: false,
    });
    if (due) {
      const snapshot = await createSnapshot(this.store, after, {
        documentId: this.documentId,
        revisionId: revision.revisionId,
      });
      snapshotted = { ...revision, snapshotId: snapshot.canonicalHash };
    }
    const result = await this.store.commitRevision({
      revision: snapshotted,
      moveBranchHead: {
        branchId: branch.branchId,
        headRevisionId: snapshotted.revisionId,
      },
    });
    this.headRevisionId = snapshotted.revisionId;
    this.redoTarget = null;
    this.undoableState = true;
    this.lastUndoLabelState = summary.label;
    this.rememberDocument(snapshotted.revisionId, after);
    return result.revision;
  }

  // ── Undo / redo (ADR-0019 Model A) ──────────────────────────────────────────

  /** Undo one step: move the head to the first parent and return the
   *  document + selection to load. Returns null at genesis. */
  async undo(): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch || !this.headRevisionId) return null;
    const result = await undoRevision(this.store, this.documentId, this.attachedBranch.branchId);
    if (!result) return null;
    this.headRevisionId = result.headRevisionId;
    this.redoTarget = result.redoTargetRevisionId;
    this.lastUndoLabelState = 'Undo';
    const revision = await this.store.getRevision(this.documentId, result.headRevisionId);
    if (revision) {
      this.lastUndoLabelState = revision.semanticSummary.label;
      this.undoableState = revision.parentRevisionIds.length > 0;
    }
    const document = await this.loadCachedDocument(result.headRevisionId, revision);
    return { document, selection: this.selectionJournal.get(result.headRevisionId) ?? [] };
  }

  /** Redo the most recently abandoned child of the current head. */
  async redo(): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch || !this.headRevisionId || !this.redoTarget) return null;
    const targetId = this.redoTarget;
    const result = await redoRevision(
      this.store,
      this.documentId,
      this.attachedBranch.branchId,
      targetId,
    );
    this.headRevisionId = result.headRevisionId;
    this.redoTarget = null;
    this.lastRedoLabelState = 'Redo';
    const revision = await this.store.getRevision(this.documentId, result.headRevisionId);
    if (revision) {
      this.lastRedoLabelState = revision.semanticSummary.label;
      this.undoableState = true;
    }
    const document = await this.loadCachedDocument(result.headRevisionId, revision);
    return { document, selection: this.selectionJournal.get(result.headRevisionId) ?? [] };
  }

  /** Undo N steps in one call. */
  async undoCount(count: number): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch || !this.headRevisionId) return null;
    const result = await undoN(this.store, this.documentId, this.attachedBranch.branchId, count);
    if (result.appliedSteps === 0) return null;
    this.headRevisionId = result.headRevisionId;
    this.redoTarget = result.redoTargetRevisionId || null;
    const revision = await this.store.getRevision(this.documentId, result.headRevisionId);
    const document = await this.loadCachedDocument(result.headRevisionId, revision);
    return { document, selection: this.selectionJournal.get(result.headRevisionId) ?? [] };
  }

  /** Undo to a specific ancestor revision. */
  async undoToRevision(
    revisionId: string,
  ): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch) return null;
    const result = await undoTo(
      this.store,
      this.documentId,
      this.attachedBranch.branchId,
      revisionId,
    );
    this.headRevisionId = result.headRevisionId;
    this.redoTarget = result.redoTargetRevisionId || null;
    const revision = await this.store.getRevision(this.documentId, result.headRevisionId);
    const document = await this.loadCachedDocument(result.headRevisionId, revision);
    return { document, selection: this.selectionJournal.get(result.headRevisionId) ?? [] };
  }

  /** Preserve abandoned redo paths as a named branch (never delete them). */
  async materializeDivergence(name?: string): Promise<BranchRef | null> {
    if (!this.attachedBranch) return null;
    return materializeDivergenceBranch(this.store, this.documentId, this.attachedBranch.branchId, {
      name,
    });
  }

  // ── Navigation / preview ────────────────────────────────────────────────────

  /** Load a revision's document WITHOUT moving the branch head (preview). */
  async loadRevisionDocument(revisionId: string): Promise<Document | null> {
    const revision = await this.store.getRevision(this.documentId, revisionId);
    if (!revision) return null;
    return this.loadCachedDocument(revisionId, revision);
  }

  /** Move the working head to an existing revision (explicit checkout). */
  async checkout(revisionId: string): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch) return null;
    const target = await this.store.getRevision(this.documentId, revisionId);
    if (!target) return null;
    await moveBranchHead(this.store, this.documentId, this.attachedBranch.branchId, revisionId);
    this.headRevisionId = revisionId;
    if (this.redoTarget === revisionId) this.redoTarget = null;
    const document = await this.loadCachedDocument(revisionId, target);
    return { document, selection: this.selectionJournal.get(revisionId) ?? [] };
  }

  // ── Checkpoints (ADR-0023) ──────────────────────────────────────────────────

  async checkpoints(): Promise<CheckpointRef[]> {
    return this.store.listCheckpoints(this.documentId);
  }

  async addCheckpoint(
    name: string,
    opts: { description?: string; pinned?: boolean } = {},
  ): Promise<CheckpointRef | null> {
    const validation = validateCheckpointName(name);
    if (!validation.valid) throw new Error(validation.reason ?? 'invalid checkpoint name');
    if (!this.headRevisionId) return null;
    return createCheckpoint(this.store, this.documentId, this.headRevisionId, name, opts);
  }

  async renameCheckpoint(checkpointId: string, name: string): Promise<CheckpointRef | null> {
    const validation = validateCheckpointName(name);
    if (!validation.valid) throw new Error(validation.reason ?? 'invalid checkpoint name');
    const checkpoint = await this.store.getCheckpoint(this.documentId, checkpointId);
    if (!checkpoint) return null;
    const next: CheckpointRef = { ...checkpoint, name };
    await this.store.putCheckpoint(next);
    return next;
  }

  async setCheckpointPinned(checkpointId: string, pinned: boolean): Promise<CheckpointRef | null> {
    const checkpoint = await this.store.getCheckpoint(this.documentId, checkpointId);
    if (!checkpoint) return null;
    const next: CheckpointRef = { ...checkpoint, pinned };
    await this.store.putCheckpoint(next);
    return next;
  }

  async deleteCheckpoint(checkpointId: string): Promise<boolean> {
    const checkpoint = await this.store.getCheckpoint(this.documentId, checkpointId);
    if (!checkpoint) return false;
    await this.store.deleteCheckpoint?.(checkpointId);
    return true;
  }

  // ── Branches ────────────────────────────────────────────────────────────────

  async branches(): Promise<BranchRef[]> {
    return this.store.listBranches(this.documentId);
  }

  async createBranch(name: string, fromRevisionId?: string): Promise<BranchRef | null> {
    const validation = validateBranchName(name);
    if (!validation.valid) throw new Error(validation.reason ?? 'invalid branch name');
    await this.lastCapturePromise;
    const branches = await this.store.listBranches(this.documentId);
    if (branches.some((b) => b.name === name)) {
      throw new Error(`branch name already exists: ${name}`);
    }
    const targetRevisionId = fromRevisionId ?? this.headRevisionId;
    if (!targetRevisionId) return null;
    const target = await this.store.getRevision(this.documentId, targetRevisionId);
    if (!target) return null;
    const branch: BranchRef = {
      branchId: mintHistoryId('b'),
      documentId: this.documentId,
      name,
      headRevisionId: targetRevisionId,
      createdFromRevisionId: targetRevisionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'active',
    };
    await this.store.putBranch(branch);
    return branch;
  }

  /** Switch the working branch: load its head document. */
  async switchBranch(
    branchId: string,
  ): Promise<{ document: Document; selection: NodeId[] } | null> {
    await this.lastCapturePromise;
    const branch = await this.store.getBranch(this.documentId, branchId);
    if (!branch) return null;
    const head = await this.store.getRevision(this.documentId, branch.headRevisionId);
    if (!head) return null;
    this.attachedBranch = branch;
    this.headRevisionId = branch.headRevisionId;
    this.redoTarget = null;
    const document = await this.loadCachedDocument(branch.headRevisionId, head);
    return { document, selection: this.selectionJournal.get(branch.headRevisionId) ?? [] };
  }

  async renameBranch(branchId: string, name: string): Promise<BranchRef | null> {
    const validation = validateBranchName(name);
    if (!validation.valid) throw new Error(validation.reason ?? 'invalid branch name');
    const branch = await this.store.getBranch(this.documentId, branchId);
    if (!branch) return null;
    const siblings = await this.store.listBranches(this.documentId);
    if (siblings.some((b) => b.branchId !== branchId && b.name === name)) {
      throw new Error(`branch name already exists: ${name}`);
    }
    const next: BranchRef = { ...branch, name };
    await this.store.putBranch(next);
    if (this.attachedBranch?.branchId === branchId) this.attachedBranch = next;
    return next;
  }

  async archiveBranch(branchId: string): Promise<BranchRef | null> {
    return this.setBranchStatus(branchId, 'archived');
  }

  async restoreBranch(branchId: string): Promise<BranchRef | null> {
    return this.setBranchStatus(branchId, 'active');
  }

  /** Delete a branch only when safe (ADR-0023 protection): never the
   *  attached branch, never the last branch, never a branch whose head has
   *  revisions not reachable from any other branch. */
  async deleteBranch(branchId: string): Promise<boolean> {
    const branch = await this.store.getBranch(this.documentId, branchId);
    if (!branch) return false;
    if (this.attachedBranch?.branchId === branchId) return false;
    const branches = await this.store.listBranches(this.documentId);
    if (branches.length <= 1) return false;
    const others = branches.filter((b) => b.branchId !== branchId);
    // The branch may be deleted only when EVERY other branch reaches its
    // head (its revisions remain reachable through the others).
    for (const other of others) {
      if (!(await this.reaches(other.headRevisionId, branch.headRevisionId))) {
        return false; // unique work — protected
      }
    }
    await this.store.deleteBranch?.(branchId);
    return true;
  }

  private async setBranchStatus(
    branchId: string,
    status: BranchRef['status'],
  ): Promise<BranchRef | null> {
    const branch = await this.store.getBranch(this.documentId, branchId);
    if (!branch) return null;
    const next: BranchRef = { ...branch, status };
    await this.store.putBranch(next);
    if (this.attachedBranch?.branchId === branchId) this.attachedBranch = next;
    return next;
  }

  // ── History view ────────────────────────────────────────────────────────────

  /** First-parent step rows oldest → newest with markers. */
  async steps(): Promise<HistoryStepView[]> {
    if (!this.attachedBranch || !this.headRevisionId) return [];
    const chain = await this.firstParentChainFrom(this.headRevisionId);
    const checkpoints = await this.store.listCheckpoints(this.documentId);
    const branches = await this.store.listBranches(this.documentId);
    const headId = this.headRevisionId;
    return chain.map((revision, i) => ({
      revision,
      label: revision.semanticSummary.label,
      kind: revision.semanticSummary.kind,
      origin: revision.origin,
      affectedEntityCount: revision.semanticSummary.affectedEntityIds.length,
      isHead: revision.revisionId === headId,
      checkpointNames: checkpoints
        .filter((c) => c.revisionId === revision.revisionId)
        .map((c) => c.name),
      branchHeadNames: branches
        .filter((b) => b.headRevisionId === revision.revisionId)
        .map((b) => b.name),
      stepsBack: chain.length - 1 - i,
    }));
  }

  private async firstParentChainFrom(headRevisionId: string): Promise<RevisionRecord[]> {
    const chain: RevisionRecord[] = [];
    let currentId: string | undefined = headRevisionId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const revision = await this.store.getRevision(this.documentId, currentId);
      if (!revision) break;
      chain.push(revision);
      currentId = revision.parentRevisionIds[0];
    }
    chain.reverse();
    return chain;
  }

  /** Semantic diff between two revisions (for the comparison workspace). */
  async compareRevision(baseRevisionId: string, targetRevisionId: string) {
    const baseDoc = await this.loadRevisionDocument(baseRevisionId);
    const targetDoc = await this.loadRevisionDocument(targetRevisionId);
    if (!baseDoc || !targetDoc) return null;
    return diffDocuments(baseDoc, targetDoc);
  }

  /** Three-way merge of this branch with another; returns the merge result
   *  without touching any branch head (application is the caller's job). */
  async mergeWithBranch(theirsBranchId: string): Promise<MergeResult | null> {
    await this.lastCapturePromise;
    if (!this.attachedBranch) return null;
    const merged = await findBranchMergeBase(
      this.store,
      this.documentId,
      this.attachedBranch.branchId,
      theirsBranchId,
    );
    if (!merged) return null;
    const baseDoc = await this.loadCachedDocument(merged.base.revisionId, merged.base);
    const oursDoc = await this.loadCachedDocument(merged.oursHead.revisionId, merged.oursHead);
    const theirsDoc = await this.loadCachedDocument(
      merged.theirsHead.revisionId,
      merged.theirsHead,
    );
    return mergeDocuments(baseDoc, oursDoc, theirsDoc);
  }

  /**
   * Complete a three-way merge of the attached branch with another branch.
   * A clean merge commits a two-parent revision immediately. A conflicted
   * merge applies the given per-conflict resolutions (M12) and commits with
   * the remaining unresolved count; conflicts the resolver cannot apply are
   * returned for the UI to keep resolving. Failed or invalid merges never
   * move the branch head.
   */
  async completeMerge(
    theirsBranchId: string,
    resolutions: MergeResolution[] = [],
  ): Promise<{
    status: 'clean' | 'conflicted' | 'invalid' | 'error';
    revision?: RevisionRecord;
    conflicts?: MergeConflict[];
    warnings: string[];
  }> {
    await this.lastCapturePromise;
    if (!this.attachedBranch) return { status: 'error', warnings: ['no attached branch'] };
    const merged = await findBranchMergeBase(
      this.store,
      this.documentId,
      this.attachedBranch.branchId,
      theirsBranchId,
    );
    if (!merged) {
      return { status: 'error', warnings: ['no merge base found (unrelated histories?)'] };
    }
    const baseDoc = await this.loadCachedDocument(merged.base.revisionId, merged.base);
    const oursDoc = await this.loadCachedDocument(merged.oursHead.revisionId, merged.oursHead);
    const theirsDoc = await this.loadCachedDocument(
      merged.theirsHead.revisionId,
      merged.theirsHead,
    );
    const result = mergeDocuments(baseDoc, oursDoc, theirsDoc);
    const warnings = [...result.warnings];

    if (result.status === 'clean') {
      const revision = await commitMergeRevision(this.store, {
        documentId: this.documentId,
        branchId: this.attachedBranch.branchId,
        baseRevisionId: merged.base.revisionId,
        oursRevisionId: merged.oursHead.revisionId,
        theirsRevisionId: merged.theirsHead.revisionId,
        mergedDocument: result.mergedDocument,
        conflictCount: 0,
        author: { actorId: this.actorId, kind: 'local-user' },
      });
      this.headRevisionId = revision.revisionId;
      this.redoTarget = null;
      this.undoableState = true;
      this.lastUndoLabelState = revision.semanticSummary.label;
      this.rememberDocument(revision.revisionId, result.mergedDocument);
      return { status: 'clean', revision, warnings };
    }

    if (result.status === 'conflicted') {
      if (result.invalid) {
        return { status: 'invalid', conflicts: result.conflicts, warnings };
      }
      const validated = validateMergeResolutions(result.conflicts, resolutions);
      if (!validated.valid) {
        return {
          status: 'conflicted',
          conflicts: result.conflicts,
          warnings: [...warnings, ...validated.errors],
        };
      }
      const resolved = applyMergeResolutions(result.mergedDocument, result.conflicts, resolutions);
      warnings.push(...resolved.warnings);
      if (resolved.unresolvedConflictIds.length > 0) {
        return {
          status: 'conflicted',
          conflicts: result.conflicts,
          warnings,
        };
      }
      if (!verifyResolvedDocument(resolved.document)) {
        return { status: 'invalid', conflicts: result.conflicts, warnings };
      }
      const revision = await commitMergeRevision(this.store, {
        documentId: this.documentId,
        branchId: this.attachedBranch.branchId,
        baseRevisionId: merged.base.revisionId,
        oursRevisionId: merged.oursHead.revisionId,
        theirsRevisionId: merged.theirsHead.revisionId,
        mergedDocument: resolved.document,
        conflictCount: 0,
        author: { actorId: this.actorId, kind: 'local-user' },
        note: 'Merge conflicts resolved in the Varve conflict resolver',
      });
      this.headRevisionId = revision.revisionId;
      this.redoTarget = null;
      this.undoableState = true;
      this.lastUndoLabelState = revision.semanticSummary.label;
      this.rememberDocument(revision.revisionId, resolved.document);
      return { status: 'clean', revision, warnings };
    }

    return { status: 'invalid', conflicts: result.conflicts, warnings };
  }

  /** Integrity check over the whole persisted history. */
  async integrity(): Promise<HistoryIssue[]> {
    const issues = await validateHistory(this.store, this.documentId);
    const graph = await validateRevisionGraph(this.store, this.documentId);
    return [...issues, ...graph];
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async loadCachedDocument(
    revisionId: string,
    revision: RevisionRecord | null,
  ): Promise<Document> {
    const cached = this.documentCache.get(revisionId);
    if (cached) return cached;
    if (!revision) {
      throw new Error(`revision not found: ${revisionId}`);
    }
    const document = await loadDocumentAt(this.store, this.documentId, revisionId);
    this.rememberDocument(revisionId, document);
    return document;
  }

  private rememberDocument(revisionId: string, document: Document): void {
    if (this.documentCache.has(revisionId)) {
      this.cacheOrder = this.cacheOrder.filter((id) => id !== revisionId);
    }
    this.documentCache.set(revisionId, document);
    this.cacheOrder.push(revisionId);
    while (this.cacheOrder.length > MAX_DOCUMENT_CACHE_ENTRIES) {
      const oldest = this.cacheOrder.shift();
      if (oldest) this.documentCache.delete(oldest);
    }
  }

  /** Record the selection for a revision at capture time (bounded journal). */
  rememberSelection(revisionId: string, selection: NodeId[]): void {
    if (this.selectionJournal.size >= MAX_SELECTION_JOURNAL_ENTRIES) {
      const oldest = this.selectionJournal.keys().next().value;
      if (oldest !== undefined) this.selectionJournal.delete(oldest);
    }
    this.selectionJournal.set(revisionId, [...selection]);
  }

  /** True when `from` reaches `target` through parent edges (BFS). */
  private async reaches(fromRevisionId: string, targetRevisionId: string): Promise<boolean> {
    if (fromRevisionId === targetRevisionId) return true;
    const visited = new Set<string>();
    const queue = [fromRevisionId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const revision = await this.store.getRevision(this.documentId, currentId);
      if (!revision) continue;
      for (const parentId of revision.parentRevisionIds) {
        if (parentId === targetRevisionId) return true;
        if (!visited.has(parentId)) queue.push(parentId);
      }
    }
    return false;
  }
}
