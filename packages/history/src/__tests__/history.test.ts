/**
 * End-to-end history tests: log, revisions, replay, snapshots, recovery,
 * and legacy import against the memory store (M5+M6).
 */

import type { Document } from '@varve/scene';
import { canonicalHash, canonicalHistoryHash } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildEntityIndex, entityOperations } from '../entityIndex';
import { importLegacyVersions, validateImportedHistory } from '../legacyImport';
import { computeSegmentChecksum } from '../log';
import { recoverTail, validateHistory } from '../recovery';
import { replayAndVerify, replayToDocument, verifySegments } from '../replay';
import { buildRevision, createGenesisRevision, validateRevisionGraph } from '../revisions';
import {
  createSnapshot,
  DEFAULT_SNAPSHOT_POLICY,
  SnapshotScheduler,
  shouldSnapshot,
  snapshotToDocument,
} from '../snapshots';
import { commitRevision, createMemoryHistoryStore } from '../store';
import type { LogPosition } from '../types';
import { FIXTURE_NODE_ID, record, startDoc } from './fixtures';

const AUTHOR = { actorId: 'test-actor', kind: 'local-user' as const };

/** Commit one transaction: append ops, build revision, move branch head. */
async function commitTx(
  store: ReturnType<typeof createMemoryHistoryStore>,
  documentId: string,
  branchId: string,
  parentRevisionId: string,
  ops: ReturnType<typeof record>['operations'],
  document: Document,
  origin: 'edit' | 'undo' | 'redo' | 'revert' = 'edit',
  label = 'Edit',
): Promise<{ revisionId: string }> {
  const startPos = await store.appendOperations(documentId, ops);
  // End position: start advanced by ops.length (single-segment appends).
  const end: LogPosition = { segment: startPos.segment, offset: startPos.offset + ops.length };
  const revision = buildRevision({
    document,
    documentId,
    parentRevisionIds: [parentRevisionId],
    author: AUTHOR,
    origin,
    semanticSummary: {
      label,
      kind: 'modify',
      affectedEntityIds: ops.flatMap((o) => o.affectedEntityIds),
    },
    transactionId: `tx-${label}`,
    operationStart: startPos,
    operationEnd: end,
  });
  await commitRevision(store, {
    revision,
    moveBranchHead: { branchId, headRevisionId: revision.revisionId },
  });
  return { revisionId: revision.revisionId };
}

describe('log + store', () => {
  it('appends checksummed segments and advances the manifest atomically', async () => {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const r = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'A' }, 1);
    const pos = await store.appendOperations('doc-1', r.operations);
    expect(pos.segment).toBe(0);
    const manifest = await store.getManifest('doc-1');
    expect(manifest!.nextSegmentIndex).toBe(1);
    expect(manifest!.nextLogicalSequence).toBe(2);
    const segment = await store.getSegment('doc-1', 0);
    expect(segment!.checksum).toBe(computeSegmentChecksum(segment!));
    expect(await verifySegments(store, 'doc-1')).toEqual([]);
    expect(document.nodes[FIXTURE_NODE_ID]).toBeDefined();
  });

  it('readOperations reads half-open ranges across segments', async () => {
    const store = createMemoryHistoryStore();
    const { recorder } = startDoc();
    const a = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'A' }, 1);
    const b = record(a, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'opacity', value: 0.5 }, 2);
    await store.appendOperations('doc-1', a.operations);
    await store.appendOperations('doc-1', b.operations);
    const read = await store.readOperations(
      'doc-1',
      { segment: 0, offset: 1 },
      { segment: 1, offset: 1 },
    );
    expect(read.length).toBe(1);
    expect(read[0]!.operationType).toBe('node.patch');
  });

  it('commitRevision moves a branch head with the revision', async () => {
    const store = createMemoryHistoryStore();
    const { document } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
      branchName: 'main',
    });
    const revision = buildRevision({
      document,
      documentId: 'doc-1',
      parentRevisionIds: [genesis.revisionId],
      author: AUTHOR,
      origin: 'edit',
      semanticSummary: { label: 'Move', kind: 'move', affectedEntityIds: ['n1_aaaa'] },
    });
    await commitRevision(store, {
      revision,
      moveBranchHead: { branchId: branch.branchId, headRevisionId: revision.revisionId },
    });
    const head = await store.getBranch('doc-1', branch.branchId);
    expect(head!.headRevisionId).toBe(revision.revisionId);
    // The checkpoint created in the same commit resolves.
    await commitRevision(store, {
      revision,
      createCheckpoint: {
        checkpointId: 'cp-1',
        documentId: 'doc-1',
        revisionId: revision.revisionId,
        name: 'Pin',
        pinned: true,
        createdAt: Date.now(),
      },
    });
    expect((await store.getCheckpoint('doc-1', 'cp-1'))!.pinned).toBe(true);
  });
});

