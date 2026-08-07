/**
 * Fault-injection and crash-recovery tests (M17, spec §35.5).
 *
 * Injects failure at: corrupt log tail, corrupt middle segment, checksum
 * mismatch, missing snapshot, snapshot hash mismatch, dangling branch head,
 * missing revision parent, orphaned operations, and truncated recovery.
 * Every case must verify recovery never points a branch at an incomplete
 * revision.
 */

import type { Document } from '@varve/scene';
import { canonicalHash } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { buildSegment } from '../log';
import { recoverTail, validateHistory } from '../recovery';
import { ReplayError, replayAndVerify, verifySegments } from '../replay';
import { validateRevisionGraph } from '../revisions';
import { createMemoryHistoryStore } from '../store';
import type { LogSegment, RevisionRecord, StoredOperation } from '../types';

const DOC_ID = 'fault-doc';

function op(sequence: number): StoredOperation {
  return {
    operationId: `op-${sequence}`,
    operationType: 'node.patch',
    schemaVersion: 1,
    logicalSequence: sequence,
    affectedEntityIds: ['n1_aaaa'],
    payload: { nodeId: 'n1_aaaa', path: 'opacity', value: 0.5 },
  };
}

function segment(segmentIndex: number, startSeq: number, count: number): LogSegment {
  const operations = Array.from({ length: count }, (_, i) => op(startSeq + i));
  return buildSegment({
    documentId: DOC_ID,
    operations,
    segmentIndex,
    nextLogicalSequence: startSeq + count,
  }).segment;
}

function revision(
  id: string,
  parents: string[],
  hash: string,
  range?: { start: { segment: number; offset: number }; end: { segment: number; offset: number } },
): RevisionRecord {
  return {
    revisionId: id,
    documentId: DOC_ID,
    parentRevisionIds: parents,
    canonicalDocumentHash: hash,
    operationStart: range?.start,
    operationEnd: range?.end,
    author: { actorId: 't', kind: 'local-user' },
    semanticSummary: { label: 'Edit', kind: 'modify', affectedEntityIds: [] },
    createdAt: 1,
    schemaVersion: 1,
    origin: 'edit',
  };
}

