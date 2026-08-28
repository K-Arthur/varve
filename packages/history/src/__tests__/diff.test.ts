/**
 * Semantic diff tests (M10, ADR-0028).
 */

import type { Document, VariableStore } from '@varve/scene';
import { createDocument, makeFrameNode, makeShapeNode, makeTextNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { diffDocuments, lcsIndices, stableStringify } from '../diff';
import { mergeDocuments } from '../merge';

function baseDoc(name = 'Base'): Document {
  const doc = { ...createDocument(name, { flat: true }), id: 'diff-doc-001' } as Document;
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

describe('diffDocuments', () => {
  it('reports unchanged documents as changed: false', () => {
    const base = baseDoc();
    const target = clone(base);
    const diff = diffDocuments(base, target);
    expect(diff.changed).toBe(false);
    expect(diff.changes).toHaveLength(0);
  });

  it('detects node rename', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { name: string }).name = 'Primary Button';
    const diff = diffDocuments(base, target);
    const rename = diff.changes.find((c) => c.changeType === 'renamed');
    expect(rename).toBeDefined();
    expect(rename?.entityId).toBe('n1_aaaa');
    expect(rename?.before).toBe('Button');
    expect(rename?.after).toBe('Primary Button');
  });

  it('detects scalar property modification with the per-property epsilon', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.9999995;
    const diff = diffDocuments(base, target);
    expect(diff.changed).toBe(false); // within 1e-6 tolerance
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    const diff2 = diffDocuments(base, target);
    const change = diff2.changes.find((c) => c.propertyPath === 'nodes.n1_aaaa.opacity');
    expect(change).toBeDefined();
    expect(change?.changeType).toBe('modified');
    expect(change?.before).toBe(1);
    expect(change?.after).toBe(0.5);
  });

  it('exact epsilon policy disables tolerances', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.9999995;
    const diff = diffDocuments(base, target, { epsilonPolicy: 'exact' });
    expect(diff.changed).toBe(true);
    expect(diff.changes).toHaveLength(1);
  });

  it('detects added and removed nodes', () => {
    const base = baseDoc();
    const target = clone(base);
    const extra = makeShapeNode(
      'n3_cccc',
      { kind: 'ellipse', cx: 10, cy: 10, rx: 10, ry: 10 },
      { name: 'Badge' },
    );
    target.nodes.n3_cccc = extra;
    target.rootChildren = ['n2_bbbb', 'n3_cccc'];
    delete target.nodes.n1_aaaa;
    target.rootChildren = ['n2_bbbb', 'n3_cccc'];
    const diff = diffDocuments(base, target);
    const added = diff.changes.find((c) => c.changeType === 'added' && c.entityId === 'n3_cccc');
    const removed = diff.changes.find(
      (c) => c.changeType === 'removed' && c.entityId === 'n1_aaaa',
    );
    expect(added?.propertyPath).toBe('nodes');
    expect(removed?.propertyPath).toBe('nodes');
  });

  it('detects children reorder with id-stable rewrite path', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n2_bbbb as { children: string[] }).children = ['n1_aaaa'];
    // no actual reorder — same array
    expect(diffDocuments(base, target).changed).toBe(false);
    // now add a second child and reorder
    const second = makeShapeNode(
      'n4_dddd',
      { kind: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { name: 'Inner' },
    );
    target.nodes.n4_dddd = second;
    (target.nodes.n2_bbbb as { children: string[] }).children = ['n4_dddd', 'n1_aaaa'];
    const diff = diffDocuments(base, target);
    const reorder = diff.changes.find(
      (c) => c.changeType === 'reordered' && c.propertyPath === 'nodes.n2_bbbb.children',
    );
    expect(reorder).toBeDefined();
    expect(reorder?.after).toEqual(['n4_dddd', 'n1_aaaa']);
  });

  it('differs text at grapheme-cluster granularity with ranges', () => {
    const base = baseDoc();
    const target = clone(base);
    const textNode = makeTextNode('n5_eeee', 'Hello world', { name: 'Title', fontSize: 16 });
    base.nodes.n5_eeee = textNode;
    base.rootChildren = ['n5_eeee'];
    target.nodes.n5_eeee = { ...textNode, text: 'Hello brave world' };
    target.rootChildren = ['n5_eeee'];
    const diff = diffDocuments(base, target);
    const change = diff.changes.find((c) => c.changeType === 'text');
    expect(change).toBeDefined();
    expect(change?.entityId).toBe('n5_eeee');
    expect(change?.textRanges?.baseStart).toBe(6);
    expect(change?.textRanges?.baseEnd).toBe(6);
    expect(change?.textRanges?.targetStart).toBe(6);
    expect(change?.textRanges?.targetEnd).toBe(12);
    expect(change?.after).toBe('Hello brave world');
  });

  it('differs emoji text as single clusters', () => {
    const base = baseDoc();
    const target = clone(base);
    const textNode = makeTextNode('n5_eeee', 'a\u{1F600}b', { name: 'Title', fontSize: 16 });
    base.nodes.n5_eeee = textNode;
    base.rootChildren = ['n5_eeee'];
    const targetText = { ...textNode, text: 'a\u{1F600}!' };
    target.nodes.n5_eeee = targetText;
    target.rootChildren = ['n5_eeee'];
    const diff = diffDocuments(base, target);
    const change = diff.changes.find((c) => c.changeType === 'text');
    expect(change).toBeDefined();
    expect(change?.textRanges?.baseStart).toBe(2);
    expect(change?.textRanges?.baseEnd).toBe(3);
  });

  it('detects document-level scalar changes', () => {
    const base = baseDoc();
    const target = clone(base);
    target.name = 'Renamed document';
    target.canvasWidth = 1200;
    const diff = diffDocuments(base, target);
    const nameChange = diff.changes.find((c) => c.propertyPath === 'name');
    const widthChange = diff.changes.find((c) => c.propertyPath === 'canvasWidth');
    expect(nameChange).toBeDefined();
    expect(widthChange).toBeDefined();
  });

  it('detects variable collection changes', () => {
    const base = baseDoc();
    const target = clone(base);
    const variableStore = {
      variables: {
        v1_aaaa: {
          id: 'v1_aaaa',
          name: 'Accent',
          type: 'color',
          valuesByMode: { m1_aaaa: { r: 0.1, g: 0.2, b: 0.3, a: 1 } },
        },
      },
      collections: {
        c1_aaaa: {
          id: 'c1_aaaa',
          name: 'Brand',
          variableIds: ['v1_aaaa'],
          modes: ['m1_aaaa'],
          activeMode: 'm1_aaaa',
        },
      },
      activeCollectionId: 'c1_aaaa',
      modes: ['m1_aaaa'],
      activeMode: 'm1_aaaa',
    };
    base.variableStore = structuredClone(variableStore) as VariableStore;
    target.variableStore = structuredClone(variableStore) as VariableStore;
    target.variableStore.collections.c1_aaaa!.name = 'Daylight';
    const diff = diffDocuments(base, target);
    const change = diff.changes.find(
      (c) => c.propertyPath === 'variableStore.collections.c1_aaaa.name',
    );
    expect(change).toBeDefined();
    expect(change?.changeType).toBe('modified');
    expect(change?.before).toBe('Brand');
    expect(change?.after).toBe('Daylight');
  });

  it('is deterministic for equal inputs', () => {
    const base = baseDoc();
    const target = clone(base);
    (target.nodes.n1_aaaa as { opacity: number }).opacity = 0.5;
    target.name = 'Renamed';
    const a = diffDocuments(base, target);
    const b = diffDocuments(base, target);
    expect(a.changes).toEqual(b.changes);
  });

  it('ignores the nextId counter', () => {
    const base = baseDoc();
    const target = clone(base);
    target.nextId = 999;
    expect(diffDocuments(base, target).changed).toBe(false);
  });
});