describe('revision DAG', () => {
  it('genesis has zero parents, snapshot, and a branch', async () => {
    const store = createMemoryHistoryStore();
    const { document } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    expect(genesis.parentRevisionIds).toEqual([]);
    expect(genesis.origin).toBe('migration');
    expect(genesis.snapshotId).toBeTruthy();
    expect(branch.headRevisionId).toBe(genesis.revisionId);
    const snapshot = await store.getSnapshot('doc-1', genesis.snapshotId!);
    expect(snapshotToDocument(snapshot!).nodes[FIXTURE_NODE_ID]).toBeDefined();
  });

  it('rejects too many parents via validation', async () => {
    const store = createMemoryHistoryStore();
    const { document } = startDoc();
    const { genesis } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    const bad = buildRevision({
      document,
      documentId: 'doc-1',
      parentRevisionIds: [genesis.revisionId, 'r-y', 'r-z'],
      author: AUTHOR,
      origin: 'merge',
      semanticSummary: { label: 'Merge', kind: 'modify', affectedEntityIds: [] },
    });
    await store.putRevision(bad);
    const issues = await validateRevisionGraph(store, 'doc-1');
    expect(issues.some((i) => i.code === 'revision.too-many-parents')).toBe(true);
  });

  it('end-to-end: three transactions replay and verify', async () => {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });

    // Tx 1: move the rect.
    let r = record(recorder, 'node.move', { nodeId: FIXTURE_NODE_ID, toIndex: 0 }, 1);
    const tx1 = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      genesis.revisionId,
      r.operations,
      r.document,
      'edit',
      'Move',
    );

    // Tx 2: rename.
    r = record(r, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'Renamed' }, 2);
    const tx2 = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      tx1.revisionId,
      r.operations,
      r.document,
      'edit',
      'Rename',
    );

    // Tx 3: opacity patch.
    r = record(r, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'opacity', value: 0.5 }, 3);
    const tx3 = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      tx2.revisionId,
      r.operations,
      r.document,
      'edit',
      'Opacity',
    );

    const verify = await replayAndVerify(store, 'doc-1', tx3.revisionId);
    expect(verify.verified).toBe(true);
    expect(verify.appliedOperationCount).toBe(3);
    expect(verify.replayedFromRevisionId).toBe(genesis.revisionId);

    const live = await replayToDocument(store, 'doc-1', tx3.revisionId);
    expect((live.nodes[FIXTURE_NODE_ID] as { name?: string; opacity?: number }).name).toBe(
      'Renamed',
    );
    expect((live.nodes[FIXTURE_NODE_ID] as { opacity?: number }).opacity).toBe(0.5);
  });

  it('hash corruption is detected by replay verification', async () => {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    const r = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'X' }, 1);
    const tx = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      genesis.revisionId,
      r.operations,
      r.document,
    );
    // Corrupt the recorded hash.
    const revision = (await store.getRevision('doc-1', tx.revisionId))!;
    await store.putRevision({ ...revision, canonicalDocumentHash: 'deadbeef'.repeat(8) });
    const verify = await replayAndVerify(store, 'doc-1', tx.revisionId);
    expect(verify.verified).toBe(false);
  });

  it('replay is deterministic: identical ops produce identical hashes', async () => {
    const run = async (): Promise<string> => {
      const store = createMemoryHistoryStore();
      const { document, recorder } = startDoc();
      const { genesis, branch } = await createGenesisRevision(store, document, {
        documentId: 'doc-1',
        author: AUTHOR,
      });
      let r = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'Same' }, 1);
      const tx1 = await commitTx(
        store,
        'doc-1',
        branch.branchId,
        genesis.revisionId,
        r.operations,
        r.document,
      );
      r = record(r, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'shape.w', value: 33 }, 2);
      const tx2 = await commitTx(
        store,
        'doc-1',
        branch.branchId,
        tx1.revisionId,
        r.operations,
        r.document,
      );
      const live = await replayToDocument(store, 'doc-1', tx2.revisionId);
      return canonicalHash(live);
    };
    expect(await run()).toBe(await run());
  });

  it('snapshot-based replay: mid-history snapshot shortens the replay path', async () => {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    let r = record(recorder, 'node.move', { nodeId: FIXTURE_NODE_ID, toIndex: 0 }, 1);
    let tx = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      genesis.revisionId,
      r.operations,
      r.document,
    );

    // Snapshot at tx1 and attach it to tx1.
    await createSnapshot(store, r.document, { documentId: 'doc-1', revisionId: tx.revisionId });
    const tx1WithSnapshot = (await store.getRevision('doc-1', tx.revisionId))!;
    const snap = (await store.getSnapshot('doc-1', canonicalHistoryHash(r.document)))!;
    await store.putRevision({ ...tx1WithSnapshot, snapshotId: snap.canonicalHash });

    r = record(r, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'opacity', value: 0.25 }, 2);
    tx = await commitTx(store, 'doc-1', branch.branchId, tx.revisionId, r.operations, r.document);

    const verify = await replayAndVerify(store, 'doc-1', tx.revisionId);
    expect(verify.verified).toBe(true);
    expect(verify.replayedFromRevisionId).toBe(tx1WithSnapshot.revisionId);
    expect(verify.appliedOperationCount).toBe(1);
  });
});

