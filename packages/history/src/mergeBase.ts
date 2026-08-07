/**
 * Merge-base discovery (ADR-0034, M11).
 *
 * The common ancestor for a branch merge is found by walking the two branch
 * heads' first-parent chains and intersecting them. This is deterministic
 * and safe: in criss-cross histories it may return an ancestor that is not
 * the minimal DAG intersection, which only makes the merge more conservative
 * (more conflicts, never silent data loss). Timestamps never participate.
 */
import type { HistoryStore } from './store';
import type { RevisionRecord } from './types';

/** Walk the first-parent chain oldest → newest from a head revision. */
async function firstParentChain(
  store: HistoryStore,
  documentId: string,
  headRevisionId: string,
): Promise<RevisionRecord[]> {
  const chain: RevisionRecord[] = [];
  let currentId: string | undefined = headRevisionId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const revision = await store.getRevision(documentId, currentId);
    if (!revision) break;
    chain.push(revision);
    currentId = revision.parentRevisionIds[0];
  }
  chain.reverse();
  return chain;
}

/**
 * Find the merge base of two revisions: the newest revision on the
 * intersection of their first-parent chains. Returns null when the two
 * revisions share no ancestor (unrelated histories — a conflict situation).
 */
export async function findMergeBase(
  store: HistoryStore,
  documentId: string,
  oursRevisionId: string,
  theirsRevisionId: string,
): Promise<RevisionRecord | null> {
  if (oursRevisionId === theirsRevisionId) {
    return store.getRevision(documentId, oursRevisionId);
  }
  const ours = await firstParentChain(store, documentId, oursRevisionId);
  const theirs = await firstParentChain(store, documentId, theirsRevisionId);
  const oursIndex = new Map(ours.map((revision, i) => [revision.revisionId, i]));
  // Walk theirs oldest → newest; the newest revision present in ours' chain
  // is the merge base (first-parent intersection is deterministic).
  for (let i = theirs.length - 1; i >= 0; i--) {
    const candidate = theirs[i]!;
    if (oursIndex.has(candidate.revisionId)) return candidate;
  }
  return null;
}

/** Find the merge base between two branches (resolves their heads). */
export async function findBranchMergeBase(
  store: HistoryStore,
  documentId: string,
  oursBranchId: string,
  theirsBranchId: string,
): Promise<{ base: RevisionRecord; oursHead: RevisionRecord; theirsHead: RevisionRecord } | null> {
  const oursBranch = await store.getBranch(documentId, oursBranchId);
  const theirsBranch = await store.getBranch(documentId, theirsBranchId);
  if (!oursBranch || !theirsBranch) return null;
  const oursHead = await store.getRevision(documentId, oursBranch.headRevisionId);
  const theirsHead = await store.getRevision(documentId, theirsBranch.headRevisionId);
  if (!oursHead || !theirsHead) return null;
  const base = await findMergeBase(store, documentId, oursHead.revisionId, theirsHead.revisionId);
  if (!base) return null;
  return { base, oursHead, theirsHead };
}
