/**
 * Revision-based undo/redo navigation (ADR-0019 Model A core, M7).
 *
 * The undo stack IS the revision DAG: there is no separate mutable undo
 * stack. Undo moves the branch head to the first parent of the current
 * head; redo moves it back to a previously abandoned child. New edits
 * after an undo attach a new revision to the current position, leaving
 * the abandoned descendants reachable in the DAG — never deleted.
 *
 * This module is the pure store-level core. Editor wiring (command
 * binding, keyboard shortcuts, interaction with the in-memory undo stack)
 * is a follow-up; see ADR-0019 and docs/architecture/persistent-history.md.
 */
import { type HistoryStore, mintHistoryId } from './store';
import type { BranchRef, RevisionRecord } from './types';

export interface UndoError extends Error {
  code: 'no-parent' | 'no-such-branch' | 'no-such-revision' | 'not-a-child' | 'invalid-arg';
}

function undoError(code: UndoError['code'], message: string): UndoError {
  return Object.assign(new Error(message), { code });
}

/**
 * Walk the first-parent chain from a revision up to genesis.
 * Returns the chain oldest → newest, including the head revision.
 */
export async function firstParentChain(
  store: HistoryStore,
  documentId: string,
  headRevisionId: string,
): Promise<RevisionRecord[]> {
  const chain: RevisionRecord[] = [];
  let currentId: string | undefined = headRevisionId;
  while (currentId) {
    const revision = await store.getRevision(documentId, currentId);
    if (!revision) break;
    chain.push(revision);
    currentId = revision.parentRevisionIds[0];
  }
  chain.reverse();
  return chain;
}

/**
 * Full revision history of a branch (oldest → newest). For merge revisions
 * the first parent is followed, so the history is linear even though the
 * graph is not.
 */
export async function branchHistory(
  store: HistoryStore,
  documentId: string,
  branchId: string,
): Promise<{ branch: BranchRef; revisions: RevisionRecord[] }> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  const revisions = await firstParentChain(store, documentId, branch.headRevisionId);
  return { branch, revisions };
}

/**
 * Undo one revision: move the branch head to the first parent of the
 * current head. Returns null when the head is genesis (nothing to undo).
 */
export async function undoRevision(
  store: HistoryStore,
  documentId: string,
  branchId: string,
): Promise<{ headRevisionId: string; redoTargetRevisionId: string } | null> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  const head = await store.getRevision(documentId, branch.headRevisionId);
  if (!head)
    throw undoError('no-such-revision', `head revision does not exist: ${branch.headRevisionId}`);
  const parentId = head.parentRevisionIds[0];
  if (!parentId) return null; // genesis — nothing to undo
  await moveBranchHeadUnchecked(store, documentId, branchId, parentId);
  return { headRevisionId: parentId, redoTargetRevisionId: head.revisionId };
}

/**
 * Redo: move the branch head back to a previously abandoned child of the
 * current head (the redo target returned by a prior `undoRevision`).
 * Validates that the target is a direct child of the current head.
 */
export async function redoRevision(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  redoTargetRevisionId: string,
): Promise<{ headRevisionId: string }> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  const head = await store.getRevision(documentId, branch.headRevisionId);
  if (!head)
    throw undoError('no-such-revision', `head revision does not exist: ${branch.headRevisionId}`);
  const target = await store.getRevision(documentId, redoTargetRevisionId);
  if (!target)
    throw undoError('no-such-revision', `redo target does not exist: ${redoTargetRevisionId}`);
  if (target.parentRevisionIds[0] !== head.revisionId) {
    throw undoError(
      'not-a-child',
      `redo target ${redoTargetRevisionId} is not a child of head ${head.revisionId}`,
    );
  }
  await moveBranchHeadUnchecked(store, documentId, branchId, redoTargetRevisionId);
  return { headRevisionId: redoTargetRevisionId };
}

/**
 * Undo N revisions in one call. Each step returns the redo target of the
 * immediately previous head; the final redo target is the head the branch
 * had before the first undo. Stops early at genesis.
 */
export async function undoN(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  count: number,
): Promise<{ headRevisionId: string; redoTargetRevisionId: string; appliedSteps: number }> {
  if (!Number.isInteger(count) || count < 0) {
    throw undoError('invalid-arg', 'undo count must be a non-negative integer');
  }
  let appliedSteps = 0;
  let redoTargetRevisionId = '';
  let headRevisionId = '';
  for (let i = 0; i < count; i++) {
    const result = await undoRevision(store, documentId, branchId);
    if (!result) break;
    redoTargetRevisionId = result.redoTargetRevisionId;
    headRevisionId = result.headRevisionId;
    appliedSteps += 1;
  }
  if (appliedSteps === 0) {
    const branch = await store.getBranch(documentId, branchId);
    headRevisionId = branch?.headRevisionId ?? '';
  }
  return { headRevisionId, redoTargetRevisionId, appliedSteps };
}