describe('snapshot scheduling (M6)', () => {
  it('shouldSnapshot respects thresholds and checkpoint/shutdown flags', () => {
    const policy = DEFAULT_SNAPSHOT_POLICY;
    expect(
      shouldSnapshot(
        {
          operationsSinceSnapshot: 5,
          replayedBytesSinceSnapshot: 0,
          replayMsSinceSnapshot: 0,
          atCheckpoint: false,
          atShutdown: false,
        },
        policy,
      ),
    ).toBe(false);
    expect(
      shouldSnapshot(
        {
          operationsSinceSnapshot: 1000,
          replayedBytesSinceSnapshot: 0,
          replayMsSinceSnapshot: 0,
          atCheckpoint: false,
          atShutdown: false,
        },
        policy,
      ),
    ).toBe(true);
    expect(
      shouldSnapshot(
        {
          operationsSinceSnapshot: 1,
          replayedBytesSinceSnapshot: 0,
          replayMsSinceSnapshot: 0,
          atCheckpoint: true,
          atShutdown: false,
        },
        policy,
      ),
    ).toBe(true);
    expect(
      shouldSnapshot(
        {
          operationsSinceSnapshot: 1,
          replayedBytesSinceSnapshot: 0,
          replayMsSinceSnapshot: 0,
          atCheckpoint: false,
          atShutdown: true,
        },
        policy,
      ),
    ).toBe(true);
    expect(
      shouldSnapshot(
        {
          operationsSinceSnapshot: 1,
          replayedBytesSinceSnapshot: 5_000_000,
          replayMsSinceSnapshot: 0,
          atCheckpoint: false,
          atShutdown: false,
        },
        policy,
      ),
    ).toBe(true);
  });

  it('SnapshotScheduler accumulates stats and resets when due', () => {
    const scheduler = new SnapshotScheduler({
      ...DEFAULT_SNAPSHOT_POLICY,
      minOperationsBetweenSnapshots: 3,
    });
    expect(
      scheduler.noteCommit({
        replayedBytesSinceSnapshot: 0,
        replayMsSinceSnapshot: 0,
        atCheckpoint: false,
        atShutdown: false,
      }),
    ).toBe(false);
    expect(
      scheduler.noteCommit({
        replayedBytesSinceSnapshot: 0,
        replayMsSinceSnapshot: 0,
        atCheckpoint: false,
        atShutdown: false,
      }),
    ).toBe(false);
    expect(
      scheduler.noteCommit({
        replayedBytesSinceSnapshot: 0,
        replayMsSinceSnapshot: 0,
        atCheckpoint: false,
        atShutdown: false,
      }),
    ).toBe(true);
    expect(scheduler.stats().operationsSinceSnapshot).toBe(0);
  });

  it('snapshots dedupe by canonical hash', async () => {
    const store = createMemoryHistoryStore();
    const { document } = startDoc();
    const a = await createSnapshot(store, document, { documentId: 'doc-1', revisionId: 'r-1' });
    const b = await createSnapshot(store, document, { documentId: 'doc-1', revisionId: 'r-2' });
    expect(a.canonicalHash).toBe(b.canonicalHash);
    expect(await store.getSnapshot('doc-1', a.canonicalHash)).not.toBeNull();
  });
});