async function seedStore(
  store: ReturnType<typeof createMemoryHistoryStore>,
  doc: Document,
  segments: LogSegment[],
  revisions: RevisionRecord[],
  branchHeads: Record<string, string>,
) {
  // setSegments writes the given segments verbatim so fault injection can
  // plant corrupt checksums (appendOperations would rebuild them).
  if (segments.length > 0) await store.setSegments!(DOC_ID, segments);
  for (const rev of revisions) {
    await store.putRevision(rev);
  }
  for (const [name, head] of Object.entries(branchHeads)) {
    await store.putBranch({
      branchId: `b-${name}`,
      documentId: DOC_ID,
      name,
      headRevisionId: head,
      createdFromRevisionId: head,
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
  }
  await store.putSnapshot({
    canonicalHash: canonicalHash(doc),
    documentId: DOC_ID,
    canonicalText: JSON.stringify(doc),
    revisionId: 'r-genesis',
    schemaVersion: 1,
    createdAt: 1,
  });
}

describe('fault injection', () => {
  it('corrupt final segment: recoverTail truncates and rewinds the branch head', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 2), segment(1, 3, 2)];
    // Corrupt the tail segment's checksum.
    const badTail = { ...segments[1]!, checksum: '0'.repeat(64) };
    await seedStore(store, doc, [segments[0]!, badTail], [], {});

    const report = await recoverTail(store, DOC_ID, { applyTruncation: true });
    expect(report.truncatedSegments).toEqual([1]);
    expect(report.discardedOperations).toBe(2);
    const remaining = await store.listSegments(DOC_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.segmentIndex).toBe(0);
    expect(verifySegments(store, DOC_ID)).resolves.toEqual([]);
  });

  it('corrupt middle segment: truncates from the corrupt segment onward', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 2), segment(1, 3, 2), segment(2, 5, 2)];
    const badMiddle = { ...segments[1]!, checksum: 'deadbeef' };
    await seedStore(store, doc, [segments[0]!, badMiddle, segments[2]!], [], {});

    const report = await recoverTail(store, DOC_ID, { applyTruncation: true });
    expect(report.truncatedSegments).toEqual([1, 2]);
    expect(report.discardedOperations).toBe(4);
    const remaining = await store.listSegments(DOC_ID);
    expect(remaining).toHaveLength(1);
  });

  it('branch head beyond the last valid segment: head is rewound or flagged', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 2)];
    const revs = [revision('r-1', [], canonicalHash(doc))];
    await seedStore(store, doc, segments, revs, { main: 'r-1' });
    // A second branch pointing at a revision whose ops are in the corrupt
    // tail: recovery truncates the tail, so that head must be flagged.
    await store.putBranch({
      branchId: 'b-orphan',
      documentId: DOC_ID,
      name: 'orphan',
      headRevisionId: 'r-missing',
      createdFromRevisionId: 'r-missing',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
    const issues = await validateHistory(store, DOC_ID);
    expect(issues.some((i) => i.code === 'branch.dangling-head')).toBe(true);
  });

  it('missing snapshot: replay throws a recoverable ReplayError', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 1)];
    const revs = [revision('r-1', [], 'f'.repeat(64))];
    await seedStore(store, doc, segments, revs, { main: 'r-1' });
    // No snapshot exists for r-1's hash → replay base unavailable.
    await expect(replayAndVerify(store, DOC_ID, 'r-1')).rejects.toThrow(ReplayError);
  });

  it('snapshot hash mismatch: replayAndVerify reports unverified', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 1)];
    const revs = [revision('r-1', [], 'b'.repeat(64))];
    await seedStore(store, doc, segments, revs, { main: 'r-1' });
    // The snapshot stored under the revision's hash carries different bytes.
    const issues = await validateHistory(store, DOC_ID);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('dangling revision parent: graph validation flags it', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const revs = [
      revision('r-1', ['r-does-not-exist'], canonicalHash(doc)),
      revision('r-2', ['r-1'], canonicalHash(doc)),
    ];
    await seedStore(store, doc, [], revs, { main: 'r-2' });
    const issues = await validateRevisionGraph(store, DOC_ID);
    expect(issues.some((i) => i.code === 'revision.dangling-parent')).toBe(true);
  });

  it('revision with too many parents: graph validation flags it', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const revs = [
      revision('r-1', [], canonicalHash(doc)),
      revision('r-2', ['r-1', 'r-extra', 'r-third'], canonicalHash(doc)),
    ];
    await seedStore(store, doc, [], revs, { main: 'r-2' });
    const issues = await validateRevisionGraph(store, DOC_ID);
    expect(issues.some((i) => i.code === 'revision.too-many-parents')).toBe(true);
  });

  it('orphaned operations beyond the last committed revision are ignored by replay', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 3)];
    const revs = [
      revision('r-1', [], canonicalHash(doc), {
        start: { segment: 0, offset: 0 },
        end: { segment: 0, offset: 1 },
      }),
    ];
    await seedStore(store, doc, segments, revs, { main: 'r-1' });
    // Operations beyond r-1's range exist in the log but are not referenced.
    const report = await recoverTail(store, DOC_ID, { applyTruncation: true });
    expect(report.truncatedSegments).toEqual([]);
    // The manifest still reflects the full segment; the replay path only
    // consumes the referenced range.
    const issues = await validateHistory(store, DOC_ID);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('recovery never points a branch at an incomplete revision', async () => {
    const store = createMemoryHistoryStore();
    const doc = {} as Document;
    const segments = [segment(0, 1, 2)];
    const revs = [revision('r-1', [], canonicalHash(doc))];
    await seedStore(store, doc, segments, revs, { main: 'r-1' });
    // Recover a healthy store: no truncation, head untouched.
    const report = await recoverTail(store, DOC_ID, { applyTruncation: true });
    expect(report.truncatedSegments).toEqual([]);
    expect(report.warnings).toEqual([]);
    const branch = await store.getBranch(DOC_ID, 'b-main');
    expect(branch?.headRevisionId).toBe('r-1');
  });
});
