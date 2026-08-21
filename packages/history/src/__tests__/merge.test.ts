/**
 * Three-way semantic merge tests (M11, ADR-0034).
 */

import type { Document } from '@varve/scene';
import {
  canonicalHistoryHash,
  createDocument,
  makeFrameNode,
  makeShapeNode,
  makeTextNode,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { commitMergeRevision, mergeDocuments, spliceClusterRange } from '../merge';
import { buildRevision, createGenesisRevision } from '../revisions';
import { createMemoryHistoryStore, mintHistoryId } from '../store';

function baseDoc(name = 'Base'): Document {
  const doc = { ...createDocument(name, { flat: true }), id: 'merge-doc-001' } as Document;
  const rect = makeShapeNode(
    'n1_aaaa',
    { kind: 'rect', x: 0, y: 0, w: 100, h: 50 },
    { name: 'Button' },
  );
  const frame = makeFrameNode('n2_bbbb', { name: 'Group', children: ['n1_aaaa'] });
  doc.nodes = { [rect.id]: rect, [frame.id]: frame };
  doc.rootChildren = ['n2_bbbb'];
  return doc;
}

function clone(doc: Document): Document {
  return structuredClone(doc);
}

describe('mergeDocuments', () => {
  it('returns theirs unchanged when we made no changes', () => {
    const base = baseDoc();
    const ours = clone(base);
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.3;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.conflicts).toHaveLength(0);
    expect((result.mergedDocument.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.3);
  });

  it('returns ours unchanged when they made no changes', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.7;
    const theirs = clone(base);
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect((result.mergedDocument.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.7);
  });

  it('adopts disjoint edits on different entities', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n2_bbbb as { name: string }).name = 'Renamed group';
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.conflicts).toHaveLength(0);
    expect((result.mergedDocument.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.4);
    expect((result.mergedDocument.nodes.n2_bbbb as { name: string }).name).toBe('Renamed group');
  });

  it('adopts disjoint edits on different properties of the same entity', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { visible?: boolean }).visible = false;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect((result.mergedDocument.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.4);
    expect((result.mergedDocument.nodes.n1_aaaa as { visible?: boolean }).visible).toBe(false);
  });

  it('adopts identical edits on both sides once', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.conflicts).toHaveLength(0);
  });

  it('conflicts when both sides edit the same property differently', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.6;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.conflictKind).toBe('scalar');
    expect(result.conflicts[0]!.entityId).toBe('n1_aaaa');
    expect(result.conflicts[0]!.propertyPath).toBe('nodes.n1_aaaa.opacity');
    expect(result.conflicts[0]!.oursValue).toBe(0.4);
    expect(result.conflicts[0]!.theirsValue).toBe(0.6);
    // ours value kept in the merged document
    expect((result.mergedDocument.nodes.n1_aaaa as { opacity: number }).opacity).toBe(0.4);
  });

  it('conflicts edit vs delete', () => {
    const base = baseDoc();
    const ours = clone(base);
    delete ours.nodes.n1_aaaa;
    ours.rootChildren = ['n2_bbbb'];
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { opacity: number }).opacity = 0.6;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    const conflict = result.conflicts.find((c) => c.conflictKind === 'edit-vs-delete');
    expect(conflict).toBeDefined();
    expect(conflict?.entityId).toBe('n1_aaaa');
  });

  it('conflicts when both sides add the same id with different content', () => {
    const base = baseDoc();
    const ours = clone(base);
    ours.nodes.n9_zzzz = makeShapeNode(
      'n9_zzzz',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Mine' },
    );
    ours.rootChildren = ['n2_bbbb', 'n9_zzzz'];
    const theirs = clone(base);
    theirs.nodes.n9_zzzz = makeShapeNode(
      'n9_zzzz',
      { kind: 'rect', x: 5, y: 5, w: 20, h: 20 },
      { name: 'Theirs' },
    );
    theirs.rootChildren = ['n2_bbbb', 'n9_zzzz'];
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('add-vs-add');
  });

  it('merges concurrent node additions into the shared order', () => {
    const base = baseDoc();
    const ours = clone(base);
    const mine = makeShapeNode(
      'n3_cccc',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Mine' },
    );
    ours.nodes.n3_cccc = mine;
    ours.rootChildren = ['n2_bbbb', 'n3_cccc'];
    const theirs = clone(base);
    const theirsNode = makeShapeNode(
      'n4_dddd',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Theirs' },
    );
    theirs.nodes.n4_dddd = theirsNode;
    theirs.rootChildren = ['n2_bbbb', 'n4_dddd'];
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.conflicts).toHaveLength(0);
    expect(result.mergedDocument.nodes.n3_cccc).toBeDefined();
    expect(result.mergedDocument.nodes.n4_dddd).toBeDefined();
    expect(result.mergedDocument.rootChildren).toEqual(['n2_bbbb', 'n3_cccc', 'n4_dddd']);
  });

  it('merges additions into base-relative gaps', () => {
    const base = baseDoc();
    const ours = clone(base);
    const mine = makeShapeNode(
      'n3_cccc',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Mine' },
    );
    ours.nodes.n3_cccc = mine;
    ours.rootChildren = ['n3_cccc', 'n2_bbbb']; // inserted before the frame
    const theirs = clone(base);
    const theirsNode = makeShapeNode(
      'n4_dddd',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Theirs' },
    );
    theirs.nodes.n4_dddd = theirsNode;
    theirs.rootChildren = ['n2_bbbb', 'n4_dddd']; // inserted after the frame
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.mergedDocument.rootChildren).toEqual(['n3_cccc', 'n2_bbbb', 'n4_dddd']);
  });

  it('conflicts when both sides reorder the same items differently', () => {
    const base = baseDoc();
    const extra = makeShapeNode(
      'n3_cccc',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Three' },
    );
    base.nodes.n3_cccc = extra;
    base.rootChildren = ['n2_bbbb', 'n3_cccc'];
    const ours = clone(base);
    ours.rootChildren = ['n3_cccc', 'n2_bbbb'];
    const theirs = clone(base);
    theirs.rootChildren = ['n3_cccc', 'n2_bbbb'];
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean'); // identical reorder → adopt once
    const ours2 = clone(base);
    const theirs2 = clone(base);
    ours2.rootChildren = ['n3_cccc', 'n2_bbbb'];
    theirs2.rootChildren = ['n2_bbbb', 'n3_cccc']; // base order — no change
    const result2 = mergeDocuments(base, ours2, theirs2);
    expect(result2.status).toBe('clean');
    expect(result2.mergedDocument.rootChildren).toEqual(['n3_cccc', 'n2_bbbb']);
    const ours3 = clone(base);
    const theirs3 = clone(base);
    ours3.rootChildren = ['n3_cccc', 'n2_bbbb'];
    theirs3.rootChildren = ['n3_cccc', 'n2_bbbb']; // same as ours
    const result3 = mergeDocuments(base, ours3, theirs3);
    expect(result3.status).toBe('clean');
    // now genuinely conflicting moves: ours moves n2 before n3, theirs moves n2 after n3
    const ours4 = clone(base);
    const theirs4 = clone(base);
    ours4.rootChildren = ['n2_bbbb', 'n3_cccc']; // base order
    theirs4.rootChildren = ['n3_cccc', 'n2_bbbb'];
    const result4 = mergeDocuments(base, ours4, theirs4);
    expect(result4.status).toBe('clean');
    // true conflict: both sides swap the pair in different ways (needs 3+ items)
    const base5 = baseDoc();
    const a = makeShapeNode(
      'n3_cccc',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Three' },
    );
    const b = makeShapeNode(
      'n5_ffff',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Five' },
    );
    base5.nodes.n3_cccc = a;
    base5.nodes.n5_ffff = b;
    base5.rootChildren = ['n2_bbbb', 'n3_cccc', 'n5_ffff'];
    const ours5 = clone(base5);
    const theirs5 = clone(base5);
    ours5.rootChildren = ['n2_bbbb', 'n5_ffff', 'n3_cccc'];
    theirs5.rootChildren = ['n3_cccc', 'n5_ffff', 'n2_bbbb'];
    const result5 = mergeDocuments(base5, ours5, theirs5);
    expect(result5.status).toBe('conflicted');
    expect(result5.conflicts.some((c) => c.conflictKind === 'reorder')).toBe(true);
  });

  it('conflicts concurrent rewrites of an id-less array', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { strokes: unknown[] }).strokes = [
      { color: { r: 1, g: 0, b: 0, a: 1 }, weight: 2 },
    ];
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { strokes: unknown[] }).strokes = [
      { color: { r: 0, g: 0, b: 1, a: 1 }, weight: 4 },
    ];
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('reorder');
  });

  it('merges disjoint text edits', () => {
    const base = baseDoc();
    const textNode = makeTextNode('n5_eeee', 'Hello world', { name: 'Title', fontSize: 16 });
    base.nodes.n5_eeee = textNode;
    base.rootChildren = ['n5_eeee'];
    const ours = clone(base);
    ours.nodes.n5_eeee = {
      ...ours.nodes.n5_eeee,
      text: 'Hello brave world',
    } as typeof textNode;
    const theirs = clone(base);
    theirs.nodes.n5_eeee = {
      ...theirs.nodes.n5_eeee,
      text: 'Hello world!',
    } as typeof textNode;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect((result.mergedDocument.nodes.n5_eeee as { text: string }).text).toBe(
      'Hello brave world!',
    );
  });

  it('conflicts overlapping text edits', () => {
    const base = baseDoc();
    const textNode = makeTextNode('n5_eeee', 'Hello world', { name: 'Title', fontSize: 16 });
    base.nodes.n5_eeee = textNode;
    base.rootChildren = ['n5_eeee'];
    const ours = clone(base);
    ours.nodes.n5_eeee = {
      ...ours.nodes.n5_eeee,
      text: 'Hello brave world',
    } as typeof textNode;
    const theirs = clone(base);
    theirs.nodes.n5_eeee = {
      ...theirs.nodes.n5_eeee,
      text: 'Hello big world',
    } as typeof textNode;
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('text-overlap');
  });

  it('conflicts rename vs rename', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { name: string }).name = 'A';
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { name: string }).name = 'B';
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('rename');
  });

  it('produces a valid, deterministic merged hash', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    const theirs = clone(base);
    (theirs.nodes.n2_bbbb as { name: string }).name = 'Group 2';
    const result = mergeDocuments(base, ours, theirs);
    expect(result.invalid).toBe(false);
    expect(result.mergedHash).toBe(canonicalHistoryHash(result.mergedDocument));
  });

  it('flags dangling references as invalid', () => {
    // ours deletes a child node without updating its parent's children
    // array — the merge produces a structurally broken document and must
    // report it.
    const base = baseDoc();
    const ours = clone(base);
    delete ours.nodes.n1_aaaa;
    const theirs = clone(base);
    const result = mergeDocuments(base, ours, theirs);
    expect(result.invalid).toBe(true);
    expect(result.warnings.some((w) => w.includes('dangling'))).toBe(true);
    // a consistent deletion (parent children array updated) stays valid
    const ours2 = clone(base);
    delete ours2.nodes.n1_aaaa;
    (ours2.nodes.n2_bbbb as { children: string[] }).children = [];
    const result2 = mergeDocuments(base, ours2, theirs);
    expect(result2.invalid).toBe(false);
  });
});