describe('tail recovery and validation (M6)', () => {
  async function buildHistory() {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    let r = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'A' }, 1);
    let tx = await commitTx(
      store,
      'doc-1',
      branch.branchId,
      genesis.revisionId,
      r.operations,
      r.document,
    );
    r = record(r, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'opacity', value: 0.5 }, 2);
    tx = await commitTx(store, 'doc-1', branch.branchId, tx.revisionId, r.operations, r.document);
    return { store, genesis, branch, lastTx: tx };
  }

  it('corrupt tail segment is detected, truncated, and the head rewound', async () => {
    const { store, branch, lastTx } = await buildHistory();
    // Corrupt the last segment in place (tamper payload, keep old checksum).
    const segments = await store.listSegments('doc-1');
    const last = segments[segments.length - 1]!;
    const corrupted = {
      ...last,
      operations: [
        {
          ...last.operations[0]!,
          payload: {
            ...(last.operations[0]!.payload as Record<string, unknown>),
            name: 'TAMPERED',
          },
        },
      ],
    };
    await store.setSegments!('doc-1', [...segments.slice(0, -1), corrupted]);

    const report = await recoverTail(store, 'doc-1', { applyTruncation: true });
    expect(report.truncatedSegments.length).toBe(1);
    expect(report.discardedOperations).toBe(1);
    expect(report.lastKnownGoodRevisionId).toBeTruthy();
    const head = await store.getBranch('doc-1', branch.branchId);
    expect(head!.headRevisionId).toBe(report.lastKnownGoodRevisionId);
    expect(head!.headRevisionId).not.toBe(lastTx.revisionId);
    // Replay still verifies at the rewound head.
    const verify = await replayAndVerify(store, 'doc-1', head!.headRevisionId);
    expect(verify.verified).toBe(true);
  });

  it('dangling branch heads and missing checkpoints surface as issues', async () => {
    const { store } = await buildHistory();
    await store.putBranch({
      branchId: 'b-dangling',
      documentId: 'doc-1',
      name: 'broken',
      headRevisionId: 'r-does-not-exist',
      createdFromRevisionId: 'r-x',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
    const issues = await validateHistory(store, 'doc-1');
    expect(issues.some((i) => i.code === 'branch.dangling-head')).toBe(true);
  });

  it('validateHistory reports hash mismatch for ref-reachable revisions', async () => {
    const { store, lastTx } = await buildHistory();
    const revision = (await store.getRevision('doc-1', lastTx.revisionId))!;
    await store.putRevision({ ...revision, canonicalDocumentHash: '0'.repeat(64) });
    const issues = await validateHistory(store, 'doc-1');
    expect(issues.some((i) => i.code === 'revision.hash-mismatch')).toBe(true);
  });
});

describe('legacy version import (M6, ADR-0024)', () => {
  it('imports versions as snapshot revisions with dedupe and checkpoints', async () => {
    const store = createMemoryHistoryStore();
    const { document } = startDoc();
    // Encode the same content under two version ids (identical hash dedupes).
    const json = JSON.stringify(document);
    const result = await importLegacyVersions(
      store,
      [
        {
          id: 'v1',
          kind: 'named',
          name: 'Client review',
          pinned: true,
          timestamp: 1000,
          documentHash: 'h1',
        },
        { id: 'v2', kind: 'auto', timestamp: 2000, documentHash: 'h1' },
        { id: 'v3', kind: 'manual', timestamp: 3000, documentHash: 'h2' },
      ],
      {
        documentId: 'doc-1',
        author: AUTHOR,
        contentById: new Map([
          ['v1', json],
          ['v2', json],
          ['v3', 'not-json{'],
        ]),
      },
    );
    expect(result.revisions.length).toBe(1);
    expect(result.checkpoints.length).toBe(1);
    expect(result.checkpoints[0]!.name).toBe('Client review');
    expect(result.skipped.some((s) => s.versionId === 'v3')).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    // Imported revision is a parentless root with a snapshot.
    const revision = result.revisions[0]!;
    expect(revision.origin).toBe('import');
    expect(revision.parentRevisionIds).toEqual([]);
    expect(revision.snapshotId).toBeTruthy();
    // The snapshot document replays.
    const snapshot = (await store.getSnapshot('doc-1', revision.snapshotId!))!;
    expect(snapshotToDocument(snapshot).nodes[FIXTURE_NODE_ID]).toBeDefined();
    // validateImportedHistory accepts parentless imports.
    expect(validateImportedHistory(result.revisions)).toEqual([]);
  });
});

describe('entity index (M5)', () => {
  it('rebuilds entity → operation mapping and answers entity history', async () => {
    const store = createMemoryHistoryStore();
    const { document, recorder } = startDoc();
    const { genesis, branch } = await createGenesisRevision(store, document, {
      documentId: 'doc-1',
      author: AUTHOR,
    });
    let r = record(recorder, 'node.rename', { nodeId: FIXTURE_NODE_ID, name: 'A' }, 1);
    await commitTx(store, 'doc-1', branch.branchId, genesis.revisionId, r.operations, r.document);
    r = record(r, 'node.patch', { nodeId: FIXTURE_NODE_ID, path: 'opacity', value: 0.5 }, 2);
    await commitTx(store, 'doc-1', branch.branchId, genesis.revisionId, r.operations, r.document);

    const index = await buildEntityIndex(store, 'doc-1');
    expect(index.byEntity.get(FIXTURE_NODE_ID)!.length).toBeGreaterThanOrEqual(2);
    const opsForEntity = await entityOperations(store, 'doc-1', FIXTURE_NODE_ID);
    expect(opsForEntity.length).toBeGreaterThanOrEqual(2);
    expect(opsForEntity[0]!.operationType).toBe('node.rename');
  });
});