describe('lcsIndices', () => {
  it('finds the longest common subsequence', () => {
    expect(lcsIndices(['a', 'b', 'c'], ['a', 'x', 'b'])).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('handles empty inputs', () => {
    expect(lcsIndices([], ['a'])).toEqual([]);
    expect(lcsIndices(['a'], [])).toEqual([]);
  });
});

describe('stableStringify', () => {
  it('is key-order independent', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('handles nested structures', () => {
    expect(stableStringify({ list: [3, 1, 2], obj: { y: 1, x: [4, 5] } })).toBe(
      '{"list":[3,1,2],"obj":{"x":[4,5],"y":1}}',
    );
  });
});

describe('diff-merge coherence', () => {
  it('identical diff input pairs produce identical merge results', () => {
    const base = baseDoc();
    const ours = clone(base);
    (ours.nodes.n1_aaaa as { opacity: number }).opacity = 0.4;
    (ours.nodes.n2_bbbb as { name: string }).name = 'Renamed group';
    const theirs = clone(base);
    (theirs.nodes.n1_aaaa as { visible?: boolean }).visible = false;
    const a = mergeDocuments(base, ours, theirs);
    const b = mergeDocuments(base, ours, theirs);
    expect(a.mergedHash).toBe(b.mergedHash);
    expect(a.status).toBe('clean');
  });
});

describe('diffDocuments null-safety', () => {
  it('does not throw when a nested collection record appears from undefined', () => {
    // Regression: adding the first variable makes `variableStore` transition
    // from undefined to a record; the nested-collection branch must not
    // pass undefined into unionKeys (Object.keys crash).
    const base = baseDoc();
    const target = clone(base);
    const store: VariableStore = {
      variables: {
        v_0001: {
          id: 'v_0001',
          name: 'Brand',
          type: 'color',
          valuesByMode: { default: '#39d0c6' },
        },
      },
      collections: {},
      activeCollectionId: '',
      modes: ['default'],
      activeMode: 'default',
    };
    target.variableStore = store;
    expect(() => diffDocuments(base, target)).not.toThrow();
    const diff = diffDocuments(base, target);
    expect(diff.changed).toBe(true);
    // The optional store is captured as one atomic replacement so replay can
    // create its parent path on a legacy snapshot.
    expect(diff.changes.some((c) => c.propertyPath === 'variableStore')).toBe(true);
  });

  it('does not throw when a nested collection record is removed to undefined', () => {
    const base = baseDoc();
    const store: VariableStore = {
      variables: { v_0001: { id: 'v_0001', name: 'Brand', type: 'color', valuesByMode: {} } },
      collections: {},
      activeCollectionId: '',
      modes: ['default'],
      activeMode: 'default',
    };
    base.variableStore = store;
    const target = clone(base);
    delete (target as { variableStore?: VariableStore }).variableStore;
    expect(() => diffDocuments(base, target)).not.toThrow();
  });
});
