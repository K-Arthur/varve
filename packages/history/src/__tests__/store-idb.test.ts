/**
 * IndexedDB HistoryStore backend tests (ADR-0020 atomicity, M5/M6 storage).
 *
 * Covers: atomic append (manifest + segment together), cross-segment reads,
 * atomic commitRevision (revision + branch head + checkpoint in one
 * transaction), failure injection (aborted append must not be observable),
 * persistence across store instances (reload simulation), and tail
 * truncation via setSegments.
 *
 * `indexedDB` is provided globally by the vitest setup (fake-indexeddb).
 */
import 'fake-indexeddb/auto';
import type { IDBPDatabase } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { verifySegmentChecksum } from '../log';
import type { SnapshotRecord } from '../snapshots';
import { createIndexedDbHistoryStore, openHistoryDb } from '../store-idb';
import type { BranchRef, CheckpointRef, RevisionRecord, StoredOperation } from '../types';

const openConnections: IDBPDatabase[] = [];

async function newStore(faults: { failOnAppend?: boolean } = {}) {
  const db = await openHistoryDb();
  openConnections.push(db);
  return createIndexedDbHistoryStore(db, faults);
}

afterEach(() => {
  for (const db of openConnections.splice(0)) db.close();
});

/** Fresh document id per test so the shared fake IndexedDB never leaks state. */
let docCounter = 0;
function freshDocId(): string {
  docCounter += 1;
  return `idb-test-doc-${docCounter}`;
}

function op(sequence: number, type = 'node.patch'): StoredOperation {
  return {
    operationId: `op-${sequence}`,
    operationType: type,
    schemaVersion: 1,
    logicalSequence: sequence,
    affectedEntityIds: ['n1_aaaa'],
    payload: { nodeId: 'n1_aaaa', path: 'opacity', value: 0.5 },
  };
}

function revision(documentId: string, overrides: Partial<RevisionRecord> = {}): RevisionRecord {
  return {
    revisionId: 'r-00000000000000000000000000000001',
    documentId,
    parentRevisionIds: [],
    canonicalDocumentHash: 'a'.repeat(64),
    author: { actorId: 'actor-1', kind: 'local-user' },
    semanticSummary: { label: 'Genesis', kind: 'create', affectedEntityIds: [] },
    createdAt: 1,
    schemaVersion: 1,
    origin: 'migration',
    ...overrides,
  };
}

