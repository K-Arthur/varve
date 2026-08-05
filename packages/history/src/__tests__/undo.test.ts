/**
 * Undo/redo revision navigation tests (M7 core, ADR-0019).
 */

import type { Document } from '@varve/scene';
import { createDocument } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildRevision, createGenesisRevision } from '../revisions';
import { createMemoryHistoryStore } from '../store';
import {
  abandonedDescendants,
  branchHistory,
  firstParentChain,
  materializeDivergenceBranch,
  redoRevision,
  undoN,
  undoRevision,
  undoTo,
} from '../undo';

function emptyDoc(): Document {
  return { ...createDocument('undo-test', { flat: true }), id: 'undo-doc-001' } as Document;
}

const AUTHOR = { actorId: 'test', kind: 'local-user' as const };

interface Chain {
  store: ReturnType<typeof createMemoryHistoryStore>;
  documentId: string;
  branchId: string;
  revisionIds: string[];
}

/** Commit `count` edit revisions on a fresh branch, each a no-op doc change. */
async function commitChain(count: number): Promise<Chain> {
  const store = createMemoryHistoryStore();
  const documentId = 'undo-doc';
  let doc = emptyDoc();
  const { genesis, branch } = await createGenesisRevision(store, doc, {
    documentId,
    author: AUTHOR,
    branchName: 'main',
  });
  const branchId = branch.branchId;
  const revisionIds = [genesis.revisionId];
  let parentId = genesis.revisionId;
  for (let i = 0; i < count; i++) {
    doc = { ...doc, name: `Edit ${i + 1}` };
    const revision = buildRevision({
      documentId,
      parentRevisionIds: [parentId],
      document: doc,
      author: AUTHOR,
      origin: 'edit',
      semanticSummary: { label: 'Edit', affectedEntityIds: [], kind: 'modify' },
    });
    await store.commitRevision({
      revision,
      moveBranchHead: { branchId, headRevisionId: revision.revisionId },
    });
    revisionIds.push(revision.revisionId);
    parentId = revision.revisionId;
  }
  return { store, documentId, branchId, revisionIds };
}

describe('undoRevision', () => {
  it('moves the head to the first parent', async () => {
    const chain = await commitChain(3);
    const result = await undoRevision(chain.store, chain.documentId, chain.branchId);
    expect(result?.headRevisionId).toBe(chain.revisionIds[2]);
    expect(result?.redoTargetRevisionId).toBe(chain.revisionIds[3]);
    const branch = await chain.store.getBranch(chain.documentId, chain.branchId);
    expect(branch?.headRevisionId).toBe(chain.revisionIds[2]);
  });

  it('returns null at genesis', async () => {
    const chain = await commitChain(0);
    const result = await undoRevision(chain.store, chain.documentId, chain.branchId);
    expect(result).toBeNull();
  });

  it('throws for a missing branch', async () => {
    const chain = await commitChain(1);
    await expect(undoRevision(chain.store, chain.documentId, 'nope')).rejects.toThrow(
      /branch does not exist/,
    );
  });
});

describe('redoRevision', () => {
  it('moves the head back to the redo target', async () => {
    const chain = await commitChain(3);
    const undo = await undoRevision(chain.store, chain.documentId, chain.branchId);
    expect(undo).not.toBeNull();
    const result = await redoRevision(
      chain.store,
      chain.documentId,
      chain.branchId,
      undo!.redoTargetRevisionId,
    );
    expect(result.headRevisionId).toBe(chain.revisionIds[3]);
  });

  it('rejects a target that is not a child of the head', async () => {
    const chain = await commitChain(3);
    await undoRevision(chain.store, chain.documentId, chain.branchId);
    await expect(
      redoRevision(chain.store, chain.documentId, chain.branchId, chain.revisionIds[0]),
    ).rejects.toThrow(/not a child/);
  });
});

describe('undoN', () => {
  it('undoes multiple steps and reports the applied count', async () => {
    const chain = await commitChain(5);
    const result = await undoN(chain.store, chain.documentId, chain.branchId, 3);
    expect(result.appliedSteps).toBe(3);
    expect(result.headRevisionId).toBe(chain.revisionIds[2]);
    expect(result.redoTargetRevisionId).toBe(chain.revisionIds[3]);
  });

  it('stops early at genesis', async () => {
    const chain = await commitChain(2);
    const result = await undoN(chain.store, chain.documentId, chain.branchId, 10);
    expect(result.appliedSteps).toBe(2);
    expect(result.headRevisionId).toBe(chain.revisionIds[0]);
  });

  it('rejects negative counts', async () => {
    const chain = await commitChain(1);
    await expect(undoN(chain.store, chain.documentId, chain.branchId, -1)).rejects.toThrow(
      /non-negative/,
    );
  });
});

