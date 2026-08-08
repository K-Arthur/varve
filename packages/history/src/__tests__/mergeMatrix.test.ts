/**
 * Semantic merge conflict matrix (M17, spec §18/§35.6).
 *
 * Each case verifies: clean/conflicted classification, conflict payload
 * (kind, entity, property path), merged-hash determinism, canonical
 * integrity, and resolution application where applicable.
 */

import type { Document } from '@varve/scene';
import {
  applyOperation,
  canonicalHash,
  createDocument,
  makeShapeNode,
  registerBuiltinOperations,
} from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { mergeDocuments } from '../merge';
import { applyMergeResolutions, bulkResolve } from '../resolveMerge';

registerBuiltinOperations();

const DOC_ID = 'matrix-doc';

function baseDoc(): Document {
  const doc = {
    ...createDocument(DOC_ID, { flat: true }),
    id: DOC_ID,
  } as Document;
  const a = makeShapeNode('n1_aaaa', { kind: 'rect', x: 0, y: 0, w: 10, h: 10, name: 'A' });
  const b = makeShapeNode('n2_bbbb', { kind: 'rect', x: 20, y: 0, w: 10, h: 10, name: 'B' });
  const withA = applyOperation(doc, 'node.create', { node: a });
  return applyOperation(withA, 'node.create', { node: b });
}

function patch(doc: Document, id: string, path: string, value: unknown): Document {
  return applyOperation(doc, 'node.patch', { nodeId: id, path, value });
}

function expectDeterministic(
  base: Document,
  ours: Document,
  theirs: Document,
): ReturnType<typeof mergeDocuments> {
  const a = mergeDocuments(base, ours, theirs);
  const b = mergeDocuments(base, ours, theirs);
  expect(a.status).toBe(b.status);
  expect(a.conflicts).toHaveLength(b.conflicts.length);
  expect(canonicalHash(a.mergedDocument)).toBe(canonicalHash(b.mergedDocument));
  expect(a.mergedHash).toBe(b.mergedHash);
  return a;
}