describe('IndexedDB HistoryStore', () => {
  it('appends operations with sequential logical sequences and verified checksums', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    const position = await store.appendOperations(DOC_ID, [op(0), op(0), op(0)]);
    expect(position).toEqual({ segment: 0, offset: 0 });

    const manifest = await store.getManifest(DOC_ID);
    expect(manifest?.nextLogicalSequence).toBe(4);
    expect(manifest?.nextSegmentIndex).toBe(1);

    const segments = await store.listSegments(DOC_ID);
    expect(segments).toHaveLength(1);
    expect(verifySegmentChecksum(segments[0]!)).toBeNull();
    expect(segments[0]!.operations.map((o) => o.logicalSequence)).toEqual([1, 2, 3]);

    const read = await store.readOperations(
      DOC_ID,
      { segment: 0, offset: 0 },
      { segment: 0, offset: 2 },
    );
    expect(read.map((o) => o.logicalSequence)).toEqual([1, 2]);
  });

  it('reads across segment boundaries', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    await store.appendOperations(DOC_ID, [op(0)]);
    await store.appendOperations(DOC_ID, [op(0), op(0)]);
    await store.appendOperations(DOC_ID, [op(0)]);
    const segments = await store.listSegments(DOC_ID);
    expect(segments).toHaveLength(3);
    const read = await store.readOperations(
      DOC_ID,
      { segment: 0, offset: 0 },
      { segment: 2, offset: 1 },
    );
    expect(read.map((o) => o.logicalSequence)).toEqual([1, 2, 3, 4]);
  });

  it('commits revision, branch head, and checkpoint atomically', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    await store.putBranch({
      branchId: 'b-main',
      documentId: DOC_ID,
      name: 'main',
      headRevisionId: 'r-genesis',
      createdFromRevisionId: 'r-genesis',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
    const checkpoint: CheckpointRef = {
      checkpointId: 'c-1',
      documentId: DOC_ID,
      revisionId: 'r-next',
      name: 'Client review 2',
      pinned: true,
      createdAt: 2,
    };
    const rev = revision(DOC_ID, {
      revisionId: 'r-next',
      parentRevisionIds: ['r-genesis'],
      origin: 'edit',
      createdAt: 2,
    });
    const result = await store.commitRevision({
      revision: rev,
      moveBranchHead: { branchId: 'b-main', headRevisionId: 'r-next' },
      createCheckpoint: checkpoint,
    });
    expect(result.branchHead?.headRevisionId).toBe('r-next');

    const branch = await store.getBranch(DOC_ID, 'b-main');
    expect(branch?.headRevisionId).toBe('r-next');
    expect(branch?.status).toBe('active');
    const stored = await store.getRevision(DOC_ID, 'r-next');
    expect(stored?.canonicalDocumentHash).toBe('a'.repeat(64));
    const storedCheckpoint = await store.getCheckpoint(DOC_ID, 'c-1');
    expect(storedCheckpoint?.name).toBe('Client review 2');
  });

  it('creates a branch atomically with a revision', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    const branch: BranchRef = {
      branchId: 'b-alt',
      documentId: DOC_ID,
      name: 'Typography experiment',
      headRevisionId: 'r-alt',
      createdFromRevisionId: 'r-genesis',
      createdAt: 2,
      updatedAt: 2,
      status: 'active',
    };
    await store.commitRevision({
      revision: revision(DOC_ID, { revisionId: 'r-alt', createdAt: 2 }),
      createBranch: branch,
    });
    expect((await store.listBranches(DOC_ID)).map((b) => b.name)).toEqual([
      'Typography experiment',
    ]);
  });

  it('survives an aborted append (failure injection)', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    await store.appendOperations(DOC_ID, [op(0)]);

    // Attempt an append that throws mid-transaction; idb aborts it.
    const db2 = await openHistoryDb();
    openConnections.push(db2);
    const failing = createIndexedDbHistoryStore(db2, { failOnAppend: true });
    await expect(failing.appendOperations(DOC_ID, [op(0), op(0), op(0)])).rejects.toBeTruthy();

    const manifest = await store.getManifest(DOC_ID);
    expect(manifest?.nextLogicalSequence).toBe(2);
    const segments = await store.listSegments(DOC_ID);
    expect(segments).toHaveLength(1);
    const read = await store.readOperations(
      DOC_ID,
      { segment: 0, offset: 0 },
      { segment: 0, offset: 10 },
    );
    expect(read.map((o) => o.logicalSequence)).toEqual([1]);
  });

  it('persists across store instances (reload simulation)', async () => {
    const DOC_ID = freshDocId();
    const db = await openHistoryDb();
    openConnections.push(db);
    const first = createIndexedDbHistoryStore(db);
    await first.appendOperations(DOC_ID, [op(0)]);
    await first.commitRevision({
      revision: revision(DOC_ID, { revisionId: 'r-reload', createdAt: 3 }),
      createBranch: {
        branchId: 'b-main',
        documentId: DOC_ID,
        name: 'main',
        headRevisionId: 'r-reload',
        createdFromRevisionId: 'r-reload',
        createdAt: 3,
        updatedAt: 3,
        status: 'active',
      },
    });

    const second = createIndexedDbHistoryStore(db);
    const segments = await second.listSegments(DOC_ID);
    expect(segments).toHaveLength(1);
    const rev = await second.getRevision(DOC_ID, 'r-reload');
    expect(rev?.revisionId).toBe('r-reload');
    const branches = await second.listBranches(DOC_ID);
    expect(branches.find((b) => b.name === 'main')?.headRevisionId).toBe('r-reload');
  });

  it('stores and dedupes content-addressed snapshots per document', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    const snapshot: SnapshotRecord = {
      canonicalHash: 'b'.repeat(64),
      documentId: DOC_ID,
      canonicalText: '{"id":"x"}',
      revisionId: 'r-snap',
      schemaVersion: 1,
      createdAt: 4,
    };
    await store.putSnapshot(snapshot);
    const sameHashDifferentDoc: SnapshotRecord = {
      ...snapshot,
      documentId: 'other-doc',
      revisionId: 'r-snap-2',
    };
    await store.putSnapshot(sameHashDifferentDoc);
    expect((await store.getSnapshot(DOC_ID, 'b'.repeat(64)))?.revisionId).toBe('r-snap');
    expect((await store.getSnapshot('other-doc', 'b'.repeat(64)))?.revisionId).toBe('r-snap-2');
  });

  it('truncates the log tail via setSegments (tail recovery)', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    await store.appendOperations(DOC_ID, [op(0), op(0)]);
    await store.appendOperations(DOC_ID, [op(0)]);
    const segments = await store.listSegments(DOC_ID);
    expect(segments).toHaveLength(2);
    const first = segments[0]!;
    await store.setSegments!(DOC_ID, [first]);
    const after = await store.listSegments(DOC_ID);
    expect(after).toHaveLength(1);
    const manifest = await store.getManifest(DOC_ID);
    expect(manifest?.nextSegmentIndex).toBe(1);
  });

  it('stores and lists recovery refs in creation order', async () => {
    const DOC_ID = freshDocId();
    const store = await newStore();
    await store.putRecoveryRef({
      recoveryId: 'rec-2',
      documentId: DOC_ID,
      revisionId: 'r-2',
      createdAt: 20,
    });
    await store.putRecoveryRef({
      recoveryId: 'rec-1',
      documentId: DOC_ID,
      revisionId: 'r-1',
      createdAt: 10,
    });
    const refs = await store.listRecoveryRefs(DOC_ID);
    expect(refs.map((r) => r.recoveryId)).toEqual(['rec-1', 'rec-2']);
  });
});
