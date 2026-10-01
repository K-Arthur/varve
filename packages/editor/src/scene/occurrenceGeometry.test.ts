import {
  createDocument,
  type Document,
  makeFrameNode,
  makeShapeNode,
  resolveEditorSceneScope,
} from '@varve/scene';
import { describe, expect, it, vi } from 'vitest';
import { occurrenceGeometry } from './occurrenceGeometry';

function fixture() {
  const base = createDocument('geometry-cache', true);
  const parent = makeFrameNode('parent', {
    transform: [1, 0, 0, 1, 100, 100],
    w: 100,
    h: 100,
    children: ['child'],
  });
  const child = makeShapeNode('child', { kind: 'rect', x: 0, y: 0, w: 20, h: 10 });
  const other = makeShapeNode(
    'other',
    { kind: 'rect', x: 0, y: 0, w: 5, h: 5 },
    {
      transform: [1, 0, 0, 1, 500, 500],
    },
  );
  const doc: Document = {
    ...base,
    rootChildren: ['parent', 'other'],
    nodes: { parent, child, other },
  };
  const scope = resolveEditorSceneScope(doc, { workspaceMode: 'design' });
  return { doc, scope };
}

describe('occurrenceGeometry', () => {
  it('recalculates a moved subtree and leaves unrelated occurrences cached', () => {
    const { doc, scope } = fixture();
    const before = occurrenceGeometry(doc, scope);
    const moved: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        parent: { ...doc.nodes.parent!, transform: [1, 0, 0, 1, 200, 250] },
      },
    };
    const movedScope = resolveEditorSceneScope(moved, { workspaceMode: 'design' });
    expect(movedScope).toBe(scope);

    const after = occurrenceGeometry(moved, movedScope);
    const full = occurrenceGeometry(moved, movedScope, { revision: 'independent-full' });

    expect(after.incremental).toBe(true);
    expect(after.recalculatedOccurrenceCount).toBe(2);
    expect([...after.boundsByInstanceId]).toEqual([...full.boundsByInstanceId]);
    expect(after.boundsByInstanceId.get('child')?.x).toBe(200);
    expect(after.boundsByInstanceId.get('child')?.y).toBe(250);
    expect(after.boundsByInstanceId.get('other')).toBe(before.boundsByInstanceId.get('other'));
  });

  it('updates an ancestor when a nested child moves', () => {
    const { doc, scope } = fixture();
    occurrenceGeometry(doc, scope);
    const moved: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        child: { ...doc.nodes.child!, transform: [1, 0, 0, 1, 30, 40] },
      },
    };
    const after = occurrenceGeometry(
      moved,
      resolveEditorSceneScope(moved, { workspaceMode: 'design' }),
    );
    const full = occurrenceGeometry(moved, scope, { revision: 'child-full' });

    expect(after.incremental).toBe(true);
    expect(after.recalculatedOccurrenceCount).toBe(2);
    expect([...after.boundsByInstanceId]).toEqual([...full.boundsByInstanceId]);
  });

  it('uses certified transform IDs to refresh labels without classifying every node', () => {
    const { doc, scope } = fixture();
    const resolver = vi.fn((document: Document, id: string) => {
      const node = document.nodes[id];
      return node ? { x: node.transform[4], y: node.transform[5], w: 20, h: 10 } : null;
    });
    occurrenceGeometry(doc, scope, { revision: 'certified', boundsForNode: resolver });

    const moved: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        child: { ...doc.nodes.child!, transform: [1, 0, 0, 1, 30, 40] },
      },
    };
    const after = occurrenceGeometry(moved, scope, {
      revision: 'certified',
      boundsForNode: resolver,
      transformChangedNodeIds: ['child'],
    });

    expect(after.incremental).toBe(true);
    expect(after.recalculatedOccurrenceCount).toBe(2);
    expect(new Set(after.recalculatedInstanceIds)).toEqual(new Set(['parent', 'child']));
    expect(resolver).toHaveBeenCalledTimes(5);
    expect(after.boundsByInstanceId.get('child')?.x).toBe(30);
    expect(after.boundsByInstanceId.get('child')?.y).toBe(40);
  });

  it('fully rebuilds when the bounds resolver changes', () => {
    const { doc, scope } = fixture();
    const firstResolver = vi.fn(() => ({ x: 1, y: 2, w: 3, h: 4 }));
    const secondResolver = vi.fn(() => ({ x: 5, y: 6, w: 7, h: 8 }));
    occurrenceGeometry(doc, scope, { boundsForNode: firstResolver });

    const moved: Document = {
      ...doc,
      nodes: {
        ...doc.nodes,
        child: { ...doc.nodes.child!, transform: [1, 0, 0, 1, 30, 40] },
      },
    };
    const after = occurrenceGeometry(
      moved,
      resolveEditorSceneScope(moved, { workspaceMode: 'design' }),
      {
        boundsForNode: secondResolver,
      },
    );

    expect(after.incremental).toBe(false);
    expect(after.recalculatedOccurrenceCount).toBe(3);
    expect(secondResolver).toHaveBeenCalledTimes(3);
  });
});
