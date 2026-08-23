import { describe, expect, it } from 'vitest';
import type { Document } from './document';
import type { SceneNode } from './types';
import { applySoloToDocument, documentHasSolo, nodeSoloVisible } from './visibility';

function baseDoc(): Document {
  const mk = (id: string, over: Partial<SceneNode> = {}): SceneNode =>
    ({
      id,
      kind: 'frame',
      name: id,
      visible: true,
      locked: false,
      children: [],
      ...over,
    }) as unknown as SceneNode;
  return {
    id: 'doc',
    name: 'doc',
    formatVersion: 2,
    nextId: 'z',
    rootChildren: ['a', 'b', 'c'],
    nodes: {
      a: mk('a'),
      b: mk('b'),
      c: mk('c', { visible: false }),
    },
  } as unknown as Document;
}

describe('documentHasSolo', () => {
  it('is false when no node is soloed', () => {
    expect(documentHasSolo(baseDoc())).toBe(false);
  });

  it('is true when at least one node is soloed', () => {
    const doc = baseDoc();
    doc.nodes.b!.solo = true;
    expect(documentHasSolo(doc)).toBe(true);
  });
});

describe('nodeSoloVisible', () => {
  it('respects the base visible flag', () => {
    const hidden = { id: 'x', visible: false, solo: true } as unknown as SceneNode;
    expect(nodeSoloVisible(hidden, true)).toBe(false);
  });

  it('is visible when nothing is soloed', () => {
    const node = { id: 'x', visible: true, solo: false } as unknown as SceneNode;
    expect(nodeSoloVisible(node, false)).toBe(true);
  });

  it('is visible only for the soloed node when something is soloed', () => {
    const soloed = { id: 'x', visible: true, solo: true } as unknown as SceneNode;
    const other = { id: 'y', visible: true, solo: false } as unknown as SceneNode;
    expect(nodeSoloVisible(soloed, true)).toBe(true);
    expect(nodeSoloVisible(other, true)).toBe(false);
  });
});

describe('applySoloToDocument', () => {
  it('returns the same reference when nothing is soloed', () => {
    const doc = baseDoc();
    expect(applySoloToDocument(doc)).toBe(doc);
  });

  it('hides every non-soloed node and leaves soloed nodes visible', () => {
    const doc = baseDoc();
    doc.nodes.b!.solo = true;
    const out = applySoloToDocument(doc);
    expect(out).not.toBe(doc);
    expect(out.nodes.a!.visible).toBe(false);
    expect(out.nodes.b!.visible).toBe(true);
    expect(out.nodes.c!.visible).toBe(false);
    expect(doc.nodes.a!.visible).toBe(true);
  });

  it('hides everything when multiple nodes are soloed', () => {
    const doc = baseDoc();
    doc.nodes.a!.solo = true;
    doc.nodes.b!.solo = true;
    const out = applySoloToDocument(doc);
    expect(out.nodes.a!.visible).toBe(true);
    expect(out.nodes.b!.visible).toBe(true);
    expect(out.nodes.c!.visible).toBe(false);
  });
});