describe('merge conflict matrix', () => {
  it('scalar: same property changed differently → conflicted', () => {
    const base = baseDoc();
    const result = expectDeterministic(
      base,
      patch(base, 'n1_aaaa', 'opacity', 0.3),
      patch(base, 'n1_aaaa', 'opacity', 0.7),
    );
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('scalar');
    expect(result.conflicts[0]!.entityId).toBe('n1_aaaa');
    expect(result.conflicts[0]!.propertyPath).toBe('nodes.n1_aaaa.opacity');
    expect(result.conflicts[0]!.candidateResolutions).toEqual(['ours', 'theirs', 'base']);
  });

  it('scalar: same property same value on both sides → clean adopt-once', () => {
    const base = baseDoc();
    const result = mergeDocuments(
      base,
      patch(base, 'n1_aaaa', 'opacity', 0.5),
      patch(base, 'n1_aaaa', 'opacity', 0.5),
    );
    expect(result.status).toBe('clean');
    expect(result.conflicts).toHaveLength(0);
  });

  it('edit-vs-delete: ours deletes, theirs edits → conflicted with both resolutions', () => {
    const base = baseDoc();
    const ours = applyOperation(base, 'node.delete', { nodeId: 'n1_aaaa' });
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.4);
    const result = expectDeterministic(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('edit-vs-delete');
    expect(result.conflicts[0]!.candidateResolutions).toEqual(['ours', 'theirs']);
  });

  it('edit-vs-delete: theirs deletes, ours edits → conflicted', () => {
    const base = baseDoc();
    const ours = patch(base, 'n1_aaaa', 'opacity', 0.4);
    const theirs = applyOperation(base, 'node.delete', { nodeId: 'n1_aaaa' });
    const result = expectDeterministic(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('edit-vs-delete');
  });

  it('add-vs-add: same id created with different content → conflicted', () => {
    const base = baseDoc();
    const make = (name: string) =>
      applyOperation(base, 'node.create', {
        node: makeShapeNode('n9_zzzz', { kind: 'rect', x: 100, y: 0, w: 10, h: 10, name }),
      });
    const result = expectDeterministic(base, make('Ours'), make('Theirs'));
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('add-vs-add');
  });

  it('rename-vs-rename: different names on both sides → conflicted', () => {
    const base = baseDoc();
    const result = expectDeterministic(
      base,
      patch(base, 'n1_aaaa', 'name', 'Alpha'),
      patch(base, 'n1_aaaa', 'name', 'Beta'),
    );
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('rename');
  });

  it('text: overlapping edits → conflicted text-overlap with base option', () => {
    // Both sides replace the same separator cluster differently.
    const base = patch(baseDoc(), 'n1_aaaa', 'text', 'Hello world');
    const ours = patch(base, 'n1_aaaa', 'text', 'Hello X world');
    const theirs = patch(base, 'n1_aaaa', 'text', 'Hello Y world');
    const result = expectDeterministic(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.conflictKind).toBe('text-overlap');
    expect(result.conflicts[0]!.candidateResolutions).toEqual(['ours', 'theirs', 'base']);
  });

  it('text: same insertion point on both sides → clean adopt-both preserves both', () => {
    const base = patch(baseDoc(), 'n1_aaaa', 'text', 'Hello world');
    const ours = patch(base, 'n1_aaaa', 'text', 'Hello brave world');
    const theirs = patch(base, 'n1_aaaa', 'text', 'Hello wide world');
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    const node = result.mergedDocument.nodes.n1_aaaa as { text?: string };
    expect(node.text).toBe('Hello brave wide world');
  });

  it('text: disjoint grapheme edits → clean adopt-both', () => {
    const base = patch(baseDoc(), 'n1_aaaa', 'text', 'Hello world');
    const ours = patch(base, 'n1_aaaa', 'text', 'Hello world!');
    const theirs = patch(base, 'n1_aaaa', 'text', 'Hi world');
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    const node = result.mergedDocument.nodes.n1_aaaa as { text?: string };
    expect(node.text).toBe('Hi world!');
  });

  it('reorder: both sides reorder the same items differently → conflicted', () => {
    const base = baseDoc();
    const withC = applyOperation(base, 'node.create', {
      node: makeShapeNode('n3_cccc', { kind: 'rect', x: 50, y: 0, w: 10, h: 10 }),
    });
    const ours = applyOperation(withC, 'node.move', { nodeId: 'n1_aaaa', toIndex: 2 });
    const theirs = applyOperation(withC, 'node.move', { nodeId: 'n2_bbbb', toIndex: 0 });
    const result = expectDeterministic(withC, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts.some((c) => c.conflictKind === 'reorder')).toBe(true);
  });

  it('reorder: identical final order on both sides → clean adopt-once', () => {
    const base = baseDoc();
    const ours = applyOperation(base, 'node.move', { nodeId: 'n1_aaaa', toIndex: 1 });
    const theirs = applyOperation(base, 'node.move', { nodeId: 'n2_bbbb', toIndex: 0 });
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    expect(result.mergedDocument.rootChildren).toEqual(['n2_bbbb', 'n1_aaaa']);
  });

  it('concurrent additions to rootChildren → clean three-way order merge', () => {
    const base = baseDoc();
    const make = (id: string, name: string) =>
      applyOperation(base, 'node.create', {
        node: makeShapeNode(id, { kind: 'rect', x: 300, y: 0, w: 10, h: 10, name }),
      });
    const ours = make('n3_cccc', 'Ours node');
    const theirs = make('n4_dddd', 'Theirs node');
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    const rootChildren = result.mergedDocument.rootChildren;
    expect(rootChildren).toContain('n3_cccc');
    expect(rootChildren).toContain('n4_dddd');
  });

  it('id-less array rewrite: both sides change fills differently → conflicted', () => {
    const base = baseDoc();
    // Fill objects are id-less arrays in the scene model; patch through the
    // document node directly (the op whitelist covers 'fill').
    const ours = patch(base, 'n1_aaaa', 'fill', { space: 'srgb', channels: [1, 0, 0, 1] });
    const theirs = patch(base, 'n1_aaaa', 'fill', { space: 'srgb', channels: [0, 0, 1, 1] });
    const result = expectDeterministic(base, ours, theirs);
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.propertyPath).toContain('nodes.n1_aaaa.fill');
  });

  it('geometry: x changed differently on both sides → scalar conflict', () => {
    const base = baseDoc();
    const result = expectDeterministic(
      base,
      patch(base, 'n1_aaaa', 'shape.x', 5),
      patch(base, 'n1_aaaa', 'shape.x', 15),
    );
    expect(result.status).toBe('conflicted');
    expect(result.conflicts[0]!.propertyPath).toBe('nodes.n1_aaaa.shape.x');
  });

  it('move-vs-move: different targets → order merge keeps both when possible', () => {
    const base = baseDoc();
    const withC = applyOperation(base, 'node.create', {
      node: makeShapeNode('n3_cccc', { kind: 'rect', x: 50, y: 0, w: 10, h: 10 }),
    });
    const ours = applyOperation(withC, 'node.move', { nodeId: 'n1_aaaa', toIndex: 2 });
    const theirs = applyOperation(withC, 'node.move', { nodeId: 'n2_bbbb', toIndex: 0 });
    const result = mergeDocuments(withC, ours, theirs);
    // Both items moved to different base-relative positions — deterministic
    // order merge applies; the merged doc must stay valid either way.
    expect(result.invalid).toBe(false);
    expect(canonicalHash(result.mergedDocument)).toBe(result.mergedHash);
  });

  it('node-type replacement: identity-based diff treats it as an entity modify', () => {
    // Delete + recreate with the SAME persistent id is an entity-level
    // modify under identity-keyed diffing: the replacement's kind change
    // and the other side's opacity edit touch disjoint properties, so they
    // merge cleanly and nothing is lost.
    const base = baseDoc();
    const replace = applyOperation(base, 'node.delete', { nodeId: 'n1_aaaa' });
    const replaced = applyOperation(replace, 'node.create', {
      node: makeShapeNode('n1_aaaa', { kind: 'ellipse', x: 0, y: 0, w: 10, h: 10 }),
    });
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.5);
    const result = expectDeterministic(base, replaced, theirs);
    expect(result.status).toBe('clean');
    const node = result.mergedDocument.nodes.n1_aaaa as { opacity?: number };
    expect(node.opacity).toBe(0.5);
  });

  it('identical edits on both sides adopt once (no phantom conflict)', () => {
    const base = baseDoc();
    const ours = patch(base, 'n1_aaaa', 'opacity', 0.33);
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.33);
    const result = mergeDocuments(base, ours, theirs);
    expect(result.status).toBe('clean');
    const node = result.mergedDocument.nodes.n1_aaaa as { opacity?: number };
    expect(node.opacity).toBe(0.33);
  });

  it('one side unchanged → fast path returns the other side byte-identically', () => {
    const base = baseDoc();
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.9);
    const a = mergeDocuments(base, base, theirs);
    const b = mergeDocuments(base, theirs, base);
    expect(a.status).toBe('clean');
    expect(b.status).toBe('clean');
    expect(canonicalHash(a.mergedDocument)).toBe(canonicalHash(theirs));
    expect(canonicalHash(b.mergedDocument)).toBe(canonicalHash(theirs));
  });

  it('conflict resolutions always produce canonical, id-unique documents', () => {
    const base = baseDoc();
    const ours = patch(base, 'n1_aaaa', 'opacity', 0.3);
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.7);
    const result = mergeDocuments(base, ours, theirs);
    for (const choice of ['ours', 'theirs', 'base'] as const) {
      const resolved = applyMergeResolutions(
        result.mergedDocument,
        result.conflicts,
        bulkResolve(result.conflicts, choice),
      );
      expect(resolved.unresolvedConflictIds).toHaveLength(0);
      expect(canonicalHash(resolved.document)).toBeTruthy();
      const ids = Object.keys(resolved.document.nodes);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('renamed node still merges disjoint property edits on the same entity', () => {
    const base = baseDoc();
    const ours = patch(base, 'n1_aaaa', 'name', 'Renamed');
    const theirs = patch(base, 'n1_aaaa', 'opacity', 0.6);
    const result = expectDeterministic(base, ours, theirs);
    expect(result.status).toBe('clean');
    const node = result.mergedDocument.nodes.n1_aaaa as { name?: string; opacity?: number };
    expect(node.name).toBe('Renamed');
    expect(node.opacity).toBe(0.6);
  });
});
