import { buildParentIndexMap, createDocument, makeFrameNode, makeShapeNode } from '@varve/scene';
import { describe, expect, it } from 'vitest';
import { committedParentIndex } from '../parentIndexCache';

function nestedDocument(label: string) {
  const base = createDocument(label, true);
  const frame = makeFrameNode('frame', { children: ['child'] });
  const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 10, h: 10 });
  return {
    ...base,
    nodes: { ...base.nodes, frame, child },
    rootChildren: [...base.rootChildren, 'frame'],
  };
}

describe('committedParentIndex', () => {
  it('matches buildParentIndexMap and is reused for the same nodes record', () => {
    const doc = nestedDocument('a');
    const shared = committedParentIndex(doc);
    expect([...shared.entries()]).toEqual([...buildParentIndexMap(doc).entries()]);
    expect(shared.get('child')).toBe('frame');
    expect(committedParentIndex({ ...doc, name: 'renamed' })).toBe(shared);
  });

  it('rebuilds for a new nodes record produced by an immutable edit', () => {
    const doc = nestedDocument('b');
    const before = committedParentIndex(doc);
    const detached = {
      ...doc,
      nodes: { ...doc.nodes, frame: { ...doc.nodes.frame!, children: [] } },
      rootChildren: [...doc.rootChildren, 'child'],
    };
    const after = committedParentIndex(detached);
    expect(after).not.toBe(before);
    expect(after.get('child')).toBeUndefined();
    expect(before.get('child')).toBe('frame');
  });

  it('shares the parent map with a document that only moved nodes', () => {
    const doc = nestedDocument('moved');
    const before = committedParentIndex(doc);
    const moved = {
      ...doc,
      nodes: {
        ...doc.nodes,
        child: { ...doc.nodes.child!, transform: [1, 0, 0, 1, 7, 3] as const },
      },
    };
    expect(committedParentIndex(moved)).toBe(before);
  });

  it('refuses mutation so one consumer cannot corrupt another', () => {
    const shared = committedParentIndex(nestedDocument('c'));
    expect(() => shared.set('x', 'y')).toThrow(/read-only/);
    expect(() => shared.delete('child')).toThrow(/read-only/);
    expect(() => shared.clear()).toThrow(/read-only/);
    expect(shared.get('child')).toBe('frame');
  });

  it('retains only a bounded number of documents', () => {
    const first = nestedDocument('d');
    const firstIndex = committedParentIndex(first);
    for (let i = 0; i < 6; i++) committedParentIndex(nestedDocument(`e${i}`));
    expect(committedParentIndex(first)).not.toBe(firstIndex);
  });
});
