import type { Document as SceneDoc } from '@strata/scene';
import { createDocument, makeShapeNode } from '@strata/scene';
import { describe, expect, it } from 'vitest';
import { compareExportHashes, computeDocExportHash, computeNodeExportHash } from './diff';

function addNode(doc: SceneDoc, node: ReturnType<typeof makeShapeNode>): SceneDoc {
  const d = { ...doc, nodes: { ...doc.nodes, [node.id]: node } };
  return { ...d, rootChildren: [...d.rootChildren, node.id] };
}

describe('computeDocExportHash', () => {
  it('hash_is_deterministic', () => {
    const doc = createDocument('Test');
    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const d1 = addNode(doc, n1);
    const h1 = computeDocExportHash(d1);
    const h2 = computeDocExportHash(d1);
    expect(h1).toBe(h2);
  });

  it('hash_changes_on_modification', () => {
    const doc = createDocument('Test');
    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const d1 = addNode(doc, n1);
    const h1 = computeDocExportHash(d1);

    const modified = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
    const d2 = addNode(doc, modified);
    const h2 = computeDocExportHash(d2);
    expect(h1).not.toBe(h2);
  });

  it('hash_changes_on_add', () => {
    const doc = createDocument('Test');
    const h1 = computeDocExportHash(doc);

    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const d2 = addNode(doc, n1);
    const h2 = computeDocExportHash(d2);
    expect(h1).not.toBe(h2);
  });

  it('empty_doc_has_valid_hash', () => {
    const doc = createDocument('Test');
    const hash = computeDocExportHash(doc);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
  });
});

describe('computeNodeExportHash', () => {
  it('produces consistent hash for same node', () => {
    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    expect(computeNodeExportHash(n1)).toBe(computeNodeExportHash(n1));
  });

  it('produces different hash for different nodes', () => {
    const n1 = makeShapeNode('n1', { kind: 'rect', x: 0, y: 0, w: 100, h: 50 });
    const n2 = makeShapeNode('n2', { kind: 'rect', x: 0, y: 0, w: 200, h: 100 });
    expect(computeNodeExportHash(n1)).not.toBe(computeNodeExportHash(n2));
  });
});

describe('compareExportHashes', () => {
  it('compare_identifies_changes', () => {
    const previous: Record<string, string> = {
      n1: 'aaa',
      n2: 'bbb',
      n3: 'ccc',
    };
    const current: Record<string, string> = {
      n1: 'aaa',
      n2: 'changed',
      n4: 'ddd',
    };
    const result = compareExportHashes(previous, current);
    expect(result.changed).toEqual(['n2']);
    expect(result.added).toEqual(['n4']);
    expect(result.removed).toEqual(['n3']);
    expect(result.unchanged).toEqual(['n1']);
  });
});