describe('spliceClusterRange', () => {
  it('splices a replacement into the middle', () => {
    expect(spliceClusterRange('Hello world', 6, 6, 'brave ')).toBe('Hello brave world');
  });

  it('replaces a range', () => {
    expect(spliceClusterRange('Hello world', 6, 11, 'there')).toBe('Hello there');
  });

  it('handles emoji as single clusters', () => {
    expect(spliceClusterRange('a\u{1F600}b', 1, 2, 'X')).toBe('aXb');
  });

  it('clamps out-of-range indices', () => {
    expect(spliceClusterRange('ab', 5, 9, 'Z')).toBe('abZ');
    expect(spliceClusterRange('ab', -2, 1, 'Z')).toBe('Zb');
  });
});

describe('commitMergeRevision', () => {
  it('creates a two-parent merge revision and moves the branch head', async () => {
    const store = createMemoryHistoryStore();
    const documentId = 'merge-graph-doc';
    const { genesis, branch: mainBranch } = await createGenesisRevision(store, baseDoc(), {
      documentId,
      author: { actorId: 'test', kind: 'local-user' },
      branchName: 'main',
    });
    const branchId = mainBranch.branchId;

    const oursRevision = buildRevision({
      documentId,
      parentRevisionIds: [genesis.revisionId],
      document: baseDoc(),
      author: { actorId: 'test', kind: 'local-user' },
      origin: 'edit',
      semanticSummary: { label: 'Edit', affectedEntityIds: [], kind: 'modify' },
    });
    await store.putRevision(oursRevision);

    const theirsRevision = buildRevision({
      documentId,
      parentRevisionIds: [genesis.revisionId],
      document: baseDoc(),
      author: { actorId: 'other', kind: 'remote-user' },
      origin: 'edit',
      semanticSummary: { label: 'Edit', affectedEntityIds: [], kind: 'modify' },
    });
    await store.putRevision(theirsRevision);

    const mergeDoc = baseDoc();
    (mergeDoc.nodes.n1_aaaa as { opacity: number }).opacity = 0.9;
    const merged = await commitMergeRevision(store, {
      documentId,
      branchId,
      baseRevisionId: genesis.revisionId,
      oursRevisionId: oursRevision.revisionId,
      theirsRevisionId: theirsRevision.revisionId,
      mergedDocument: mergeDoc,
      conflictCount: 0,
      author: { actorId: 'test', kind: 'local-user' },
    });
    expect(merged.parentRevisionIds).toEqual([oursRevision.revisionId, theirsRevision.revisionId]);
    expect(merged.origin).toBe('merge');
    const branch = await store.getBranch(documentId, branchId);
    expect(branch?.headRevisionId).toBe(merged.revisionId);
    const issues = await store.listRevisions(documentId);
    expect(issues).toHaveLength(4);
    expect(mintHistoryId('x').startsWith('x-')).toBe(true);
  });
});