describe('undoTo', () => {
  it('moves to an ancestor revision', async () => {
    const chain = await commitChain(4);
    const result = await undoTo(
      chain.store,
      chain.documentId,
      chain.branchId,
      chain.revisionIds[1],
    );
    expect(result.headRevisionId).toBe(chain.revisionIds[1]);
    expect(result.steps).toBe(3);
    expect(result.redoTargetRevisionId).toBe(chain.revisionIds[4]);
  });

  it('rejects non-ancestor targets', async () => {
    const chain = await commitChain(3);
    await expect(
      undoTo(chain.store, chain.documentId, chain.branchId, 'r-ffffffff'),
    ).rejects.toThrow(/does not exist/);
  });

  it('is a no-op when already at the target', async () => {
    const chain = await commitChain(2);
    const result = await undoTo(
      chain.store,
      chain.documentId,
      chain.branchId,
      chain.revisionIds[2],
    );
    expect(result.steps).toBe(0);
    expect(result.headRevisionId).toBe(chain.revisionIds[2]);
  });
});

describe('history navigation', () => {
  it('firstParentChain returns oldest → newest', async () => {
    const chain = await commitChain(3);
    const chainRevs = await firstParentChain(chain.store, chain.documentId, chain.revisionIds[3]);
    expect(chainRevs.map((r) => r.revisionId)).toEqual(chain.revisionIds);
  });

  it('branchHistory returns the branch and its linear history', async () => {
    const chain = await commitChain(2);
    const { branch, revisions } = await branchHistory(
      chain.store,
      chain.documentId,
      chain.branchId,
    );
    expect(branch.branchId).toBe(chain.branchId);
    expect(revisions.map((r) => r.revisionId)).toEqual(chain.revisionIds);
  });

  it('abandonedDescendants finds the left-behind redo path after an undo + new edit', async () => {
    const chain = await commitChain(2);
    await undoRevision(chain.store, chain.documentId, chain.branchId);
    // a new edit after undo: child of the undo position
    const doc = emptyDoc();
    const revision = buildRevision({
      documentId: chain.documentId,
      parentRevisionIds: [chain.revisionIds[1]],
      document: doc,
      author: AUTHOR,
      origin: 'edit',
      semanticSummary: { label: 'Edit', affectedEntityIds: [], kind: 'modify' },
    });
    await chain.store.commitRevision({
      revision,
      moveBranchHead: { branchId: chain.branchId, headRevisionId: revision.revisionId },
    });
    const abandoned = await abandonedDescendants(chain.store, chain.documentId, chain.branchId);
    expect(abandoned.map((r) => r.revisionId)).toEqual([chain.revisionIds[2]]);
  });

  it('materializeDivergenceBranch creates a branch at the abandoned path', async () => {
    const chain = await commitChain(2);
    await undoRevision(chain.store, chain.documentId, chain.branchId);
    const doc = emptyDoc();
    const revision = buildRevision({
      documentId: chain.documentId,
      parentRevisionIds: [chain.revisionIds[1]],
      document: doc,
      author: AUTHOR,
      origin: 'edit',
      semanticSummary: { label: 'Edit', affectedEntityIds: [], kind: 'modify' },
    });
    await chain.store.commitRevision({
      revision,
      moveBranchHead: { branchId: chain.branchId, headRevisionId: revision.revisionId },
    });
    const branch = await materializeDivergenceBranch(chain.store, chain.documentId, chain.branchId);
    expect(branch).not.toBeNull();
    expect(branch?.headRevisionId).toBe(chain.revisionIds[2]);
    expect(branch?.createdFromRevisionId).toBe(revision.revisionId);
    expect(branch?.name).toContain('abandoned');
  });

  it('materializeDivergenceBranch returns null when nothing is abandoned', async () => {
    const chain = await commitChain(2);
    const branch = await materializeDivergenceBranch(chain.store, chain.documentId, chain.branchId);
    expect(branch).toBeNull();
  });
});