/**
 * Undo to a specific revision, walking the first-parent chain.
 * The target must be an ancestor of the current head.
 */
export async function undoTo(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  targetRevisionId: string,
): Promise<{ headRevisionId: string; redoTargetRevisionId: string; steps: number }> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  if (branch.headRevisionId === targetRevisionId) {
    return { headRevisionId: targetRevisionId, redoTargetRevisionId: targetRevisionId, steps: 0 };
  }
  const target = await store.getRevision(documentId, targetRevisionId);
  if (!target)
    throw undoError('no-such-revision', `target revision does not exist: ${targetRevisionId}`);
  const chain = await firstParentChain(store, documentId, branch.headRevisionId);
  const targetIndex = chain.findIndex((revision) => revision.revisionId === targetRevisionId);
  if (targetIndex === -1) {
    throw undoError(
      'not-a-child',
      `target ${targetRevisionId} is not an ancestor of branch head ${branch.headRevisionId}`,
    );
  }
  const previousHeadId = branch.headRevisionId;
  await moveBranchHeadUnchecked(store, documentId, branchId, targetRevisionId);
  return {
    headRevisionId: targetRevisionId,
    redoTargetRevisionId: previousHeadId,
    steps: chain.length - 1 - targetIndex,
  };
}

/**
 * Revisions reachable from the branch head that are NOT on the active
 * first-parent path: abandoned redo paths and divergence branches.
 */
export async function abandonedDescendants(
  store: HistoryStore,
  documentId: string,
  branchId: string,
): Promise<RevisionRecord[]> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  const all = await store.listRevisions(documentId);
  const active = new Set(
    (await firstParentChain(store, documentId, branch.headRevisionId)).map((r) => r.revisionId),
  );
  const byParent = new Map<string, RevisionRecord[]>();
  for (const revision of all) {
    if (active.has(revision.revisionId)) continue;
    for (const parentId of revision.parentRevisionIds) {
      if (active.has(parentId)) {
        const list = byParent.get(parentId) ?? [];
        list.push(revision);
        byParent.set(parentId, list);
      }
    }
  }
  const out: RevisionRecord[] = [];
  for (const list of byParent.values()) out.push(...list);
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Materialize an abandoned descendant path (a left-behind redo chain) as a
 * new branch. Returns null when there is nothing to materialize.
 */
export async function materializeDivergenceBranch(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  opts: { name?: string } = {},
): Promise<BranchRef | null> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  const abandoned = await abandonedDescendants(store, documentId, branchId);
  if (abandoned.length === 0) return null;
  const names = new Set((await store.listBranches(documentId)).map((b) => b.name));
  const name = opts.name ?? suggestDivergenceName(branch, abandoned, names);
  const created: BranchRef = {
    branchId: mintHistoryId('b'),
    documentId,
    name,
    headRevisionId: abandoned[abandoned.length - 1]!.revisionId,
    createdFromRevisionId: branch.headRevisionId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
  };
  await store.putBranch(created);
  return created;
}

function suggestDivergenceName(
  branch: BranchRef,
  abandoned: RevisionRecord[],
  existingNames: Set<string>,
): string {
  const head = abandoned[abandoned.length - 1]!;
  const stamp = new Date(head.createdAt).toISOString().slice(0, 10);
  let base = `${branch.name}-abandoned-${stamp}`;
  if (existingNames.has(base)) base = `${branch.name}-abandoned`;
  return uniqueBranchName(base, existingNames);
}

function uniqueBranchName(base: string, existingNames: Set<string>): string {
  if (!existingNames.has(base)) return base;
  for (let n = 2; n <= 99; n++) {
    const candidate = `${base}-${n}`;
    if (!existingNames.has(candidate)) return candidate;
  }
  return `${base}-${Math.floor(Date.now() % 10000)}`;
}

/** Unvalidated head move (callers above already validated). */
async function moveBranchHeadUnchecked(
  store: HistoryStore,
  documentId: string,
  branchId: string,
  headRevisionId: string,
): Promise<void> {
  const branch = await store.getBranch(documentId, branchId);
  if (!branch) throw undoError('no-such-branch', `branch does not exist: ${branchId}`);
  await store.putBranch({ ...branch, headRevisionId, updatedAt: Date.now() });
}
